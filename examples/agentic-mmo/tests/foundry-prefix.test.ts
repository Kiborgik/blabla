import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions } from '../core/engine.ts';
import { strategicCapacity } from '../core/simulation/metals.ts';
import { isWorldState } from '../core/validation.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { foundryPrefix } from './fixtures/foundry-prefix.ts';

const prefix = foundryPrefix();

await test('fresh Foundry scenario declares synthetic prerequisites before actual paid Industrial zone construction', () => {
  const { state, seat, cityId, industrialTileId } = prefix;
  const civ = state.civilizations[seat]; const city = state.cities.find(candidate => candidate.id === cityId);
  assert.ok(civ && city); assert.equal(civ.era, 2); assert.equal(city.civId, seat);
  assert.equal(city.districtSites?.['industrial-zone'], industrialTileId);
  assert.ok(city.buildings.includes('industrial-zone')); assert.equal(city.construction?.active ?? null, null);
  for (const technology of ['engineering', 'apprenticeship', 'iron-working', 'machinery', 'construction']) assert.ok(civ.technologies.includes(technology));
  assert.ok(civ.resources.materials >= 36 && civ.resources.credits >= 20 && civ.resources.energy >= 1);
  assert.equal(state.tiles.find(tile => tile.id === industrialTileId)?.owner, seat);
  assert.equal(prefix.initial.releaseId, 'settlement-foundry-1'); assert.equal(prefix.initial.revision, 0);
  assert.ok(prefix.initial.civilizations[seat]?.technologies.includes('apprenticeship'));
  assert.equal(prefix.initial.cities.find(candidate => candidate.id === cityId)?.buildings.includes('industrial-zone'), false);
  assert.ok(prefix.steps.some(step => step.input.kind === 'action' && step.input.command.action.type === 'build' && step.input.command.action.project === 'industrial-zone' && step.input.command.action.cityId === cityId));
  assert.ok(isWorldState(state));
});

await test('actual extracted iron fills the consenting recipient and a later complete exchange refuses for storage', () => {
  const { state, seat, routeId, donorSeat, mineTileId, beforeBlockedExchange, blockedExchangeStep } = prefix;
  const route = state.routes.find(candidate => candidate.id === routeId); assert.ok(route?.agreement);
  assert.equal(route.owner, donorSeat); assert.equal(route.partner, seat);
  assert.deepEqual(route.agreement.terms.strategicCargo, { proposer: { iron: 2 }, recipient: {} });
  assert.equal(state.civilizations[seat]?.strategicResources?.iron, strategicCapacity(state, seat));
  assert.ok((route.agreement.deliveryCount ?? 0) > 0); assert.match(route.agreement.blockedReason ?? '', /storage full/i);
  assert.equal(route.agreement.blockedBy, seat);
  assert.equal(route.agreement.enabled, true);
  assert.equal(Object.values(state.cities.find(city => city.id === prefix.cityId)?.improvements ?? {}).some(improvement => improvement.improvementId === 'mine'), false);
  const extraction = prefix.steps.flatMap(step => step.result.events).filter(event => event.strategicExtraction?.tileId === mineTileId).reduce((sum, event) => sum + (event.strategicExtraction?.quantity ?? 0), 0);
  assert.equal(extraction, (state.civilizations[donorSeat]?.strategicResources?.iron ?? 0) + (state.civilizations[seat]?.strategicResources?.iron ?? 0));
  assert.ok((state.strategicDeposits?.deposits[String(mineTileId)]?.remaining ?? 240) < 240);
  assert.equal(beforeBlockedExchange.routes.find(candidate => candidate.id === routeId)?.agreement?.deliveryCount, route.agreement.deliveryCount);
  assert.deepEqual(replayCoastalStep(beforeBlockedExchange, blockedExchangeStep.input), blockedExchangeStep.result);
  assert.equal(blockedExchangeStep.result.events.some(event => event.strategicShipment?.routeId === routeId), false);
});

await test('synthetic no-route equal-beat control isolates complete zero payment at the real storage blocker', () => {
  const control = structuredClone(prefix.beforeBlockedExchange);
  control.routes = control.routes.filter(route => route.id !== prefix.routeId);
  const result = replayCoastalStep(control, prefix.blockedExchangeStep.input); assert.ok(result.ok, result.error);
  for (const civ of prefix.state.civilizations) {
    assert.deepEqual(result.state.civilizations[civ.id]?.resources, civ.resources);
    assert.deepEqual(result.state.civilizations[civ.id]?.strategicResources, civ.strategicResources);
  }
  assert.deepEqual(result.state.strategicDeposits, prefix.state.strategicDeposits);
});

await test('fresh Foundry rules allow Military engineering but unmet later discoveries and Foundry refuse without mutation', () => {
  const { state, seat, cityId, timestamp } = prefix; const before = structuredClone(state);
  assert.ok(legalActions(state, seat, timestamp).some(option => option.action.type === 'research' && option.action.technology === 'military-engineering'));
  const selected = applyCommand(state, { seat, expectedRevision: state.revision, timestamp, action: { type: 'research', technology: 'military-engineering' } });
  assert.ok(selected.ok, selected.error); assert.equal(selected.state.civilizations[seat]?.researchTarget, 'military-engineering'); assert.deepEqual(state, before);
  for (const action of [{ type: 'research', technology: 'gunpowder' }, { type: 'research', technology: 'metal-casting' }, { type: 'build', project: 'foundry', cityId }] as const) {
    assert.equal(legalActions(state, seat, timestamp).some(option => JSON.stringify(option.action) === JSON.stringify(action)), false);
    const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp, action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(state, before);
  }
});

await test('actual Foundry prerequisite frames replay from declared synthetic inputs without mutation', () => {
  let state = structuredClone(prefix.initial);
  for (const step of prefix.steps) {
    assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, step.input);
    assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); assert.deepEqual(state, before); assert.ok(isWorldState(result.state)); state = result.state;
  }
  assert.deepEqual(state, prefix.state);
});
