import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionWeight } from '../core/behavior-progression.ts';
import { chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { CIVICS, ECONOMY_RULES, IMPROVEMENTS, RESOURCE_IDS, SPACEFLIGHT_RULES, TECHNOLOGIES, TRADE_RECIPES, TURN_RULES, VICTORY_RULES } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { RELEASES } from '../core/release.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { improvementSiteBlock } from '../core/simulation/improvements.ts';
import { createLandTransportPlanner, createSteamTransportPlanner, transportCadence } from '../core/simulation/transport.ts';
import type { GameEvent, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { advanceLocalSimulation, createLocalSimulation, type LocalSimulation, type LocalDecision } from '../web/local-simulation.ts';

const epoch = '2000-01-01T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();

function syntheticWorld(): WorldState {
  let state = createWorld(1701, epoch);
  for (const release of RELEASES.slice(1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.ok(result.ok, result.error); state = result.state;
  }
  for (const actor of state.civilizations) {
    actor.technologies = TECHNOLOGIES.map(technology => technology.id);
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    actor.strategicResources = { iron: 30, coal: 30 };
    actor.era = 2;
    if (actor.civics) actor.civics.completedCivicIds = CIVICS.map(civic => civic.id);
  }
  return state;
}

void test('synthetic personality-cap scenario still chooses and pays for a conserved coastal departure', () => {
  const state = syntheticWorld();
  const actor = state.civilizations[0]; const source = state.cities[0]; assert.ok(actor && source);
  const profile = civilizationBehaviorProfile(state.seed, actor.id);
  for (const city of state.cities.slice(0, profile.settlementGoal)) city.civId = 0;
  source.tileId = 23; source.population = 10; source.buildings = ['boat-yard'];
  for (const tileId of [6, 7, 8]) { const tile = state.tiles[tileId]; assert.ok(tile); tile.terrain = 'ocean'; tile.owner = null; }
  for (const tileId of [23, 26]) { const tile = state.tiles[tileId]; assert.ok(tile); tile.terrain = 'grassland'; tile.owner = tileId === 23 ? 0 : null; }
  for (const city of state.cities.filter(city => city.civId === 0)) city.construction = { active: { id: `synthetic-${city.id}`, cityId: city.id, buildingId: 'farm', ruleVersion: 1, startedRound: 0, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 0 }, lastCompleted: null };
  const options = legalActions(state, 0, epoch);
  assert.ok(options.some(option => option.action.type === 'settle-coast'));
  const plan = deriveProgressionPlan(state, actor, profile, options);
  assert.ok(plan.coastalNeeded); assert.equal(plan.cityById.size, profile.settlementGoal);
  let selected: ReturnType<typeof chooseCivilizationBehavior> | undefined;
  for (let cursor = 0; cursor < 32; cursor++) {
    const memory = createBehaviorMemory(state, 0); memory.decisionCount = cursor;
    const decision = chooseCivilizationBehavior(state, 0, memory, epoch);
    if (decision.action?.type === 'settle-coast') { selected = decision; break; }
  }
  assert.ok(selected?.action?.type === 'settle-coast', 'A personality cap cannot permanently zero the paid coastal goal');
  assert.ok(options.some(option => sameAction(option.action, selected.action)));
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: selected.action });
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before);
  assert.equal(result.state.cities.reduce((sum, city) => sum + city.population, 0), before.cities.reduce((sum, city) => sum + city.population, 0));
  for (const resource of RESOURCE_IDS) assert.equal(result.state.civilizations[0]?.resources[resource], actor.resources[resource] - ((ECONOMY_RULES.settle.cost as Partial<Resources>)[resource] ?? 0));
  assert.ok(result.events.some(event => event.coastalFounding));
  assert.equal(deriveProgressionPlan(result.state, result.state.civilizations[0]!, profile, []).coastalNeeded, false);
});

