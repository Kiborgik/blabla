import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createLocalSimulation, advanceLocalSimulation, localSimulationSnapshot, LOCAL_SIMULATION_STORAGE_KEY } from '../web/local-simulation.ts';
import { createLocalWorldStorage, type LocalCheckpointResult, type LocalWorldStoragePorts } from '../web/local-world-storage.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../web/viewer-state.ts';
import { createWorldViewSession, DEFAULT_WORLD_CAMERA, MAX_WORLD_VIEWS, WORLD_SOURCES, parseWorldSource, parseWorldViews, saveWorldView, worldSourceHref, type WorldViewIdentity } from '../web/world-view.ts';

const earth: WorldViewIdentity = { source: 'local', identity: 'generated:1701:epoch-one', body: 'earth' };
const camera = { zoom: 2.1, x: 17, z: -11, selected: 3, selectedCity: 'third-town' };

void test('first matching snapshot restores its current-world camera and selection', () => {
  const saved = saveWorldView({ ...DEFAULT_PREFERENCES, theme: 'dark' as const }, earth, camera);
  const before = structuredClone(saved);
  const session = createWorldViewSession();
  assert.equal(session.identity(), null);
  const observed = session.observe(parsePreferences(saved), earth);
  assert.equal(observed.changed, true); assert.equal(observed.restored, true);
  for (const key of ['zoom', 'x', 'z', 'selected', 'selectedCity'] as const) assert.equal(observed.preferences[key], camera[key]);
  assert.equal(observed.preferences.theme, 'dark'); assert.deepEqual(saved, before);
});

void test('later snapshots with the same immutable identity do not reset a moved camera', () => {
  const session = createWorldViewSession(); const first = session.observe(DEFAULT_PREFERENCES, earth);
  const moved = { ...first.preferences, ...camera };
  const next = session.observe(moved, { ...earth });
  assert.equal(next.changed, false); assert.equal(next.preferences, moved);
  assert.deepEqual(session.identity(), earth);
  const copy = session.identity(); assert.ok(copy); copy.body = 'mars';
  assert.equal(session.identity()?.body, 'earth');
});

void test('a camera without matching current-world identity is not reused and cosmetics survive', () => {
  const saved = parsePreferences({ ...DEFAULT_PREFERENCES, ...camera, theme: 'dark', effects: 'calm', unrelated: 'keep' });
  const before = structuredClone(saved);
  const view = createWorldViewSession().observe(saved, earth);
  assert.equal(view.restored, false);
  for (const key of ['zoom', 'x', 'z', 'selected', 'selectedCity'] as const) assert.equal(view.preferences[key], DEFAULT_WORLD_CAMERA[key]);
  assert.equal(view.preferences.theme, 'dark'); assert.equal(view.preferences.effects, 'calm'); assert.deepEqual(saved, before);
});

void test('source, immutable genesis and planetary body independently prevent off-world restoration', () => {
  const saved = saveWorldView(DEFAULT_PREFERENCES, earth, camera);
  for (const changed of [{ ...earth, source: 'shared' as const }, { ...earth, identity: 'generated:1701:epoch-two' }, { ...earth, body: 'mars' }]) {
    const view = createWorldViewSession().observe(saved, changed);
    assert.equal(view.restored, false); assert.equal(view.preferences.selectedCity, null); assert.equal(view.preferences.x, 0);
  }
});

void test('switching sources saves independent views and switching back restores the original view', () => {
  const session = createWorldViewSession(); let prefs = session.observe(DEFAULT_PREFERENCES, earth).preferences;
  prefs = session.capture(prefs, camera); session.release();
  const archive = { source: 'shared' as const, identity: earth.identity, body: 'earth' };
  prefs = session.observe(prefs, archive).preferences;
  assert.equal(prefs.worldSource, 'shared'); assert.equal(prefs.x, 0);
  prefs = session.capture(prefs, { ...camera, zoom: .7, x: -33, selectedCity: 'archive-capital' }); session.release();
  const returned = session.observe(parsePreferences(prefs), earth);
  assert.equal(returned.restored, true); assert.equal(returned.preferences.x, camera.x); assert.equal(returned.preferences.selectedCity, camera.selectedCity);
  assert.equal(returned.preferences.worldViews?.length, 2);
});

