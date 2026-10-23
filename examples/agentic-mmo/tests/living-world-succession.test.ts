import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld } from '../core/engine.ts';
import { createLocalSimulation, LOCAL_SIMULATION_STORAGE_KEY, LIVING_SIMULATION_STORAGE_KEY, PARTNERSHIPS_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, localSimulationSnapshot, parseLocalSimulation, parseActiveLocalSimulation } from '../web/local-simulation.ts';
import { createLocalWorldStorage, type LocalCheckpointResult, type LocalWorldStoragePorts } from '../web/local-world-storage.ts';
import { createWorldViewSession, saveWorldView, parseWorldSource, worldSourceHref } from '../web/world-view.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';

function fixture(initial: Array<[string, string]> = [], overrides: Partial<LocalWorldStoragePorts> = {}, withoutLock = false) {
  const records = new Map(initial);
  const writes: Array<[string, string]> = [];
  let entropyCalls = 0;
  let locked = false;
  const ports: LocalWorldStoragePorts = {
    read: key => records.get(key) ?? null,
    write: (key, value) => { assert.equal(locked, true); writes.push([key, value]); records.set(key, value); },
    withLock: async (_key, operation) => { locked = true; try { return operation(); } finally { locked = false; } },
    entropy: () => { assert.equal(locked, true); entropyCalls += 1; return 99123; },
    ...overrides,
  };
  if (withoutLock) delete ports.withLock;
  return { storage: createLocalWorldStorage(ports), records, writes, entropyCalls: () => entropyCalls };
}

void test('fresh Food-budget world persists its sampled zero-step final-release genesis before observation can begin', async () => {
  const f = fixture();
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:food-budget-v1');
  assert.equal(LIVING_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:living-world-v1');
  const initialized = await f.storage.restore();
  assert.ok(initialized.run);
  assert.equal(initialized.ephemeral, false);
  assert.equal(initialized.run.seed, 99123);
  assert.equal(initialized.run.steps, 0);
  assert.equal(initialized.run.state.round, 0);
  assert.equal(initialized.run.state.revision, 0);
  assert.equal(initialized.run.state.releaseId, 'settlement-food-budget-1');
  assert.equal(initialized.run.state.origin?.initialReleaseId, 'settlement-food-budget-1');
  assert.ok(initialized.run.state.unlockedFeatures.includes('food-budget'));
  assert.ok(initialized.run.state.unlockedFeatures.includes('consented-relief'));
  assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), initialized.run);
  assert.equal(f.writes.length, 1);
  assert.equal(f.entropyCalls(), 1);
  const again = await f.storage.restore();
  assert.deepEqual(again.run, initialized.run);
  assert.equal(f.entropyCalls(), 1);
  assert.equal(f.writes.length, 1);
});

void test('concurrent first initializers reread within their lock and adopt one winner without drawing another seed', async () => {
  const records = new Map<string, string>();
  const pending: Array<() => void> = [];
  const draws: number[] = [];
  const writes: string[] = [];
  let locked = false;
  const ports = (seed: number): LocalWorldStoragePorts => ({
    read: key => records.get(key) ?? null,
    write: (key, value) => { assert.equal(locked, true); writes.push(value); records.set(key, value); },
    entropy: () => { assert.equal(locked, true); draws.push(seed); return seed; },
    withLock: (key, operation) => new Promise<LocalCheckpointResult>(resolve => {
      assert.equal(key, LOCAL_SIMULATION_STORAGE_KEY);
      pending.push(() => { locked = true; try { resolve(operation()); } finally { locked = false; } });
    }),
  });
  const first = createLocalWorldStorage(ports(11)).restore();
  const second = createLocalWorldStorage(ports(22)).restore();
  assert.equal(pending.length, 2);
  assert.deepEqual(draws, []);
  pending.shift()!(); pending.shift()!();
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a.run); assert.ok(b.run);
  assert.deepEqual(a.run, b.run);
  assert.equal(a.run.seed, 11);
  assert.deepEqual(draws, [11]);
  assert.equal(writes.length, 1);
});

void test('a saved winner appearing during lock wait is restored without entropy or overwrite', async () => {
  const winner = createLocalSimulation(555);
  const pending: { grant?: () => void } = {};
  const f = fixture([], { withLock: (_key, operation) => new Promise(resolve => { pending.grant = () => resolve(operation()); }) });
  const wait = f.storage.restore();
  f.records.set(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(winner));
  assert.ok(pending.grant); pending.grant();
  assert.deepEqual((await wait).run, winner);
  assert.equal(f.entropyCalls(), 0); assert.equal(f.writes.length, 0);
});

