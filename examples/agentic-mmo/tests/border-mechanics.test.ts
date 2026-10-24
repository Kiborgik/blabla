import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BorderDepartureAction } from '../core/border-types.ts';
import { BORDER_RULES } from '../core/border-content.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { availableBorderActions, borderActionFailure, borderDealFailure, borderFieldPopulation, borderPromisedResources, borderReturnReservations, quoteBorderDeparture } from '../core/simulation/border-incidents.ts';
import { borderSiteReferences, borderTargetFailure } from '../core/simulation/border-sites.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { createCoalDeposits, createStrategicDeposits } from '../core/simulation/metals.ts';
import { createPastoralSites } from '../core/simulation/pastoral.ts';
import { randomStep } from '../core/simulation/random.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { borderAction, borderBeat, borderEngineAction, borderTargetTileId, borderTimestamp, DEFENDER, dispatchBorder, INITIATOR, syntheticBorderCorridor } from './fixtures/border-current.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const city = (state: WorldState, id = INITIATOR) => state.cities.find(city => city.civId === id)!;
const active = (state: WorldState) => { const incident = state.border?.active[0]; assert.ok(incident); return incident; };
const dispatch = (state: WorldState, people: 2 | 3 = 2): BorderDepartureAction => ({ type: 'dispatch-border', sourceCityId: city(state).id, tileId: borderTargetTileId(state), people });
function quote(state: WorldState, people: 2 | 3 = 2) { const result = quoteBorderDeparture(state, INITIATOR, dispatch(state, people)); assert.ok(result.ok, result.ok ? undefined : result.reason); return result.quote; }
function finish(state: WorldState): void { for (let count = 0; count < 8 && state.border!.active.length; count++) borderBeat(state); assert.equal(state.border!.active.length, 0); }
function trade(state: WorldState, recipeId = 'harvest-for-materials'): void {
  borderEngineAction(state, INITIATOR, { type: 'propose-trade', partner: DEFENDER, recipeId, sourceCityId: city(state).id, recipientCityId: city(state, DEFENDER).id });
  borderEngineAction(state, DEFENDER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
}

test('pure exact departure quote separates setup, field cargo, settled household reserve and protected promises', () => {
  const state = syntheticBorderCorridor(); const before = structuredClone(state); const result = quote(state);
  assert.deepEqual(state, before);
  assert.deepEqual(result.totalCost, { materials: 6, credits: 4, food: 20 });
  assert.deepEqual(result.householdReserve, { food: 10 });
  assert.deepEqual(result.promised, {}); assert.deepEqual(result.promisedStrategic, {});
  assert.equal(result.pathTileIds.length, 4); assert.equal(result.sourcePopulationAfter, 4); assert.equal(result.legitimacyCost, 3);
  assert.equal(result.returnByRound, state.round + 8);
});

test('dispatch removes actual residents and pays once while duplicate and malformed actions change nothing', () => {
  const state = syntheticBorderCorridor(); const stock = { ...state.civilizations[0]!.resources }; const legitimacy = state.civilizations[0]!.legitimacy;
  dispatchBorder(state);
  assert.equal(city(state).population, 4); assert.equal(borderFieldPopulation(state, INITIATOR), 2); assert.equal(borderReturnReservations(state, city(state).id), 2);
  assert.equal(cityGrowthFacts(state, city(state)).capacity, 20);
  assert.equal(state.civilizations[0]!.resources.food, stock.food - 20); assert.equal(state.civilizations[0]!.resources.materials, stock.materials - 6); assert.equal(state.civilizations[0]!.resources.credits, stock.credits - 4); assert.equal(state.civilizations[0]!.legitimacy, legitimacy - 3);
  assert.equal(active(state).initiator.pathIndex, 0);
  const before = structuredClone(state);
  assert.ok(borderActionFailure(state, INITIATOR, dispatch(state)));
  const malformed = JSON.parse(JSON.stringify({ ...dispatch(state), ignoredPayment: true }));
  assert.match(borderActionFailure(state, INITIATOR, malformed) ?? '', /shape/);
  const refused = applyCommand(state, { seat: INITIATOR, expectedRevision: state.revision, timestamp: borderTimestamp(state, INITIATOR), action: malformed });
  assert.equal(refused.ok, false); assert.deepEqual(state, before); assert.deepEqual(refused.state, before);
});

test('one edge per beat, r plus two expiry, fixed capture and physical return preserve the original purchase', () => {
  const state = syntheticBorderCorridor(); const target = borderTargetTileId(state); const purchase = structuredClone(state.tileAcquisitions![String(target)]); const id = dispatchBorder(state).id;
  borderBeat(state); assert.equal(active(state).initiator.pathIndex, 1); assert.equal(active(state).response, 'pending');
  assert.ok(availableBorderActions(state, DEFENDER).some(option => option.action.type === 'respond-border'));
  borderBeat(state); assert.equal(active(state).response, 'yield'); assert.equal(active(state).responseRound, 2); assert.ok(active(state).responseEventId);
  assert.equal(availableBorderActions(state, DEFENDER).some(option => option.action.type === 'respond-border'), false);
  borderBeat(state); assert.equal(active(state).initiator.phase, 'holding');
  borderBeat(state); assert.equal(active(state).resolution, null);
  borderBeat(state); assert.equal(active(state).resolution?.outcome, 'captured'); assert.equal(state.tiles[target]!.owner, INITIATOR);
  assert.deepEqual(state.tileAcquisitions![String(target)], purchase); assert.equal(state.border!.controls[String(target)]!.purchaseId, purchase!.id);
  assert.equal(state.border!.pairProtectionUntil['0:1'], 17); assert.equal(state.border!.siteProtectionUntil[String(target)], 17);
  finish(state); assert.equal(state.round, 8); assert.equal(city(state).population, 6); assert.equal(borderFieldPopulation(state, INITIATOR), 0);
  const result = state.border!.lastResults.at(-1)!; assert.equal(result.incident.id, id); assert.equal(result.incident.initiator.steps.length, 8); assert.equal(result.incident.initiator.returned!.foodRefunded, 0);
  assert.equal(city(state).lastFoodSupply!.population, 4); assert.equal(city(state).lastFoodSupply!.required, 5);
  assert.equal(state.border!.initiationCooldownUntil[INITIATOR], 16); assert.equal(state.border!.dealCooldownUntil['0:1'], 14); assert.ok(borderDealFailure(state, INITIATOR, DEFENDER));
});

test('a funded defender needs no Civic institutions and a seeded clash loses at most one real resident', () => {
  const state = syntheticBorderCorridor(); state.civilizations[DEFENDER]!.technologies = state.civilizations[DEFENDER]!.technologies.filter(id => id !== 'civic-institutions'); assert.ok(isWorldState(state));
  const id = dispatchBorder(state, 3).id;
  const legitimacy = state.civilizations[DEFENDER]!.legitimacy;
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: id, response: 'defend', sourceCityId: city(state, DEFENDER).id, people: 2 });
  assert.equal(city(state, DEFENDER).population, 4); assert.equal(state.civilizations[DEFENDER]!.legitimacy, legitimacy);
  for (let beat = 0; beat < 5; beat++) borderBeat(state);
  const resolution = active(state).resolution!; const clash = resolution.clash!; assert.ok(clash);
  assert.equal(clash.defenderPower, 3); assert.equal(clash.initiatorPower, 3); assert.deepEqual(randomStep(clash.seedBefore), { seed: clash.seedAfter, value: clash.roll });
  assert.equal(active(state).initiator.casualties + active(state).defender!.casualties, 1);
  finish(state); assert.equal(city(state).population + city(state, DEFENDER).population, 11);
  for (const party of [state.border!.lastResults[0]!.incident.initiator, state.border!.lastResults[0]!.incident.defender!]) assert.equal(party.departure.cargo.food, party.foodConsumed + party.returned!.foodRefunded);
  assert.equal(state.border!.lastResults[0]!.incident.initiator.returned!.foodRefunded + state.border!.lastResults[0]!.incident.defender!.returned!.foodRefunded, 3.75);
});