void test('synthetic staffing budget pauses competing recipes and preserves a resident for revealed extraction', () => {
  const state = syntheticWorld(); const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
  actor.technologies = ['bronze-working', 'metal-casting']; city.population = 7;
  city.buildings = ['academy', 'library', 'foundry', 'kiln'];
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  const mine = IMPROVEMENTS.find(improvement => improvement.id === 'mine'); assert.ok(mine);
  const deposit = Object.values(state.strategicDeposits?.deposits ?? {}).find(candidate => improvementSiteBlock(state, city, mine, candidate.tileId) === null); assert.ok(deposit);
  city.improvements = { [deposit.tileId]: { improvementId: 'mine', tileId: deposit.tileId, completion: { kind: 'improvement', orderId: 'synthetic-mine', cityId: city.id, improvementId: 'mine', tileId: deposit.tileId, startedRound: 0, completedRound: 0, paid: { materials: 6, credits: 3 }, workRequired: 4, eventId: 'synthetic-mine-completed' }, operation: { enabled: true, lastResult: null } } };
  const profile = civilizationBehaviorProfile(state.seed, 0);
  const plan = deriveProgressionPlan(state, actor, profile, legalActions(state, 0, epoch));
  assert.ok(plan.desiredBuildings.has(`${city.id}/foundry`));
  assert.ok(plan.desiredImprovements.has(`${city.id}/${deposit.tileId}`));
  assert.equal(plan.desiredBuildings.has(`${city.id}/academy`), false);
  assert.equal(plan.desiredBuildings.has(`${city.id}/library`), false);
  for (const [id, operation] of Object.entries(city.buildingOperations)) operation.enabled = plan.desiredBuildings.has(`${city.id}/${id}`);
  allocateOperations(state);
  assert.equal(city.buildingOperations.foundry?.lastResult?.status, 'operated');
  assert.equal(city.buildingOperations.foundry?.lastResult?.residents?.allocated, 3);
  assert.equal(city.improvements[String(deposit.tileId)]?.operation.lastResult?.residents.available, 1);
  assert.equal(city.improvements[String(deposit.tileId)]?.operation.lastResult?.status, 'operated');
  assert.equal(city.improvements[String(deposit.tileId)]?.operation.lastResult?.residents.allocated, 1);
  assert.deepEqual(city.buildingOperations.foundry?.lastResult?.paid, { energy: 2 });
  assert.deepEqual(city.buildingOperations.foundry?.lastResult?.strategicPaid, { iron: 1 });
});

void test('synthetic empty coal cannot suppress ordinary paid learning and idle generators conserve fuel', () => {
  const state = syntheticWorld(); const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
  actor.technologies = ['writing']; actor.strategicResources = { iron: 0, coal: 0 }; city.population = 12;
  city.buildings = ['library', 'coal-plant', 'factory'];
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  const plan = deriveProgressionPlan(state, actor, civilizationBehaviorProfile(state.seed, 0), []);
  assert.ok(plan.desiredBuildings.has(`${city.id}/library`));
  assert.equal(plan.desiredBuildings.has(`${city.id}/coal-plant`), false);
  assert.equal(plan.desiredBuildings.has(`${city.id}/factory`), false);
  actor.technologies = TECHNOLOGIES.map(technology => technology.id); actor.strategicResources.coal = 30; actor.resources.materials = 1000;
  city.buildings = ['coal-plant', 'research-lab'];
  assert.equal(deriveProgressionPlan(state, actor, civilizationBehaviorProfile(state.seed, 0), []).desiredBuildings.has(`${city.id}/coal-plant`), false);
});

void test('progression budgets only revealed finite strategic deposits', () => {
  const state = syntheticWorld(); const actor = state.civilizations[0]; assert.ok(actor);
  actor.technologies = [];
  const profile = civilizationBehaviorProfile(state.seed, actor.id);
  assert.equal(deriveProgressionPlan(state, actor, profile, []).deposits.size, 0);
  actor.technologies = ['bronze-working'];
  const revealed = deriveProgressionPlan(state, actor, profile, []).deposits;
  assert.ok(revealed.size > 0);
  assert.ok([...revealed.values()].every(deposit => deposit.resource === 'iron'));
});