void test('all four historical storage records remain exact read-only bytes under their explicit sources', async () => {
  const living = createLocalSimulation(10, 'settlement-regional-targets-1');
  const partnerships = createLocalSimulation(11, 'settlement-living-partnerships-1');
  const prior = createLocalSimulation(12, 'settlement-interplanetary-1');
  const previous = { ...prior, version: 1, policyVersion: 'weighted-civilizations-v1', seed: 13, state: createWorld(13, prior.timestamp), memories: Array(6).fill(null) };
  const history: Array<[string, string]> = [[LIVING_SIMULATION_STORAGE_KEY, ` \n${JSON.stringify(living)} `], [PARTNERSHIPS_SIMULATION_STORAGE_KEY, ` \n${JSON.stringify(partnerships)} `], [PRIOR_GENERATED_SIMULATION_STORAGE_KEY, `\n${JSON.stringify(prior)}`], [PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, `${JSON.stringify(previous)}\n`]];
  const f = fixture(history);
  assert.deepEqual(f.storage.living().run, living);
  assert.match(f.storage.living().message, /Previous living world.*Read-only/);
  assert.deepEqual(f.storage.partnerships().run, partnerships);
  assert.match(f.storage.partnerships().message, /Read-only/);
  assert.deepEqual(f.storage.priorGenerated().run, prior);
  assert.ok(f.storage.previous().run);
  const fresh = await f.storage.restore(); assert.ok(fresh.run);
  assert.notEqual(localSimulationSnapshot(fresh.run).identity, localSimulationSnapshot(partnerships).identity);
  for (const [key, value] of history) assert.equal(f.records.get(key), value);
  assert.deepEqual(f.writes.map(([key]) => key), [LOCAL_SIMULATION_STORAGE_KEY]);
});

void test('corrupt current record, including one arriving under lock, is never erased or reinterpreted', async () => {
  for (const arrivesDuringLock of [false, true]) {
    const raw = '{broken world';
    const f = fixture(arrivesDuringLock ? [] : [[LOCAL_SIMULATION_STORAGE_KEY, raw]], arrivesDuringLock ? { withLock: async (_key, operation) => { f.records.set(LOCAL_SIMULATION_STORAGE_KEY, raw); return operation(); } } : {});
    const restored = await f.storage.restore();
    assert.equal(restored.run, null); assert.equal(restored.blocked, true); assert.match(restored.message, /preserved/);
    await f.storage.save(() => createLocalSimulation());
    assert.equal(f.entropyCalls(), 0); assert.equal(f.writes.length, 0);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), raw);
  }
});

void test('corrupt historical records are preserved and cannot prevent a separate latest genesis', async () => {
  const history: Array<[string, string]> = [LIVING_SIMULATION_STORAGE_KEY, PARTNERSHIPS_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY].map(key => [key, '{unreadable']);
  const f = fixture(history);
  for (const old of [f.storage.living(), f.storage.partnerships(), f.storage.priorGenerated(), f.storage.previous()]) { assert.equal(old.run, null); assert.match(old.message, /preserved/); }
  assert.ok((await f.storage.restore()).run);
  for (const [key, value] of history) assert.equal(f.records.get(key), value);
  assert.deepEqual(f.writes.map(([key]) => key), [LOCAL_SIMULATION_STORAGE_KEY]);
});

void test('no Locks or failed storage and locks stays ephemeral with no shared writes or unlocked entropy', async () => {
  const unavailable: Array<{ overrides: Partial<LocalWorldStoragePorts>; withoutLock: boolean }> = [
    { overrides: {}, withoutLock: true },
    { overrides: { read: () => { throw new Error('denied'); } }, withoutLock: false },
    { overrides: { withLock: async () => { throw new Error('denied'); } }, withoutLock: false },
  ];
  for (const { overrides, withoutLock } of unavailable) {
    const f = fixture([], overrides, withoutLock);
    const restored = await f.storage.restore();
    assert.ok(restored.run); assert.equal(restored.ephemeral, true); assert.match(restored.message, /This tab only · Not saved/);
    await f.storage.save(() => restored.run);
    assert.equal(f.writes.length, 0); assert.equal(f.entropyCalls(), 0);
  }
});