test('explicit yield is unpaid and withdrawal reverses only the actually travelled prefix', () => {
  const state = syntheticBorderCorridor(); const id = dispatchBorder(state).id; const defender = structuredClone(state.civilizations[DEFENDER]);
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: id, response: 'yield' }); assert.deepEqual(state.civilizations[DEFENDER], defender);
  borderBeat(state); borderBeat(state); const position = active(state).initiator.positionTileId;
  borderAction(state, INITIATOR, { type: 'withdraw-border', incidentId: id }); assert.equal(active(state).initiator.positionTileId, position); assert.equal(active(state).resolution!.clash, null);
  finish(state); const party = state.border!.lastResults[0]!.incident.initiator;
  assert.equal(state.round, 4); assert.deepEqual(party.steps.map(step => step.phase), ['outbound', 'outbound', 'returning', 'returning']); assert.equal(party.returned!.foodRefunded, 10); assert.equal(city(state).population, 6);
  const stock = state.civilizations[0]!.resources.food; borderBeat(state); assert.equal(state.events.filter(event => event.type === 'border-return' && event.detail === id).length, 1); assert.notEqual(state.civilizations[0]!.resources.food, stock + 10);
});

test('withdrawal at the source waits a real beat and still consumes one field meal before returning', () => {
  const state = syntheticBorderCorridor(); const id = dispatchBorder(state).id;
  borderAction(state, INITIATOR, { type: 'withdraw-border', incidentId: id }); assert.equal(city(state).population, 4); assert.equal(active(state).initiator.returned, null);
  borderBeat(state); const party = state.border!.lastResults[0]!.incident.initiator;
  assert.equal(party.steps.length, 1); assert.equal(party.steps[0]!.fromTileId, party.steps[0]!.toTileId); assert.equal(party.foodConsumed, 2.5); assert.equal(party.returned!.foodRefunded, 17.5);
});