void test('sample or loading views cannot overwrite the last qualified world camera', () => {
  const session = createWorldViewSession(); let prefs = session.observe(DEFAULT_PREFERENCES, earth).preferences;
  prefs = session.capture(prefs, camera); session.release();
  const sample = session.capture(prefs, { ...DEFAULT_WORLD_CAMERA, x: 90 });
  assert.deepEqual(sample, prefs); assert.equal(session.observe(sample, earth).preferences.x, camera.x);
});

void test('qualified preference parsing validates, deduplicates and bounds retained views without mutation', () => {
  const source = Array.from({ length: MAX_WORLD_VIEWS + 4 }, (_, index) => ({ ...earth, identity: `world-${index}`, camera }));
  const before = structuredClone(source); const views = parseWorldViews(source);
  assert.equal(views.length, MAX_WORLD_VIEWS); assert.equal(views[0]?.identity, 'world-4'); assert.deepEqual(source, before);
  assert.deepEqual(parseWorldViews([null, { ...earth, camera: [] }, { ...earth, source: 'orders', camera }, { ...earth, identity: '', camera }, { ...earth, body: '', camera }]), []);
  const repeated = parseWorldViews([{ ...earth, camera }, { ...earth, camera: { ...camera, x: Infinity, zoom: 100, selected: 17 } }]);
  assert.equal(repeated.length, 1); assert.equal(repeated[0]?.camera.x, 0); assert.equal(repeated[0]?.camera.zoom, 4); assert.equal(repeated[0]?.camera.selected, 0);
  assert.deepEqual(WORLD_SOURCES, ['local', 'shared']);
  for (const source of WORLD_SOURCES) assert.equal(parseWorldSource(source), source);
  assert.equal(parseWorldSource('restart'), null);
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
});

void test('current local identities survive progression and distinguish seed and immutable genesis', () => {
  const generated = createLocalSimulation(1701);
  const first = localSimulationSnapshot(generated);
  const advanced = advanceLocalSimulation(generated, 1);
  assert.equal(localSimulationSnapshot(advanced).identity, first.identity);
  const changedEpoch = structuredClone(generated); changedEpoch.state.clockEpoch = '2001-01-01T00:00:00.000Z';
  const saved = saveWorldView(DEFAULT_PREFERENCES, { ...earth, identity: first.identity }, camera);
  assert.equal(createWorldViewSession().observe(saved, { ...earth, identity: localSimulationSnapshot(advanced).identity }).restored, true);
  for (const other of [changedEpoch, createLocalSimulation(1702)]) {
    assert.notEqual(localSimulationSnapshot(other).identity, first.identity);
    assert.equal(createWorldViewSession().observe(saved, { ...earth, identity: localSimulationSnapshot(other).identity }).restored, false);
  }
});

void test('browser source choices match the two current observer sources and use only current storage operations', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const sourcePicker = main.match(/<select id="world-source">(.*?)<\/select>/)?.[1];
  assert.ok(sourcePicker);
  assert.deepEqual([...sourcePicker.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(([, value, label]) => ({ value, label })), [
    { value: 'local', label: 'Autonomous world' },
    { value: 'shared', label: 'Native world archive' },
  ]);
  assert.deepEqual([...main.matchAll(/localWorldStorage\.(\w+)\(/g)].map(([, operation]) => operation).sort(), ['restore', 'save']);
});

void test('the browser startup, source switch and deployment adapter actually use the qualified session', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /observeWorldIdentity\(next, 'local'\)/);
  assert.match(main, /observeWorldIdentity\(read\.snapshot, 'shared'\)/);
  assert.match(main, /preferences: \(\) => worldView\.capture/);
  assert.match(main, /localSimulation !== previous\) observeLocalSimulation\(\)/);
  assert.match(main, /visibilitychange[\s\S]*if \(mode === 'local'\) observeLocalSimulation\(\)/);
  assert.match(main, /changeWorldSource\(parseWorldSource\(new URL\(window\.location\.href\)\.searchParams\.get\('world'\)\) \?\? worldSource\)/);
  const switchBody = main.slice(main.indexOf('function changeWorldSource'), main.indexOf('let reading = false'));
  assert.match(switchBody, /savePreferences\(\); worldView\.release\(\)/);
  assert.doesNotMatch(switchBody, /selectedCity: null|zoom: 1|removeItem|\.clear\(/);
});