void test('failed genesis persistence retains one in-memory world and does not retry shared writes', async () => {
  let attempts = 0;
  const f = fixture([], { write: () => { attempts += 1; throw new Error('quota'); } });
  const restored = await f.storage.restore();
  assert.ok(restored.run); assert.equal(restored.run.seed, 99123);
  assert.equal(restored.ephemeral, true); assert.match(restored.message, /Not saved/);
  assert.equal((await f.storage.save(() => restored.run)).run, restored.run);
  assert.equal(attempts, 1); assert.equal(f.records.size, 0);
});

void test('entropy accepts both uint32 boundaries but refuses invalid samples without writing a checkpoint', async () => {
  for (const seed of [0, 0xffffffff]) {
    const f = fixture([], { entropy: () => seed });
    assert.equal((await f.storage.restore()).run?.seed, seed);
    assert.equal(f.writes.length, 1);
  }
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity]) {
    const f = fixture([], { entropy: () => seed });
    const restored = await f.storage.restore();
    assert.equal(restored.ephemeral, true); assert.match(restored.message, /Not saved/);
    assert.equal(f.writes.length, 0);
  }
});

void test('generic generated parser retains history while active parser refuses historical genesis even with a newer release', async () => {
  for (const release of ['settlement-interplanetary-1', 'settlement-living-partnerships-1', 'settlement-relief-charters-1', 'settlement-regional-targets-1'] as const) {
    const old = createLocalSimulation(1701, release);
    const raw = JSON.stringify(old);
    assert.deepEqual(parseLocalSimulation(JSON.parse(raw)), old);
    assert.equal(parseActiveLocalSimulation(old), null);
    const f = fixture([[LOCAL_SIMULATION_STORAGE_KEY, raw]]);
    assert.equal((await f.storage.restore()).run, null);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), raw);
    assert.equal(f.writes.length, 0);
  }
  const current = createLocalSimulation();
  assert.equal(current.seed, 1701);
  assert.deepEqual(current, createLocalSimulation());
  assert.deepEqual(parseActiveLocalSimulation(current), current);
  const olderGenesis = structuredClone(current);
  assert.ok(olderGenesis.state.origin);
  olderGenesis.state.origin.initialReleaseId = 'settlement-living-partnerships-1';
  assert.ok(parseLocalSimulation(olderGenesis));
  assert.equal(parseActiveLocalSimulation(olderGenesis), null);
});

void test('partnerships camera fallback is exact historical identity and body, never inherited by the latest genesis', () => {
  const old = createLocalSimulation(1701, 'settlement-living-partnerships-1');
  const identity = localSimulationSnapshot(old).identity;
  const camera = { zoom: 2, x: 4, z: -8, selected: 3, selectedCity: 'old-city' };
  const saved = saveWorldView(DEFAULT_PREFERENCES, { source: 'local', identity, body: 'earth' }, camera);
  const restored = createWorldViewSession().observe(saved, { source: 'partnerships', identity, body: 'earth' });
  assert.equal(restored.restored, true); assert.equal(restored.preferences.selectedCity, 'old-city');
  for (const target of [{ source: 'partnerships' as const, identity, body: 'mars' }, { source: 'local' as const, identity: localSimulationSnapshot(createLocalSimulation()).identity, body: 'earth' }, { source: 'partnerships' as const, identity: `${identity}:other`, body: 'earth' }]) {
    const next = createWorldViewSession().observe(saved, target);
    assert.equal(next.restored, false); assert.equal(next.preferences.selectedCity, null);
  }
  const independent = saveWorldView(saved, { source: 'partnerships', identity, body: 'earth' }, { ...camera, x: 19 });
  assert.equal(createWorldViewSession().observe(independent, { source: 'partnerships', identity, body: 'earth' }).preferences.x, 19);
  assert.equal(parseWorldSource('partnerships'), 'partnerships');
  assert.equal(new URL(worldSourceHref('https://example.test/?world=prior&sample=1', 'partnerships')).searchParams.get('world'), 'partnerships');
});

void test('actual browser initializer awaits the genesis checkpoint and labels latest and historical sources separately', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /const restoredLocal = await localWorldStorage\.restore\(\)/);
  assert.match(main, /<option value="local">Food-budget world<\/option>/);
  assert.match(main, /<option value="living">Previous living world · Read-only<\/option>/);
  assert.match(main, /<option value="partnerships">[^<]*Read-only<\/option>/);
  assert.match(main, /mode !== 'local'[^\n]*localSimulation\.state\.outcome/);
  assert.doesNotMatch(main, /Living partnerships · Runs here/);
});