test('an independently withdrawing defender can return before the later resolution event in the same round', () => {
  const state = syntheticBorderCorridor(); const id = dispatchBorder(state).id; borderBeat(state);
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: id, response: 'defend', sourceCityId: city(state, DEFENDER).id, people: 2 });
  borderBeat(state); borderBeat(state);
  borderAction(state, DEFENDER, { type: 'withdraw-border', incidentId: id }); assert.ok(borderActionFailure(state, DEFENDER, { type: 'withdraw-border', incidentId: id }));
  borderBeat(state); const events = borderBeat(state);
  const returned = events.findIndex(event => event.border?.kind === 'return' && event.border.partyId.endsWith(':defender'));
  const resolved = events.findIndex(event => event.border?.kind === 'resolution');
  assert.ok(returned >= 0 && resolved > returned); assert.equal(active(state).defender!.returned!.round, 5); assert.equal(active(state).resolution!.clash, null); assert.ok(isWorldState(state));
  finish(state); assert.equal(city(state).population + city(state, DEFENDER).population, 12);
});

test('recorded adjacent return corridors remain traversable after ownership changes without teleportation', () => {
  const state = syntheticBorderCorridor(); dispatchBorder(state); for (let beat = 0; beat < 5; beat++) borderBeat(state);
  const path = [...active(state).initiator.departure.pathTileIds]; state.tiles[path[2]!]!.owner = 2;
  borderBeat(state); assert.equal(active(state).initiator.positionTileId, path[2]); assert.equal(active(state).initiator.phase, 'returning');
  finish(state); assert.deepEqual(state.border!.lastResults[0]!.incident.initiator.steps.slice(-3).map(step => step.toTileId), [path[2], path[1], path[0]]);
});

test('a real paid improvement reservation cancels capture and the party returns its actual path', () => {
  const state = syntheticBorderCorridor(); dispatchBorder(state); borderBeat(state);
  borderEngineAction(state, DEFENDER, { type: 'improve', cityId: city(state, DEFENDER).id, tileId: borderTargetTileId(state), improvementId: 'mine' });
  assert.ok(borderSiteReferences(state, borderTargetTileId(state)).length);
  borderBeat(state); assert.equal(state.border!.active.length, 0); const result = state.border!.lastResults[0]!.incident;
  assert.equal(result.resolution!.outcome, 'cancelled'); assert.equal(result.resolution!.round, result.initiator.returned!.round); assert.equal(result.initiator.steps.at(-1)!.phase, 'returning'); assert.equal(state.tiles[borderTargetTileId(state)]!.owner, DEFENDER);
});

test('pure synthetic reference shapes exclude installed support, reserved Rail and owned support cut vertices, not ordinary corridors', () => {
  const state = syntheticBorderCorridor(); const target = borderTargetTileId(state); const defender = city(state, DEFENDER);
  assert.equal(borderTargetFailure(state, INITIATOR, city(state).id, target), null);
  defender.buildingHighGround = { observatory: { campusTileId: defender.tileId, sourceTileId: target } }; assert.match(borderSiteReferences(state, target).join(' '), /high ground/);
  delete defender.buildingHighGround;
  defender.construction = { active: { kind: 'rail', ruleVersion: 1, id: 'synthetic-reference-only', cityId: defender.id, edgeId: 'synthetic-edge', tileId: target, toTileId: defender.tileId, startedRound: state.round, paid: {}, strategicPaid: {}, workRequired: 1, workDone: 0 }, lastCompleted: null };
  assert.match(borderSiteReferences(state, target).join(' '), /Rail|construction/); defender.construction.active = null;
  const beyond = state.tiles.find(tile => tile.q === 4 && tile.r === 3)!; beyond.owner = DEFENDER; defender.districtSites = { campus: beyond.id };
  assert.match(borderSiteReferences(state, target).join(' '), /Owned connection/);
  delete defender.districtSites; assert.equal(borderSiteReferences(state, target).length, 0);
});