void test('choosing a real source replaces stale sample and source URL hints without losing unrelated history', () => {
  const href = new URL(worldSourceHref('https://viewer.example/atlas?sample=1&world=local&other=keep#settings', 'shared'));
  assert.equal(href.origin, 'https://viewer.example'); assert.equal(href.pathname, '/atlas'); assert.equal(href.searchParams.get('world'), 'shared');
  assert.equal(href.searchParams.has('sample'), false); assert.equal(href.searchParams.get('other'), 'keep'); assert.equal(href.hash, '#settings');
});

function storageFixture(initial: Record<string, string> = {}, overrides: Partial<LocalWorldStoragePorts> = {}) {
  const values = new Map(Object.entries(initial)); const writes: Array<{ key: string; value: string }> = []; const reads: string[] = []; const locks: string[] = [];
  const ports: LocalWorldStoragePorts = { read: key => { reads.push(key); return values.get(key) ?? null; }, write: (key, value) => { writes.push({ key, value }); values.set(key, value); },
    withLock: async (key, operation) => { locks.push(key); return operation(); }, entropy: () => 1701, ...overrides };
  return { adapter: createLocalWorldStorage(ports), values, writes, reads, locks, ports };
}

void test('fresh checkpoints read and write only the current world key', async () => {
  const untouched = '  unrelated stored bytes  ';
  const f = storageFixture({ 'unrelated-record': untouched });
  const current = await f.adapter.restore(); assert.ok(current.run); assert.equal(current.run.version, 2);
  assert.equal(current.ephemeral, false); assert.equal(current.blocked, false);
  assert.match(current.message, /New world.*Current development version/);
  assert.deepEqual([...new Set(f.reads)], [LOCAL_SIMULATION_STORAGE_KEY]);
  assert.equal(f.values.get('unrelated-record'), untouched);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0]?.key, LOCAL_SIMULATION_STORAGE_KEY);
  assert.deepEqual(f.locks, [LOCAL_SIMULATION_STORAGE_KEY]);
});

void test('current-version checkpoints restore the same world without a rewrite', async () => {
  const run = advanceLocalSimulation(createLocalSimulation(1701), 1);
  const bytes = ` \n${JSON.stringify(run)}\n`;
  const f = storageFixture({ [LOCAL_SIMULATION_STORAGE_KEY]: bytes });
  const restored = await f.adapter.restore(); assert.deepEqual(restored.run, run);
  assert.equal(restored.blocked, false); assert.equal(restored.ephemeral, false);
  assert.deepEqual(f.reads, [LOCAL_SIMULATION_STORAGE_KEY]); assert.equal(f.writes.length, 0);
  assert.equal(f.values.get(LOCAL_SIMULATION_STORAGE_KEY), bytes);
});

void test('missing Locks permits this-tab observation but performs no shared checkpoint write or unsafe fallback', async () => {
  const run = createLocalSimulation(); let reads = 0; let writes = 0;
  const adapter = createLocalWorldStorage({ read: () => { reads += 1; return JSON.stringify(run); }, write: () => { writes += 1; } });
  const restored = await adapter.restore(); assert.ok(restored.run); assert.equal(restored.ephemeral, true); assert.match(restored.message, /without saving/);
  const saved = await adapter.save(() => restored.run); assert.equal(saved.ephemeral, true); assert.equal(reads, 1); assert.equal(writes, 0);
  assert.deepEqual(saved.run, restored.run);
});