void test('synthetic land contract is stopped only after actual rails offer a genuinely faster freshly consenting replacement', () => {
  const state = syntheticWorld(); const actor = state.civilizations[0]; const source = state.cities[0]; const target = state.cities[1]; assert.ok(actor && source && target);
  state.cities = [source, target];
  for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.owner = 0; }
  source.tileId = 73; target.tileId = 86;
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials'); assert.ok(recipe);
  const quote = createLandTransportPlanner(state).quote(source.tileId, target.tileId); assert.ok(quote);
  state.routes = [{ id: 'synthetic-route', from: source.id, to: target.id, owner: 0, partner: 1, active: true, damage: 0, volume: 1, agreement: { offerId: 'synthetic-consent', terms: { ...structuredClone(recipe.terms), transport: quote, cadenceRounds: transportCadence(recipe.terms.cadenceRounds, quote) }, enabled: true, acceptedRound: 0, nextDeliveryRound: 7, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } }];
  const profile = civilizationBehaviorProfile(state.seed, 0);
  const initial = deriveProgressionPlan(state, actor, profile, legalActions(state, 0, epoch));
  assert.equal(initial.replaceableRoutes.size, 0);
  assert.ok(initial.usefulRailEdges.size > 0);
  const useful = legalActions(state, 0, epoch).filter(option => option.action.type === 'build-rail' && initial.usefulRailEdges.has(`${Math.min(option.action.fromTileId, option.action.toTileId)}:${Math.max(option.action.fromTileId, option.action.toTileId)}`));
  assert.ok(useful.length > 0);
  assert.ok(progressionWeight(useful[0]!, 3, state, actor, profile, initial) > 3);
  state.railEdges = {};
  for (let index = 1; index <= 2; index++) {
    const first = quote.tileIds[index - 1]; const second = quote.tileIds[index]; assert.ok(first !== undefined && second !== undefined);
    const edgeId = `${Math.min(first, second)}:${Math.max(first, second)}`;
    state.railEdges[edgeId] = { kind: 'rail', ruleVersion: 1, orderId: `synthetic-${edgeId}`, cityId: source.id, civId: 0, edgeId, tileId: Math.min(first, second), toTileId: Math.max(first, second), startedRound: 0, completedRound: 0, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, eventId: `synthetic-completed-${edgeId}` };
  }
  const steam = createSteamTransportPlanner(state).quote(source.tileId, target.tileId, recipe.terms.cadenceRounds); assert.ok(steam);
  assert.ok(transportCadence(recipe.terms.cadenceRounds, steam) < steam.unrailedCadence);
  actor.strategicResources = { iron: 30, coal: steam.proposerFuel.coal };
  const plan = deriveProgressionPlan(state, actor, profile, legalActions(state, 0, epoch));
  assert.ok(plan.replaceableRoutes.has('synthetic-route'));
  const stop = chooseCivilizationBehavior(state, 0, undefined, epoch); assert.equal(stop.action?.type, 'stop-trade'); assert.ok(stop.action);
  const oldTerms = structuredClone(state.routes[0]?.agreement?.terms);
  const stopped = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: stop.action }); assert.ok(stopped.ok, stopped.error);
  assert.deepEqual(stopped.state.routes[0]?.agreement?.terms, oldTerms);
  assert.equal(stopped.state.routes[0]?.agreement?.enabled, false);
  assert.ok(legalActions(stopped.state, 0, at(10)).some(option => option.action.type === 'propose-trade' && option.action.transportMode === 'steam'));
  assert.equal(stopped.state.tradeOffers?.filter(offer => offer.status === 'accepted').length ?? 0, 0);
  const proposed = chooseCivilizationBehavior(stopped.state, 0, stop.memory, at(10));
  assert.ok(proposed.action?.type === 'propose-trade' && proposed.action.transportMode === 'steam');
  const offered = applyCommand(stopped.state, { seat: 0, expectedRevision: stopped.state.revision, timestamp: at(10), action: proposed.action }); assert.ok(offered.ok, offered.error);
  assert.equal(offered.state.civilizations[0]?.strategicResources?.coal, steam.proposerFuel.coal, 'Fresh consent does not charge hypothetical delivery fuel');
  assert.ok(chooseCivilizationBehavior(offered.state, 0, proposed.memory, at(20)).explanation.required, 'Two transport-priority decisions cannot starve required construction');
});

type Campaign = LocalSimulation;

function playWindow(input: Campaign, previous?: Campaign): { campaign: Campaign; events: GameEvent[]; milliseconds: number; commands: LocalDecision[] } {
  const start = performance.now();
  let campaign: Campaign;
  try {
    campaign = advanceLocalSimulation(input, 1);
  } catch (error) {
    const directory = new URL('../.blabla/scratch/earned-civilization-progression/', import.meta.url);
    mkdirSync(directory, { recursive: true });
    writeFileSync(new URL('failed-campaign.json', directory), JSON.stringify(input));
    if (previous) writeFileSync(new URL('last-valid-campaign.json', directory), JSON.stringify(previous));
    throw new Error(JSON.stringify({ blocker: 'Actual Worker rejected prior committed checkpoint', round: input.state.round, steps: input.steps, revision: input.state.revision, worldValid: isWorldState(input.state), checkpoint: '.blabla/scratch/earned-civilization-progression/failed-campaign.json', cause: String(error) }), { cause: error });
  }
  const milliseconds = performance.now() - start;
  const retained = new Set(input.state.events.map(event => event.id));
  const events = campaign.state.events.filter(event => !retained.has(event.id));
  const commands = campaign.decisions.filter(decision => decision.revision > input.state.revision);
  for (const event of events) if (event.marsDeparture) {
    const departure = event.marsDeparture;
    const recipe = SPACEFLIGHT_RULES[departure.mission];
    assert.deepEqual(departure.launchCost, recipe.launchCost);
    assert.deepEqual(departure.cargo, recipe.cargo);
    assert.deepEqual(departure.paid, departure.totalCost);
    for (const resource of RESOURCE_IDS) assert.equal(departure.totalCost[resource] ?? 0, ((recipe.launchCost as Partial<Resources>)[resource] ?? 0) + ((recipe.cargo as Partial<Resources>)[resource] ?? 0));
    assert.equal(departure.sourcePopulationBefore - departure.sourcePopulationAfter, departure.settlers);
    assert.equal(departure.arrivalRound - departure.departureRound, SPACEFLIGHT_RULES.flightRounds);
  }
  return { campaign, events, milliseconds, commands };
}