test('ordinary accepted trade protects every due cadence and continues through the finite incident', () => {
  const state = syntheticBorderCorridor(); trade(state); const agreement = state.routes[0]!.agreement!;
  const count = 1 + Math.floor((state.round + 8 - agreement.nextDeliveryRound) / agreement.terms.cadenceRounds);
  const quoted = quote(state); assert.equal(quoted.promised.food, count * 4); assert.equal(quoted.promised.energy, count);
  dispatchBorder(state); finish(state); assert.equal(state.routes[0]!.agreement!.deliveryCount, count); assert.equal(state.routes[0]!.agreement!.enabled, true);
});

test('actual accepted Knowledge protects its deadline and allocator inputs and refuses loss of institutional staff', () => {
  const state = syntheticBorderCorridor();
  for (const actor of [INITIATOR, DEFENDER]) { city(state, actor).population = 9; syntheticTechnologies(state, actor, actor === INITIATOR ? ['engineering'] : ['wheel', 'masonry']); syntheticInstitution(state, city(state, actor).id, 'academy'); }
  state.civilizations[DEFENDER]!.researchTarget = 'engineering'; trade(state);
  while (state.routes[0]!.agreement!.deliveryCount === 0) borderBeat(state);
  borderEngineAction(state, INITIATOR, { type: 'propose-knowledge', routeId: state.routes[0]!.id, teacherCityId: city(state).id, learnerCityId: city(state, DEFENDER).id, technologyId: 'engineering', teacherInstitutionId: 'academy', learnerInstitutionId: 'academy' });
  borderEngineAction(state, DEFENDER, { type: 'respond-knowledge', compactId: state.knowledge!.active[0]!.id, accept: true });
  const compact = state.knowledge!.active[0]!; assert.ok(compact.status === 'accepted');
  assert.equal(compact.terms.ruleVersion, 2); assert.equal(compact.terms.studySeasons, 3); assert.equal(compact.terms.studyInterval, 1); assert.equal(compact.deadlineRound, compact.acceptedRound + 3);
  const quoted = quote(state); const horizon = Math.max(BORDER_RULES.maximumFieldBeats, compact.deadlineRound - state.round); assert.equal(horizon, 8);
  assert.equal(quoted.promiseHorizon, horizon); assert.equal(quoted.promised.culture, 2 + 2 * horizon); assert.equal(quoted.promised.credits, horizon); assert.equal(quoted.operationForecast.find(item => item.id === 'academy')!.round, state.round + 1);
  const clone = structuredClone(state); city(clone).population = 7;
  const blocked = quoteBorderDeparture(clone, INITIATOR, dispatch(clone)); assert.equal(blocked.ok, false); if (!blocked.ok) assert.match(blocked.reason, /Knowledge institution/);
  dispatchBorder(state); finish(state); assert.ok(isWorldState(state));
  const completed = state.knowledge!.lastResults[INITIATOR]!; assert.equal(completed.outcome, 'completed'); assert.equal(completed.compact.id, compact.id); assert.ok(completed.compact.status === 'accepted'); assert.equal(completed.compact.studies.length, 2); assert.deepEqual(completed.teacherPaid, { culture: 2 }); assert.deepEqual(completed.learnerPaid, { materials: 3, credits: 4 });
});

