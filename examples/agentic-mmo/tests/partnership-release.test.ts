import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isWorldState } from '../core/validation.ts';
import { advanceLocalSimulation, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, ACTIVE_LOCAL_RELEASE_ID } from '../web/local-simulation.ts';
import { createWorldViewSession, saveWorldView, worldViewKey } from '../web/world-view.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { createCueStream } from '../web/world-cues.ts';

void test('fresh current genesis enables registered partnership rules before any earned progress', () => {
  const current = createLocalSimulation(1701);
  assert.equal(current.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(current.state.unlockedFeatures.includes('partnership-stewardship'));
  assert.ok(current.state.unlockedFeatures.includes('historical-pressures'));
  assert.equal(current.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.deepEqual(current, createLocalSimulation(1701));
  assert.ok(current.state.cities.every(city => city.buildings.length === 0));
  assert.ok(current.state.civilizations.every(civilization => civilization.technologies.length === 0));
});

void test('same current world restores its local camera while another genesis inherits no selection', () => {
  const current = createLocalSimulation(1701);
  const camera = { zoom: 1.7, x: 12, z: -8, selected: 3, selectedCity: 'city-3' };
  const identity = localSimulationSnapshot(current).identity;
  const saved = saveWorldView(DEFAULT_PREFERENCES, { source: 'local', identity, body: 'earth' }, camera);
  const recovered = createWorldViewSession().observe(saved, { source: 'local', identity, body: 'earth' });
  assert.equal(recovered.restored, true); assert.equal(recovered.preferences.selectedCity, 'city-3');
  assert.equal(recovered.preferences.zoom, 1.7); assert.equal(recovered.preferences.worldSource, 'local');
  const fresh = createWorldViewSession().observe(saved, { source: 'local', identity: localSimulationSnapshot(createLocalSimulation(1702)).identity, body: 'earth' });
  assert.equal(fresh.restored, false); assert.equal(fresh.preferences.selectedCity, null);
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
  const mismatched = structuredClone(current);
  mismatched.state.origin!.initialReleaseId = 'settlement-living-partnerships-1';
  assert.equal(parseLocalSimulation(mismatched), null);
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

void test('actual Chronicle caller preserves same-world focus but replaces old-world cards and navigation across source genesis or body', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('  const stories = state ? spectatorChronicle(state) : [];');
  const end = main.indexOf("  element('#connection-story')", start);
  assert.ok(start >= 0 && end > start);
  const keyStart = main.indexOf('function observedWorldKey(): string {');
  const keyEnd = main.indexOf('\n}', keyStart) + 2;
  assert.ok(keyStart >= 0 && keyEnd > keyStart);
  const keyHelper = main.slice(keyStart, keyEnd).replace('(): string', '()');
  const branch = `${keyHelper}\n{${main.slice(start, end)}}`;
  let focused = false;
  let renders = 0;
  let visible: string[] = [];
  let visibleIdentity = '';
  let navigateVisible = (): void => {};
  const navigations: string[] = [];
  const context = {
    state: { rows: ['old-city'] } as { rows: string[] } | null,
    worldSource: 'local', worldBody: 'earth', worldViewKey, snapshot: { identity: 'genesis-a' } as { identity: string } | null,
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
  render(); assert.equal(renders, 1); assert.deepEqual(JSON.parse(visibleIdentity), ['local', 'genesis-a', 'earth']);
  focused = true; context.state = { rows: ['new-city'] };
  const before = JSON.stringify(context.state);
  render(); assert.equal(renders, 1); assert.deepEqual(visible, ['old-city']);
  context.snapshot = { identity: 'genesis-b' };
  render(); assert.equal(renders, 2); assert.deepEqual(visible, ['new-city']);
  assert.deepEqual(JSON.parse(visibleIdentity), ['local', 'genesis-b', 'earth']); navigateVisible(); assert.deepEqual(navigations, ['new-city']);
  assert.equal(JSON.stringify(context.state), before);
  context.worldSource = 'shared';
  render(); assert.equal(renders, 3); assert.deepEqual(JSON.parse(visibleIdentity), ['shared', 'genesis-b', 'earth']);
  context.state = { rows: ['later-record'] };
  render(); assert.equal(renders, 3); assert.deepEqual(visible, ['new-city']);
  focused = false; render(); assert.equal(renders, 4); assert.deepEqual(visible, ['later-record']);
  focused = true; context.worldBody = 'mars';
  render(); assert.equal(renders, 5); assert.deepEqual(visible, ['later-record']);
  assert.deepEqual(JSON.parse(visibleIdentity), ['shared', 'genesis-b', 'mars']);
  context.state = { rows: ['new-mars-record'] };
  render(); assert.equal(renders, 5); assert.deepEqual(visible, ['later-record']);
  context.state = null; context.snapshot = null; context.worldSource = 'shared';
  render(); assert.equal(renders, 6); assert.deepEqual(visible, []); navigateVisible();
  assert.deepEqual(navigations, ['new-city']);
});