function summary(state: WorldState): object {
  return {
    round: state.round, milestones: state.calendarMilestones, outcome: state.outcome, cities: state.cities.length,
    foundries: state.industrialEvidence?.foundryOperations.length, steam: state.industrialEvidence?.steamDelivery?.routeId,
    actors: state.civilizations.map(actor => ({ id: actor.id, technologies: actor.technologies, target: actor.researchTarget, progress: actor.researchProgress, stock: actor.resources, strategic: actor.strategicResources, mars: [actor.marsProgress, actor.marsPopulation, actor.marsSupplyStreak] })),
    towns: state.cities.map(city => ({ id: city.id, population: city.population, buildings: city.buildings, construction: city.construction?.active, operations: city.buildingOperations })),
  };
}

void test('earned generated seed1701 campaign reaches supplied inhabited Mars through paid autonomous choices', { timeout: 600_000 }, context => {
  const localTemplate = createLocalSimulation();
  const initial = createGeneratedWorld(1701, epoch);
  assert.deepEqual(initial, localTemplate.state, 'The measured campaign is the actual new default local observatory');
  assert.equal(initial.origin?.kind, 'generated'); assert.equal(initial.origin?.seed, 1701);
  assert.ok(initial.civilizations.every(actor => actor.technologies.length === 0 && actor.marsPopulation === 0));
  assert.ok(initial.cities.every(city => city.buildings.length === 0));
  let campaign: Campaign = localTemplate;
  let previousWindow: Campaign | undefined;
  const timings: number[] = []; const kinds = new Map<string, number>(); const completed = new Set<string>();
  let restartedBeforeLaunch = false; let restartedInTransit = false; let missedWindowBranch: Campaign | null = null;
  const started = performance.now();
  while (campaign.state.round < 360 && !campaign.state.outcome) {
    const before = campaign; const next = playWindow(campaign, previousWindow); previousWindow = before; campaign = next.campaign;
    timings.push(next.milliseconds);
    for (const command of next.commands) kinds.set(command.action.type, (kinds.get(command.action.type) ?? 0) + 1);
    for (const event of next.events) completed.add(event.type);
    const justLaunched = next.events.some(event => event.marsDeparture);
    if (!restartedBeforeLaunch && justLaunched) {
      const replayed = playWindow(JSON.parse(JSON.stringify(before)) as Campaign);
      assert.deepEqual({ campaign: replayed.campaign, commands: replayed.commands, events: replayed.events }, { campaign: next.campaign, commands: next.commands, events: next.events });
      restartedBeforeLaunch = true;
    }
    if (!restartedInTransit && campaign.state.spaceflight?.civilizations.some(space => space.activeMission && campaign.state.round > space.activeMission.departureRound)) {
      const restored = JSON.parse(JSON.stringify(campaign)) as Campaign;
      const left = playWindow(campaign); const right = playWindow(restored);
      assert.deepEqual({ campaign: left.campaign, commands: left.commands, events: left.events }, { campaign: right.campaign, commands: right.commands, events: right.events });
      restartedInTransit = true;
    }
    if (!missedWindowBranch && next.events.some(event => event.marsArrival)) missedWindowBranch = JSON.parse(JSON.stringify(campaign)) as Campaign;
    for (const milestone of campaign.state.calendarMilestones) if (!before.state.calendarMilestones.includes(milestone)) {
      assert.ok(isWorldState(campaign.state), `Canonical checkpoint at ${milestone}`);
      context.diagnostic(JSON.stringify({ milestone, round: campaign.state.round, elapsedMs: Math.round(performance.now() - started), decisions: campaign.memories.reduce((sum, memory) => sum + (memory?.decisionCount ?? 0), 0), candidateCounts: campaign.state.civilizations.map(actor => legalActions(campaign.state, actor.id, at((campaign.steps + 1) * 10)).length) }));
    }
    if (performance.now() - started >= 590_000) assert.fail(JSON.stringify({ blocker: 'Campaign diagnostic time bound reached', ...summary(campaign.state) }));
  }
  const sorted = timings.toSorted((a, b) => a - b);
  context.diagnostic(JSON.stringify({ ...summary(campaign.state), elapsedMs: Math.round(performance.now() - started), actualWorkerWindowMs: { mean: timings.reduce((sum, time) => sum + time, 0) / timings.length, p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) }, choices: Object.fromEntries(kinds) }));
  assert.equal(campaign.state.outcome?.kind, 'mars', JSON.stringify(summary(campaign.state)));
  assert.ok(isWorldState(campaign.state));
  for (const kind of ['research-completed', 'construction-started', 'building-completed', 'coastal-founded', 'improvement-completed', 'rail-completed', 'mars-departed', 'mars-arrived']) assert.ok(completed.has(kind) || (campaign.state.eventCounts[kind] ?? 0) > 0, `Earned receipt ${kind}`);
  assert.ok(kinds.get('stop-trade'), 'Existing land terms were explicitly stopped before new steam consent');
  assert.ok(restartedBeforeLaunch && restartedInTransit);
  const evidence = campaign.state.industrialEvidence; assert.equal(new Set(evidence?.foundryOperations.map(receipt => receipt.cityId)).size, 2);
  assert.ok(evidence?.foundryOperations.every(receipt => (receipt.strategicPaid.iron ?? 0) > 0 && (receipt.paid.energy ?? 0) > 0 && receipt.residents.allocated === 3));
  assert.ok(evidence?.steamDelivery && evidence.steamDelivery.terms.transport?.mode === 'steam');
  assert.ok(evidence.steamDelivery.terms.transport.railEdges.length > 0 && evidence.steamDelivery.terms.cadenceRounds < evidence.steamDelivery.terms.transport.unrailedCadence);
  const winner = campaign.state.civilizations.find(actor => campaign.state.outcome?.winners.includes(actor.id)); assert.ok(winner);
  assert.ok(winner.marsPopulation >= VICTORY_RULES.mars.population && winner.marsProgress >= VICTORY_RULES.mars.progress && winner.marsSupplyStreak >= VICTORY_RULES.mars.suppliedRounds);
  context.diagnostic(JSON.stringify({ naturalCampaign: 'supplied-inhabited-Mars', round: campaign.state.round, winner: winner.id, injectedFaults: 0 }));
  assert.ok(missedWindowBranch);
  const strandedSeat = missedWindowBranch.state.spaceflight?.civilizations.findIndex(space => space.colony); assert.ok(strandedSeat !== undefined && strandedSeat >= 0);
  const beforeMiss = missedWindowBranch.state.spaceflight?.civilizations[strandedSeat]?.missionsLaunched;
  const missedTo = missedWindowBranch.state.round + 12;
  const missed = catchUpStrategy(missedWindowBranch.state, at(missedTo * 60)); assert.ok(missed.ok, missed.error);
  const stranded = missed.state.civilizations[strandedSeat]; assert.ok(stranded);
  assert.equal(stranded.marsSupplyStreak, 0);
  assert.ok((missed.state.spaceflight?.civilizations[strandedSeat]?.colony?.shortageRounds ?? 0) > 0 || stranded.marsPopulation < VICTORY_RULES.mars.population);
  assert.equal(missed.state.spaceflight?.civilizations[strandedSeat]?.activeMission, null);
  assert.equal(missed.state.spaceflight?.civilizations[strandedSeat]?.missionsLaunched, beforeMiss, 'Missed tactical windows do not retroactively create paid resupply');
  context.diagnostic(JSON.stringify({ faultInjected: 'twelve-missed-tactical-rounds', round: missed.state.round, seat: strandedSeat, population: stranded.marsPopulation, upkeep: missed.state.spaceflight?.civilizations[strandedSeat]?.lastUpkeep?.status, colony: missed.state.spaceflight?.civilizations[strandedSeat]?.colony }));
  let recovering: Campaign = { ...missedWindowBranch, state: missed.state, steps: missedTo * TURN_RULES.strategyIntervalMs / TURN_RULES.tacticalWindowMs, timestamp: at(missedTo * 60) };
  const recoveryUntil = recovering.state.round + 40;
  while (!recovering.state.outcome && recovering.state.round < recoveryUntil) recovering = playWindow(recovering).campaign;
  assert.equal(recovering.state.outcome?.kind, 'mars', JSON.stringify({ blocker: 'Paid post-shortage recovery', ...summary(recovering.state) }));
  context.diagnostic(JSON.stringify({ faultRecovery: 'autonomous-paid-resupply', round: recovering.state.round, outcome: recovering.state.outcome }));
});