test('real strategic trade, accepted relief and committed public project remain separately protected and deliver', () => {
  const state = syntheticBorderCorridor(); syntheticTechnologies(state, INITIATOR, ['currency']);
  for (const actor of [INITIATOR, DEFENDER]) syntheticInstitution(state, city(state, actor).id, 'monument');
  state.civilizations[INITIATOR]!.strategicResources = { iron: 10 }; trade(state, 'iron-for-food');
  const route = state.routes[0]!; route.damage = 20; state.civilizations[DEFENDER]!.resources.food = 0;
  borderEngineAction(state, INITIATOR, { type: 'propose-relief', routeId: route.id, sourceCityId: city(state).id, recipientCityId: city(state, DEFENDER).id });
  borderEngineAction(state, DEFENDER, { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true });
  borderEngineAction(state, INITIATOR, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' });
  borderEngineAction(state, DEFENDER, { type: 'respond-public-project', projectId: state.publicProjects![0]!.id, accept: true });
  const quoted = quote(state); const relief = state.relief!.active[0]!; const cadence = state.routes[0]!.agreement!.terms.cadenceRounds; const count = 1 + Math.floor((state.round + 8 - state.routes[0]!.agreement!.nextDeliveryRound) / cadence);
  assert.equal(quoted.promised.food, relief.terms.food); assert.equal(quoted.promised.materials, 2); assert.equal(quoted.promised.energy, 2 + count); assert.equal(quoted.promisedStrategic.iron, count * 2);
  const poor = structuredClone(state); poor.civilizations[0]!.strategicResources!.iron = count * 2 - 1; assert.equal(quoteBorderDeparture(poor, INITIATOR, dispatch(poor)).ok, false);
  dispatchBorder(state); finish(state); assert.equal(state.relief!.lastResults[INITIATOR]!.outcome, 'delivered'); assert.equal(state.publicProjects!.length, 0); assert.ok(state.events.some(event => event.publicProjectResult?.outcome === 'completed')); assert.equal(state.routes[0]!.agreement!.deliveryCount, count);
});

test('actual hillside Food production reserves paid Materials without crediting forecast output', () => {
  const state = syntheticBorderCorridor(); const site = state.tiles.find(tile => tile.q === 3 && tile.r === 3)!; site.elevation = 70;
  state.strategicDeposits = createStrategicDeposits(state); state.pastoralSites = createPastoralSites(state); state.coalDeposits = createCoalDeposits(state);
  syntheticTechnologies(state, INITIATOR, ['masonry', 'water-management']); city(state).population = 9;
  borderEngineAction(state, INITIATOR, { type: 'improve', cityId: city(state).id, tileId: site.id, improvementId: 'hill-commons' });
  for (let beat = 0; beat < 4 && city(state).construction?.active; beat++) borderBeat(state);
  assert.ok(city(state).improvements?.[String(site.id)]); const quoted = quote(state); const forecast = quoted.operationForecast.find(item => item.kind === 'improvement' && item.tileId === site.id); assert.ok(forecast); assert.equal(forecast.inputs.materials, 1); assert.equal(quoted.promised.materials, 8);
  const poor = structuredClone(state); poor.civilizations[INITIATOR]!.resources.food = quoted.totalCost.food + quoted.householdReserve.food - 0.01;
  assert.equal(quoteBorderDeparture(poor, INITIATOR, dispatch(poor)).ok, false);
});

test('same-version restart reproduces seeded clash, return, refund and event identities exactly', () => {
  const state = syntheticBorderCorridor(); const id = dispatchBorder(state).id; borderAction(state, DEFENDER, { type: 'respond-border', incidentId: id, response: 'defend', sourceCityId: city(state, DEFENDER).id, people: 2 });
  for (let beat = 0; beat < 4; beat++) borderBeat(state);
  const restored: WorldState = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored));
  const timestamp = turnAdmission(state, INITIATOR).nextStrategyAt!; const first = catchUpStrategy(state, timestamp); const second = catchUpStrategy(restored, timestamp); assert.deepEqual(second, first);
  Object.assign(state, first.state); Object.assign(restored, second.state); finish(state); finish(restored); assert.deepEqual(restored, state);
});

test('unsafe arithmetic, minimum home residents and drain admission refuse before any mutation', () => {
  const state = syntheticBorderCorridor(); city(state).population = 4;
  assert.equal(quoteBorderDeparture(state, INITIATOR, dispatch(state)).ok, false);
  city(state).population = 6; state.civilizations[INITIATOR]!.resources.food = Number.MAX_SAFE_INTEGER;
  assert.equal(quoteBorderDeparture(state, INITIATOR, dispatch(state)).ok, false);
  state.civilizations[INITIATOR]!.resources.food = 500; state.border!.draining = { round: state.round, candidate: { kind: 'mars', winners: [INITIATOR], round: state.round, reason: 'Synthetic admission-only terminal candidate' } };
  const before = structuredClone(state); assert.equal(quoteBorderDeparture(state, INITIATOR, dispatch(state)).ok, false); assert.deepEqual(state, before);
  assert.equal(BORDER_RULES.maximumFieldBeats, 8); assert.equal(borderPromisedResources(state, INITIATOR, 8).failure, null);
});
