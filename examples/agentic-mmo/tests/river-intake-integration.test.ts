import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { drainageFacts } from '../core/drainage.ts';
import { RESIDENT_CAPACITY_RULES } from '../core/content.ts';
import { RIVER_INTAKE_RULES } from '../core/river-intake-content.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, parseLocalSimulation, advanceLocalSimulation } from '../web/local-simulation.ts';
import { projectWorld } from '../web/live-world.ts';
import { riverIntakeWorking } from '../visuals/river-intake-visuals.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
function freshEngineFixture() {
  const state = createGeneratedWorld(1701, epoch, RIVER_INTAKE_RULES.releaseId);
  const facts = drainageFacts(state.drainage!, state.tiles);
  const pair = state.cities.flatMap(city => state.tiles.filter(tile => tile.id !== city.tileId && !state.cities.some(other => other.tileId === tile.id) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && facts[tile.id]!.contributingLandTiles >= 8 && hexDistance(tile, state.tiles.find(value => value.id === city.tileId)!) <= 3).map(tile => ({ city, tile }))).at(0);
  assert.ok(pair); pair.tile.owner = pair.city.civId;
  syntheticTechnologies(state, pair.city.civId, ['water-management']); syntheticInstitution(state, pair.city.id, 'irrigation');
  pair.city.population = RESIDENT_CAPACITY_RULES.communityReserve + RESIDENT_CAPACITY_RULES.perPaidRecipe + RIVER_INTAKE_RULES.residentsPerOperation; pair.city.wellbeing = 50; pair.city.infrastructure = 0; pair.city.focus = 'research';
  const actor = state.civilizations.find(actor => actor.id === pair.city.civId)!; actor.resources.materials = 100; actor.resources.credits = 100; actor.resources.food = 100;
  assert.ok(isWorldState(state));
  return { state, cityId: pair.city.id, tileId: pair.tile.id, civId: pair.city.civId };
}


function operatingWorld() {
  const fixture = freshEngineFixture(); const { cityId, tileId, civId } = fixture;
  const first = applyCommand(fixture.state, { seat: civId, expectedRevision: fixture.state.revision, timestamp: at(20), action: { type: 'improve', cityId, improvementId: 'river-intake', tileId } }); assert.ok(first.ok, first.error);
  let state = first.state;
  for (let beat = 0; beat < 8; beat++) {
    const next = catchUpStrategy(state, at(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(next.ok, next.error); state = next.state;
    if (state.cities.find(city => city.id === cityId)!.improvements?.[String(tileId)]?.operation.lastResult?.status === 'operated') { assert.ok(isWorldState(state)); return { state, cityId, tileId }; }
  }
  assert.fail('bounded paid engine fixture must reach an actual funded intake season');
}

void test('current-only local genesis retains fresh intake facts and exact same-version controller restart', () => {
  const run = createLocalSimulation(1701); assert.equal(run.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(LOCAL_SIMULATION_STORAGE_KEY.startsWith('civitas:procedural-observatory:'));
  assert.equal(run.state.origin!.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID); assert.deepEqual(run.state.riverFlow, { ruleVersion: 1, ruleId: 'uniform-runoff-1', lastBeat: null });
  assert.ok(run.state.cities.every(city => !Object.values(city.improvements ?? {}).some(site => site.improvementId === 'river-intake')));
  assert.deepEqual(run.state.events.map(event => event.type), ['world-founded']);
  const progressed = advanceLocalSimulation(run, 6); const restored = parseLocalSimulation(JSON.parse(JSON.stringify(progressed))); assert.ok(restored);
  assert.deepEqual(advanceLocalSimulation(restored, 2), advanceLocalSimulation(progressed, 2));
  const invalid = structuredClone(progressed); invalid.state.riverFlow!.ruleId = 'unregistered' as 'uniform-runoff-1'; const before = JSON.stringify(invalid);
  assert.equal(parseLocalSimulation(invalid), null); assert.equal(JSON.stringify(invalid), before);
});

void test('actual engine paid receipt projects exact channel and current activity without mutating historical facts', () => {
  const { state, cityId, tileId } = operatingWorld(); const before = structuredClone(state);
  const world = projectWorld(state); const view = world.improvements!.find(site => site.cityId === cityId && site.tileId === tileId)!; assert.ok(view);
  assert.equal(view.riverIntake!.edge.fromTileId, tileId); assert.equal(view.riverIntake!.edge.toTileId, state.drainage!.downstreamTileIds[tileId]);
  assert.ok(view.riverIntake!.receiptCurrent); assert.ok(riverIntakeWorking(view)); assert.deepEqual(world.riverFlow, state.riverFlow!.lastBeat);
  assert.deepEqual(state, before);
  for (const change of ['paused', 'support', 'owner', 'stale', 'terminal', 'zero', 'forged-event', 'duplicate'] as const) {
    const copy: WorldState = structuredClone(state); const city = copy.cities.find(city => city.id === cityId)!; const site = city.improvements![String(tileId)]!;
    if (change === 'paused') site.operation.enabled = false;
    if (change === 'support') city.buildingOperations!.irrigation!.enabled = false;
    if (change === 'owner') copy.tiles.find(tile => tile.id === tileId)!.owner = (city.civId + 1) % 5;
    if (change === 'stale') copy.round++;
    if (change === 'terminal') copy.outcome = { winners: [city.civId], kind: 'mars', round: copy.round, reason: 'Synthetic terminal observer boundary' };
    if (change === 'zero') site.operation.lastResult!.produced.food = 0;
    if (change === 'forged-event') copy.riverFlow!.lastBeat!.eventId = '999999:1';
    if (change === 'duplicate') copy.riverFlow!.lastBeat!.withdrawals.push({ ...copy.riverFlow!.lastBeat!.withdrawals[0]! });
    const pinned = structuredClone(copy); const projected = projectWorld(copy).improvements!.find(value => value.cityId === cityId && value.tileId === tileId)!;
    assert.equal(riverIntakeWorking(projected), false, change); assert.deepEqual(copy, pinned);
  }
});