void test('unavailable storage creates an explicitly ephemeral world without attempting a checkpoint write', async () => {
  let writes = 0;
  const f = storageFixture({}, { read: () => { throw new Error('unavailable'); }, write: () => { writes += 1; } });
  const restored = await f.adapter.restore(); assert.ok(restored.run); assert.equal(restored.ephemeral, true); assert.match(restored.message, /This tab only · Not saved/);
  await f.adapter.save(() => restored.run); assert.equal(writes, 0); assert.equal(f.locks.length, 0);
});

void test('a corrupt current save remains unavailable and is never silently reset', async () => {
  const currentRaw = '{broken';
  const f = storageFixture({ [LOCAL_SIMULATION_STORAGE_KEY]: currentRaw });
  const restored = await f.adapter.restore(); assert.equal(restored.run, null); assert.equal(restored.blocked, true); assert.match(restored.message, /preserved/);
  await f.adapter.save(() => createLocalSimulation()); assert.equal(f.writes.length, 0); assert.equal(f.locks.length, 0);
  assert.equal(f.values.get(LOCAL_SIMULATION_STORAGE_KEY), currentRaw);
});

void test('write quota and lock refusal leave the same in-memory world usable and do not keep retrying writes', async () => {
  for (const failure of ['write', 'lock']) {
    let attempted = 0;
    const f = storageFixture({}, failure === 'write' ? { write: () => { attempted += 1; throw new Error('quota'); } } : { withLock: async () => { attempted += 1; throw new Error('lock refused'); } });
    const restored = await f.adapter.restore(); assert.ok(restored.run);
    const failed = await f.adapter.save(() => restored.run); assert.equal(failed.run, restored.run); assert.equal(failed.ephemeral, true); assert.match(failed.message, /Not saved/);
    const again = await f.adapter.save(() => restored.run); assert.equal(again.run, restored.run); assert.equal(attempted, 1); assert.equal(f.values.has(LOCAL_SIMULATION_STORAGE_KEY), false);
  }
});

void test('a save reads the latest in-memory checkpoint only after acquiring the lock and cannot rewind a newer durable checkpoint', async () => {
  const original = createLocalSimulation(); const newer = advanceLocalSimulation(original, 1); let current = original; const pendingLock: { grant?: () => void } = {};
  const f = storageFixture({ [LOCAL_SIMULATION_STORAGE_KEY]: JSON.stringify(original) }, { withLock: (_key, operation) => new Promise<LocalCheckpointResult>(resolve => { pendingLock.grant = () => resolve(operation()); }) });
  await f.adapter.restore(); const pending = f.adapter.save(() => current); current = newer; assert.ok(pendingLock.grant); pendingLock.grant();
  const saved = await pending; assert.equal(saved.run, newer); assert.equal(JSON.parse(f.values.get(LOCAL_SIMULATION_STORAGE_KEY)!).steps, newer.steps);
  const behind = storageFixture({ [LOCAL_SIMULATION_STORAGE_KEY]: JSON.stringify(newer) }); await behind.adapter.restore();
  const retained = await behind.adapter.save(() => original);
  assert.deepEqual(retained.run, newer); assert.equal(behind.writes.length, 0); assert.match(retained.message, /Updated by another tab/);
});

void test('a different or corrupt checkpoint arriving before a save is preserved instead of overwritten', async () => {
  for (const other of [JSON.stringify(createLocalSimulation(1702)), '{not-readable']) {
    const f = storageFixture(); const restored = await f.adapter.restore(); assert.ok(restored.run);
    f.writes.length = 0; f.values.set(LOCAL_SIMULATION_STORAGE_KEY, other);
    const saved = await f.adapter.save(() => restored.run);
    assert.equal(saved.run, restored.run); assert.equal(saved.blocked, true); assert.equal(saved.ephemeral, true);
    assert.match(saved.message, /preserved/); assert.equal(f.writes.length, 0); assert.equal(f.values.get(LOCAL_SIMULATION_STORAGE_KEY), other);
  }
});
