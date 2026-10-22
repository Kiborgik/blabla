import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { allocateOperations, emitOperations } from '../core/simulation/operations.ts';
import { recordLocalPower } from '../core/simulation/local-power.ts';
import { commitEvents } from '../core/simulation/events.ts';
import type { GameEvent, Resources } from '../core/types.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import { LOCAL_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, advanceLocalSimulation, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, parsePreviousLocalSimulation } from '../web/local-simulation.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

const epoch = '2000-01-01T00:00:00.000Z';

function completedTechnologies(targets: string[]): string[] {
  const completed: string[] = [];
  const visit = (id: string): void => { if (completed.includes(id)) return; const technology = TECHNOLOGIES.find(item => item.id === id); assert.ok(technology); technology.requires.forEach(visit); completed.push(id); };
  targets.forEach(visit);
  return completed;
}

await test('paid rail endpoints can share an earned wonder hex without replacing its exclusive footprint', () => {
  let state = createLocalSimulation().state;
  const actor = state.civilizations[0]!;
  actor.technologies = completedTechnologies(['steam-power', 'writing']); actor.era = 2;
  actor.resources = Object.fromEntries(RESOURCE_IDS.map(id => [id, 1000])) as Resources;
  actor.strategicResources = { iron: 30, coal: 30 };
  assert.ok(isWorldState(state));
  const option = legalActions(state, 0, epoch).find(candidate => candidate.action.type === 'build-wonder');
  assert.ok(option?.action.type === 'build-wonder');
  const start = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: option.action });
  assert.ok(start.ok, start.error); state = start.state;
  for (let round = 1; !state.wonders?.['great-library'] && round <= 40; round += 1) {
    const result = catchUpStrategy(state, new Date(Date.parse(epoch) + round * 60_000).toISOString());
    assert.ok(result.ok, result.error); state = result.state;
  }
  const wonder = state.wonders?.['great-library']?.completion; assert.ok(wonder);
  assert.deepEqual(wonder.paid, { materials: 50, credits: 25 });
  assert.ok(isWorldState(state));
  const timestamp = new Date(Date.parse(epoch) + state.round * 60_000 + 10_000).toISOString();
  const rail = legalActions(state, 0, timestamp).find(candidate => candidate.action.type === 'build-rail' && Math.min(candidate.action.fromTileId, candidate.action.toTileId) === wonder.tileId);
  assert.ok(rail?.action.type === 'build-rail');
  const action = rail.action;
  const placed = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action });
  assert.ok(placed.ok, placed.error);
  assert.ok(isWorldState(placed.state), 'A linear edge is not an exclusive site occupation');
  const active = placed.state.cities.find(city => city.id === action.cityId)?.construction?.active;
  assert.ok(active && 'kind' in active && active.kind === 'rail');
  assert.equal(active.tileId, wonder.tileId);
  assert.deepEqual(active.strategicPaid, { iron: 1, coal: 1 });
  assert.deepEqual(placed.state.wonders, state.wonders);
  const resumed = catchUpStrategy(JSON.parse(JSON.stringify(placed.state)), new Date(Date.parse(epoch) + (state.round + 3) * 60_000).toISOString());
  assert.ok(resumed.ok, resumed.error); assert.ok(isWorldState(resumed.state));
  assert.ok(resumed.state.railEdges?.[active.edgeId]);
  const collided = structuredClone(placed.state);
  const other = collided.cities[0]!;
  other.districtSites = { campus: wonder.tileId }; other.buildings.push('campus');
  assert.equal(isWorldState(collided), false, 'Exclusive district and wonder occupancy remains forbidden');
});

