import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createWorld } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { advanceLocalSimulation, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, LOCAL_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY } from '../web/local-simulation.ts';
import { createLocalWorldStorage } from '../web/local-world-storage.ts';
import { createWorldViewSession, parseWorldSource, saveWorldView, worldSourceHref } from '../web/world-view.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { createCueStream } from '../web/world-cues.ts';

const epoch = '2000-01-01T00:00:00.000Z';

void test('fresh partnership genesis has explicit content rules without altering the frozen prior genesis', () => {
  const prior = createLocalSimulation(1701, 'settlement-interplanetary-1');
  const original = JSON.stringify(prior);
  const current = createLocalSimulation(1701, 'settlement-living-partnerships-1');
  assert.equal(current.state.releaseId, 'settlement-living-partnerships-1');
  assert.ok(current.state.unlockedFeatures.includes('partnership-stewardship'));
  assert.ok(current.state.unlockedFeatures.includes('historical-pressures'));
  assert.equal(current.state.origin?.initialReleaseId, current.state.releaseId);
  assert.equal(prior.state.origin?.initialReleaseId, undefined);
  assert.equal(localSimulationSnapshot(prior).identity, `local:coherent-geography-v1:1701:${epoch}`);
  assert.notEqual(localSimulationSnapshot(current).identity, localSimulationSnapshot(prior).identity);
  assert.deepEqual(current.state.tiles, prior.state.tiles);
  assert.deepEqual(current.state.cities, prior.state.cities);
  assert.deepEqual(current.state.civilizations, prior.state.civilizations);
  assert.deepEqual(parseLocalSimulation(JSON.parse(original)), prior);
  assert.equal(JSON.stringify(prior), original);
  const after = advanceLocalSimulation(prior, 2);
  assert.equal(after.state.releaseId, 'settlement-interplanetary-1');
  assert.ok(!after.state.unlockedFeatures.includes('partnership-stewardship'));
  assert.ok(!after.state.unlockedFeatures.includes('historical-pressures'));
  assert.equal(JSON.stringify(prior), original);
});

void test('new content checkpoint preserves both original save keys byte for byte and exposes each read-only', async () => {
  const prior = createLocalSimulation(90210, 'settlement-interplanetary-1');
  const first = { ...prior, version: 1, policyVersion: 'weighted-civilizations-v1', state: createWorld(1701, epoch), seed: 1701, memories: Array(6).fill(null) };
  const priorBytes = ` \n${JSON.stringify(prior)}\n`;
  const firstBytes = `\n${JSON.stringify(first)} `;
  const records = new Map([[PRIOR_GENERATED_SIMULATION_STORAGE_KEY, priorBytes], [PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, firstBytes]]);
  const writes: string[] = [];
  const storage = createLocalWorldStorage({ read: key => records.get(key) ?? null, write: (key, value) => { writes.push(key); records.set(key, value); }, withLock: async (_key, operation) => operation(), entropy: () => 1701 });
  assert.deepEqual(storage.priorGenerated().run, prior);
  assert.match(storage.priorGenerated().message, /Read-only/);
  assert.ok(storage.previous().run);
  const fresh = await storage.restore(); assert.ok(fresh.run);
  assert.equal(fresh.run.state.releaseId, 'settlement-regional-targets-1');
  assert.deepEqual(writes, [LOCAL_SIMULATION_STORAGE_KEY]);
  assert.equal(records.get(PRIOR_GENERATED_SIMULATION_STORAGE_KEY), priorBytes);
  assert.equal(records.get(PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY), firstBytes);
});

void test('an unreadable previous generated record is not migrated, replaced or treated as the new world', async () => {
  const raw = '{unreadable previous world';
  const records = new Map([[PRIOR_GENERATED_SIMULATION_STORAGE_KEY, raw]]);
  const writes: string[] = [];
  const storage = createLocalWorldStorage({ read: key => records.get(key) ?? null, write: (key, value) => { writes.push(key); records.set(key, value); }, withLock: async (_key, operation) => operation(), entropy: () => 1701 });
  assert.equal(storage.priorGenerated().run, null);
  assert.match(storage.priorGenerated().message, /preserved/);
  const fresh = await storage.restore(); assert.ok(fresh.run);
  assert.equal(records.get(PRIOR_GENERATED_SIMULATION_STORAGE_KEY), raw);
  assert.deepEqual(writes, [LOCAL_SIMULATION_STORAGE_KEY]);
});

void test('previous generated viewing restores its old local camera while a new genesis gets no inherited selection', () => {
  const prior = createLocalSimulation(1701, 'settlement-interplanetary-1');
  const current = createLocalSimulation();
  const camera = { zoom: 1.7, x: 12, z: -8, selected: 3, selectedCity: 'city-3' };
  const identity = localSimulationSnapshot(prior).identity;
  const saved = saveWorldView(DEFAULT_PREFERENCES, { source: 'local', identity, body: 'earth' }, camera);
  const recovered = createWorldViewSession().observe(saved, { source: 'prior', identity, body: 'earth' });
  assert.equal(recovered.restored, true); assert.equal(recovered.preferences.selectedCity, 'city-3');
  assert.equal(recovered.preferences.zoom, 1.7); assert.equal(recovered.preferences.worldSource, 'prior');
  const fresh = createWorldViewSession().observe(saved, { source: 'local', identity: localSimulationSnapshot(current).identity, body: 'earth' });
  assert.equal(fresh.restored, false); assert.equal(fresh.preferences.selectedCity, null);
  assert.equal(parseWorldSource('prior'), 'prior');
  assert.equal(new URL(worldSourceHref('https://example.test/?sample=1&other=keep', 'prior')).searchParams.get('world'), 'prior');
  assert.deepEqual(saved.worldViews?.[0]?.camera, camera);
});

void test('genesis provenance is strict, immutable across advancement, and never inferred from a mutable release label', () => {
  const current = createLocalSimulation();
  const identity = localSimulationSnapshot(current).identity;
  const advanced = advanceLocalSimulation(current, 1);
  assert.equal(localSimulationSnapshot(advanced).identity, identity);
  assert.ok(isWorldState(advanced.state));
  assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(advanced))), advanced);
  const unknown = structuredClone(current); Reflect.set(unknown.state.origin!, 'initialReleaseId', 'unknown-future-world');
  assert.equal(parseLocalSimulation(unknown), null);
  const prior = createLocalSimulation(1701, 'settlement-interplanetary-1');
  Reflect.set(prior.state.origin!, 'initialReleaseId', 'settlement-living-partnerships-1');
  assert.equal(parseLocalSimulation(prior), null);
});

void test('a recorded trade fair reaches the ordinary map stream without fabricating shipment cargo', () => {
  const stream = createCueStream();
  const initial = { identity: 'partnership-world', revision: 0, mode: 'baseline' as const, events: [], routes: [] };
  assert.deepEqual(stream.observe(initial, 3), { events: [], routeResults: [] });
  const event = { id: '1:0', round: 9, type: 'trade-fair', title: 'Aster hosts a trade fair', detail: 'Aster Hearth', actor: 5, target: 0, tileId: 77, cause: 'A real shipment arrived', effects: ['Credits 20 → 26', 'Food 40 → 36'], importance: 3 };
  const actual = stream.observe({ ...initial, mode: 'live', revision: 1, events: [event] }, 3);
  assert.equal(actual.events.length, 1);
  const cue = actual.events[0]; assert.ok(cue && 'cue' in cue);
  assert.equal(cue.eventId, event.id);
  assert.equal(cue.tileId, 77);
  assert.equal(cue.cue, 'status');
  assert.deepEqual(actual.routeResults, []);
  assert.deepEqual(stream.observe({ ...initial, mode: 'live', revision: 1, events: [event] }, 3), { events: [], routeResults: [] });
});

void test('actual Chronicle caller preserves same-world focus but replaces old-world cards and navigation across source or genesis', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('  const stories = state ? spectatorChronicle(state) : [];');
  const end = main.indexOf("  element('#connection-story')", start);
  assert.ok(start >= 0 && end > start);
  const branch = `{${main.slice(start, end)}}`;
  let focused = false;
  let renders = 0;
  let visible: string[] = [];
  let visibleIdentity = '';
  let navigateVisible = (): void => {};
  const navigations: string[] = [];
  const context = {
    state: { rows: ['old-city'] } as { rows: string[] } | null,
    worldSource: 'local', snapshot: { identity: 'genesis-a' } as { identity: string } | null,
    chronicleFingerprint: '', chronicleIdentity: '',
    document: { activeElement: {} },
    element: () => ({ contains: () => focused }),
    spectatorChronicle: (state: { rows: string[] }) => state.rows,
    navigateStory: (id: string) => navigations.push(id),
    renderSpectatorChronicle: (_host: unknown, stories: string[], navigate: (id: string) => void, identity: string) => {
      renders++; visible = [...stories]; visibleIdentity = identity;
      navigateVisible = () => { if (stories[0]) navigate(stories[0]); };
    },
  };
  const render = (): void => { runInNewContext(branch, context); };
  render(); assert.equal(renders, 1); assert.equal(visibleIdentity, 'local:genesis-a');
  focused = true; context.state = { rows: ['new-city'] };
  const before = JSON.stringify(context.state);
  render(); assert.equal(renders, 1); assert.deepEqual(visible, ['old-city']);
  context.snapshot = { identity: 'genesis-b' };
  render(); assert.equal(renders, 2); assert.deepEqual(visible, ['new-city']);
  assert.equal(visibleIdentity, 'local:genesis-b'); navigateVisible(); assert.deepEqual(navigations, ['new-city']);
  assert.equal(JSON.stringify(context.state), before);
  context.worldSource = 'prior';
  render(); assert.equal(renders, 3); assert.equal(visibleIdentity, 'prior:genesis-b');
  context.state = { rows: ['later-record'] };
  render(); assert.equal(renders, 3); assert.deepEqual(visible, ['new-city']);
  focused = false; render(); assert.equal(renders, 4); assert.deepEqual(visible, ['later-record']);
  focused = true; context.state = null; context.snapshot = null; context.worldSource = 'shared';
  render(); assert.equal(renders, 5); assert.deepEqual(visible, []); navigateVisible();
  assert.deepEqual(navigations, ['new-city']);
});