await test('generated default and frozen prior local checkpoint have separate identities and storage without migration', () => {
  let state = createWorld(1701, epoch);
  for (const release of RELEASES.slice(1, -1)) { const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch }); assert.ok(result.ok, result.error); state = result.state; }
  const previous = { version: 1, source: 'local-procedural', policyVersion: 'weighted-civilizations-v1', seed: 1701, timestamp: epoch, steps: 0, state, memories: Array(6).fill(null), decisions: [] };
  const bytes = JSON.stringify(previous);
  const parsed = parsePreviousLocalSimulation(JSON.parse(bytes)); assert.ok(parsed);
  const current = createLocalSimulation();
  assert.equal(current.version, 2);
  assert.equal(current.policyVersion, 'weighted-civilizations-v2');
  assert.ok(current.state.origin);
  assert.equal(current.state.height, 24);
  assert.notEqual(LOCAL_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY);
  assert.notEqual(localSimulationSnapshot(current).identity, localSimulationSnapshot(parsed).identity);
  assert.equal(parseLocalSimulation(previous), null);
  assert.equal(parsePreviousLocalSimulation(current), null);
  assert.equal(processLocalSimulationRequest({ id: 1, run: previous, steps: 1 }).ok, false);
  assert.equal(JSON.stringify(previous), bytes);
  assert.equal(JSON.stringify(parsed), bytes);
  const progressed = advanceLocalSimulation(current, 2);
  assert.equal(localSimulationSnapshot(current).identity, localSimulationSnapshot(progressed).identity);
  assert.ok(isWorldState(progressed.state));
});

await test('unknown generator origins and relabelled policy or timeline cannot replace a saved world', () => {
  const run = createLocalSimulation();
  for (const mutate of [
    (value: typeof run) => { Reflect.set(value.state.origin!, 'generatorVersion', 'unimplemented-future-generator'); },
    (value: typeof run) => { value.state.origin!.seed += 1; },
    (value: typeof run) => { value.state.origin!.clockEpoch = '2001-01-01T00:00:00.000Z'; },
    (value: typeof run) => { value.policyVersion = 'weighted-civilizations-v1'; },
    (value: typeof run) => { value.timestamp = '2001-01-01T00:00:00.000Z'; },
  ]) { const changed = structuredClone(run); mutate(changed); assert.equal(parseLocalSimulation(changed), null); }
});

await test('synthetic preflight with real paid missions retains terminal economy checkpoint in the actual Worker', () => {
  const run = createLocalSimulation(); const state = run.state;
  const civ = state.civilizations[0]!; const city = state.cities[0]!;
  civ.technologies = completedTechnologies(['spaceflight']); civ.era = 5;
  civ.resources = Object.fromEntries(RESOURCE_IDS.map(id => [id, 1000])) as Resources;
  civ.strategicResources = { coal: 100 }; city.population = 15;
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'); assert.ok(site);
  city.buildings = ['industrial-zone', 'coal-plant', 'launchpad']; city.districtSites = { 'industrial-zone': site.id };
  city.buildingOperations = Object.fromEntries(['coal-plant', 'launchpad'].map(id => [id, { enabled: true, lastResult: null }]));
  state.revision += 1; const operations: GameEvent[] = [];
  allocateOperations(state); emitOperations(state, city, operations); recordLocalPower(state, city, operations); commitEvents(state, operations);
  const depart = (mission: 'settle' | 'resupply'): void => {
    const action = { type: 'expedition' as const, cityId: city.id, mission };
    const result = applyCommand(run.state, { seat: 0, expectedRevision: run.state.revision, timestamp: run.timestamp, action, observedRevision: run.state.revision, plan: [{ action, reason: 'Explicit synthetic integration preflight; real paid mission command' }] });
    assert.ok(result.ok, result.error); run.state = result.state;
  };
  depart('settle');
  for (let round = 1; round <= 9; round += 1) {
    run.steps = round * 6; run.timestamp = new Date(Date.parse(epoch) + run.steps * 10_000).toISOString();
    const strategic = catchUpStrategy(run.state, run.timestamp); assert.ok(strategic.ok, strategic.error); run.state = strategic.state;
    if (round === 4) depart('resupply');
    assert.ok(isWorldState(run.state), `Valid synthetic round ${round}`);
  }
  assert.equal(run.state.outcome, null);
  assert.equal(run.state.civilizations[0]!.marsSupplyStreak, 2);
  const reply = processLocalSimulationRequest({ id: 99, run, steps: 6 });
  assert.ok(reply.ok, 'The terminal strategic result must not be discarded by a subsequent rejected clock catchup');
  assert.equal(reply.run.state.outcome?.kind, 'mars');
  assert.deepEqual(reply.run.state.outcome?.winners, [0]);
  assert.equal(reply.run.state.civilizations[0]!.marsSupplyStreak, 3);
  assert.ok(parseLocalSimulation(JSON.parse(JSON.stringify(reply.run))));
  assert.deepEqual(advanceLocalSimulation(reply.run, 6), reply.run);
});
