import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ECONOMY_RULES, HISTORICAL_MILESTONES, RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../core/content.ts';
import { applyCommand, applyHistoryAdvance, legalActions } from '../core/engine.ts';
import { createBehaviorMemory, chooseCivilizationBehavior, chooseDirectorBehavior, isBehaviorMemory } from '../core/behaviors.ts';
import { foundSettlement, isCoastalSite } from '../core/simulation/coastal.ts';
import { milestoneEligible, nextEarnedHistoryAdvance } from '../core/simulation/history.ts';
import { industrialEvidenceComplete } from '../core/simulation/industrial-evidence.ts';
import { availableSpaceMissions, quoteMarsMission, resolveSpaceflight } from '../core/simulation/spaceflight.ts';
import type { GameAction, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { industrialSteamJourney } from './fixtures/industrial-steam-journey.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { landAct, landBeat, landIntegrationFixture, landTime, replayLandStep } from './fixtures/land-integration.ts';

let cached: ReturnType<typeof landIntegrationFixture> | undefined;
const fixture = () => structuredClone(cached ??= landIntegrationFixture());
const connection = (state: WorldState) => state.milestoneProofs?.['connected-world']?.connection;
const routeOf = (state: WorldState, id: string) => { const route = state.routes.find(candidate => candidate.id === id); assert.ok(route?.agreement); return route; };
const resources = (state: WorldState) => state.civilizations.map(civ => ({ ordinary: civ.resources, strategic: civ.strategicResources }));
const connectedDefinition = HISTORICAL_MILESTONES.find(milestone => milestone.id === 'connected-world')!;

function assertNoConnection(state: WorldState): void {
  assert.equal(connection(state), undefined);
  assert.equal(state.calendarMilestones.includes('connected-world'), false);
  assert.ok(state.civilizations.every(civ => civ.era < 2));
}

function readyAction(state: WorldState, seat: number, action: GameAction): WorldState {
  while (Date.parse(landTime(state, seat)) >= Date.parse(state.clockEpoch!) + (state.independentTurns!.strategyTicks + 1) * 60_000) state = landBeat(state).state;
  return landAct(state, seat, action).state;
}

function addCapitalRoutes(state: WorldState, count: number): WorldState {
  for (let index = 0; index < count; index++) {
    const offers = state.civilizations.flatMap(civ => legalActions(state, civ.id, landTime(state, civ.id)).flatMap(option => option.action.type === 'propose-trade'
      && option.action.recipeId === 'harvest-for-materials' && !option.action.transportMode
      && /^city-[0-4]$/.test(option.action.sourceCityId ?? '')
      && /^city-[0-4]$/.test(option.action.recipientCityId ?? '')
      ? [{ seat: civ.id, action: option.action, cadence: option.tradeQuote!.cadenceRounds }] : [])).sort((a, b) => a.cadence - b.cadence || a.seat - b.seat);
    const selected = offers[0]; assert.ok(selected);
    state = readyAction(state, selected.seat, selected.action);
    const offer = state.tradeOffers!.at(-1)!;
    state = readyAction(state, offer.recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
  }
  return state;
}

void test('fresh synthetic prerequisites lead to real conserved inland founding, consent and exact paid delivery without Navigation', context => {
  const run = fixture(); const birth = run.founded.cities.find(city => city.id === run.foundedCityId)!.landFounding; assert.ok(birth);
  const town = run.founded.cities.find(city => city.id === run.foundedCityId)!;
  const sourceBefore = run.initial.cities.find(city => city.id === run.sourceCityId)!;
  const sourceAfter = run.founded.cities.find(city => city.id === run.sourceCityId)!;
  assert.equal(sourceBefore.population - sourceAfter.population, town.population);
  assert.equal(town.population, ECONOMY_RULES.settle.population);
  assert.ok(sourceAfter.population >= ECONOMY_RULES.settle.minimumSourcePopulation);
  assert.deepEqual(birth.paid, ECONOMY_RULES.settle.cost);
  for (const id of [run.sourceCityId, run.foundedCityId, run.foreignCityId]) assert.equal(isCoastalSite(run.founded, run.founded.cities.find(city => city.id === id)!.tileId), false);
  assert.ok(run.state.civilizations.every(civ => !civ.technologies.includes('navigation')));
  assert.equal(run.state.eventCounts['coastal-founded'] ?? 0, 0);
  for (const resource of RESOURCE_IDS) assert.equal(run.founded.civilizations[birth.civId]!.resources[resource], run.initial.civilizations[birth.civId]!.resources[resource] - ((birth.paid as Partial<Resources>)[resource] ?? 0));
  assert.deepEqual(resources(run.proposed), resources(run.founded));
  const agreement = routeOf(run.accepted, run.routeId).agreement!;
  for (const resource of RESOURCE_IDS) assert.equal(run.accepted.civilizations[routeOf(run.accepted, run.routeId).owner]!.resources[resource], run.proposed.civilizations[routeOf(run.accepted, run.routeId).owner]!.resources[resource] - (agreement.terms.constructionCost[resource] ?? 0));
  assert.equal(agreement.deliveryCount, 0);
  assertNoConnection(run.accepted); assertNoConnection(run.beforeDue);
  const witness = connection(run.state); assert.ok(witness?.kind === 'land');
  assert.deepEqual(witness.founding, birth);
  assert.equal(witness.delivery.fromCityId, run.foundedCityId);
  assert.equal(witness.delivery.toCityId, run.foreignCityId);
  assert.equal(witness.delivery.round, agreement.nextDeliveryRound);
  assert.equal(witness.delivery.deliveryCount, 1);
  assert.ok(witness.delivery.tradeTerms.transport!.edges > 12);
  assert.ok(witness.delivery.tradeTerms.cadenceRounds > 6);
  assert.ok(witness.delivery.round >= run.accepted.tradeOffers!.at(-1)!.expiresRound);
  assert.ok(witness.delivery.tradeTerms.transport!.tileIds.every(id => !['ocean', 'mountain'].includes(run.state.tiles.find(tile => tile.id === id)!.terrain)));
  assert.ok(run.state.civilizations.every(civ => civ.era === 2));
  assert.equal(run.state.year, run.initial.year);
  assert.equal(run.state.calendarMilestones.filter(id => id === 'connected-world').length, 1);
  const delivery = run.state.events.find(event => event.id === witness.delivery.eventId); assert.deepEqual(delivery?.paidTradeDelivery, witness.delivery);
  assert.deepEqual(run.state.events.find(event => event.id === run.state.milestoneProofs!['connected-world']!.eventId)?.landIntegration, witness);
  const control = structuredClone(run.beforeDue); routeOf(control, run.routeId).agreement!.enabled = false;
  const baseline = landBeat(control).state;
  const terms = witness.delivery.tradeTerms;
  for (const [seat, sent, upkeep, received, yielded, paid] of [
    [witness.delivery.owner, terms.proposerCargo, terms.proposerUpkeep, terms.recipientCargo, terms.proposerYield, witness.delivery.proposerPaid],
    [witness.delivery.partner, terms.recipientCargo, terms.recipientUpkeep, terms.proposerCargo, terms.recipientYield, witness.delivery.recipientPaid],
  ] as const) for (const resource of RESOURCE_IDS) {
    assert.equal(paid[resource], (sent[resource] ?? 0) + (upkeep[resource] ?? 0));
    assert.equal(Math.round((run.state.civilizations[seat]!.resources[resource] - baseline.civilizations[seat]!.resources[resource]) * 100) / 100, -(paid[resource] ?? 0) + (received[resource] ?? 0) + (yielded[resource] ?? 0));
  }
  context.diagnostic(JSON.stringify({ provenance: run.provenance, birth, delivery: witness.delivery, actualFrames: run.steps.length }));
});

void test('a differently generated founded recipient and an ordinary coastal-adjacent founder also qualify', () => {
  const recipient = landIntegrationFixture({ recipient: true, recipeId: 'energy-for-materials', seed: 1711 });
  const witness = connection(recipient.state); assert.ok(witness?.kind === 'land');
  assert.equal(witness.delivery.toCityId, recipient.foundedCityId);
  assert.equal(witness.delivery.tradeTerms.recipeId, 'energy-for-materials');
  assert.equal(witness.delivery.proposerPaid.energy, 5);
  const coastal = landIntegrationFixture({ coastalAdjacent: true });
  assert.ok(isCoastalSite(coastal.founded, coastal.founded.cities.find(city => city.id === coastal.foundedCityId)!.tileId));
  assert.ok(connection(coastal.state)?.kind === 'land');
  assert.equal(coastal.state.eventCounts['coastal-founded'] ?? 0, 0);
});

void test('each exact pre-due obstacle blocks engine exchange atomically against its no-shipment economy control', () => {
  const run = fixture();
  const cases: Array<[string, (state: WorldState) => void]> = [
    ['unpaid recipient combined upkeep without same-beat replenishment', state => { const seat = routeOf(state, run.routeId).partner; state.civilizations[seat]!.resources.energy = 0; for (const city of state.cities.filter(city => city.civId === seat)) city.damage = 100; }],
    ['disabled consent', state => { routeOf(state, run.routeId).agreement!.enabled = false; }],
    ['impassable exact land path', state => { const id = routeOf(state, run.routeId).agreement!.terms.transport!.tileIds[1]!; state.tiles.find(tile => tile.id === id)!.terrain = 'mountain'; }],
    ['changed endpoint owner', state => { const route = routeOf(state, run.routeId); state.cities.find(city => city.id === route.to)!.civId = (route.partner + 1) % 5; }],
    ['damage threshold', state => { const route = routeOf(state, run.routeId); route.damage = route.agreement!.terms.damageDisableAt; }],
  ];
  for (const [label, mutate] of cases) {
    const state = structuredClone(run.beforeDue); mutate(state);
    const control = structuredClone(state); routeOf(control, run.routeId).agreement!.enabled = false;
    const baseline = landBeat(control); const result = landBeat(state);
    assert.equal(routeOf(result.state, run.routeId).agreement!.deliveryCount, 0, label);
    assert.equal(result.events.some(event => event.type === 'trade-delivered'), false, label);
    assert.deepEqual(resources(result.state), resources(baseline.state), label);
    assertNoConnection(result.state);
  }
});

void test('real capital exchange does not integrate an unrelated ordinary-founded town', () => {
  const run = landIntegrationFixture({ unrelated: true });
  assert.equal(routeOf(run.state, run.routeId).agreement!.deliveryCount, 1);
  assert.ok(run.state.cities.find(city => city.id === run.foundedCityId)?.landFounding);
  assertNoConnection(run.state);
});

void test('Rise earned earlier in the same real economy batch admits that batch and not a prior paid exchange', () => {
  const run = landIntegrationFixture({ rise: false });
  assertNoConnection(run.state);
  let together = addCapitalRoutes(structuredClone(run.accepted), 2);
  const due = routeOf(together, run.routeId).agreement!.nextDeliveryRound;
  while (together.round + 1 < due) together = landBeat(together).state;
  assert.equal(together.calendarMilestones.includes('rise-of-states'), false);
  const batch = landBeat(together);
  const rise = batch.events.findIndex(event => event.type === 'history-milestone' && event.title === 'The rise of states');
  const connected = batch.events.findIndex(event => event.landIntegration);
  assert.ok(rise >= 0 && connected > rise);
  assert.ok(connection(batch.state)?.kind === 'land');
  assert.ok(isWorldState(batch.state));
  let later = addCapitalRoutes(structuredClone(run.state), 2);
  const nextDue = routeOf(later, run.routeId).agreement!.nextDeliveryRound;
  while (!later.calendarMilestones.includes('rise-of-states') && later.round < nextDue) later = landBeat(later).state;
  assert.ok(later.round < nextDue);
  assert.ok(later.calendarMilestones.includes('rise-of-states'));
  assertNoConnection(later);
  while (later.round + 1 < nextDue) { later = landBeat(later).state; assertNoConnection(later); }
  later = landBeat(later).state;
  const witness = connection(later); assert.ok(witness?.kind === 'land');
  assert.equal(witness.delivery.deliveryCount, 2);
  assert.equal(witness.delivery.round, nextDue);
});

void test('expired pending consent refuses unchanged but accepted long routes recur past the old deadline', () => {
  const run = fixture(); let pending = structuredClone(run.proposed);
  const offer = pending.tradeOffers!.at(-1)!;
  while (pending.round < offer.expiresRound) pending = landBeat(pending).state;
  const before = structuredClone(pending);
  const result = applyCommand(pending, { seat: offer.recipient, expectedRevision: pending.revision, timestamp: landTime(pending, offer.recipient), action: { type: 'respond-trade', offerId: offer.id, accept: true } });
  assert.equal(result.ok, false); assert.strictEqual(result.state, pending); assert.deepEqual(pending, before); assert.deepEqual(result.events, []);
  let accepted = run.state; const oldWitness = structuredClone(connection(accepted));
  const nextDue = routeOf(accepted, run.routeId).agreement!.nextDeliveryRound;
  while (accepted.round < nextDue) accepted = landBeat(accepted).state;
  assert.equal(routeOf(accepted, run.routeId).agreement!.deliveryCount, 2);
  assert.deepEqual(connection(accepted), oldWitness);
  assert.equal(accepted.tradeOffers!.at(-1)!.status, 'accepted');
});

void test('replayed founding commands and forecasts cannot mint a second birth or advance RNG', () => {
  const run = fixture(); const step = run.steps.find(item => item.input.kind === 'action')!;
  assert.ok(step.input.kind === 'action');
  const state = structuredClone(step.result.state); const before = structuredClone(state);
  const result = applyCommand(state, step.input.command);
  assert.equal(result.ok, false); assert.strictEqual(result.state, state); assert.deepEqual(state, before); assert.deepEqual(result.events, []);
  assert.equal(result.state.rng, before.rng);
  const projected = structuredClone(run.initial); projected.revision++;
  const action = step.input.command.action; assert.ok(action.type === 'settle');
  const tile = projected.tiles.find(tile => tile.id === action.tileId)!;
  const source = projected.cities.find(city => city.id === run.sourceCityId)!;
  const town = foundSettlement(projected, source.civId, tile, source, true);
  assert.equal(town.landFounding, undefined);
  assert.equal(projected.events.some(event => event.landFounding), false);
});

void test('same-version JSON continuation preserves full state, six memories, retained history and one-use calendar after actual pruning', () => {
  const run = fixture();
  for (const step of run.steps) assert.deepEqual(replayLandStep(JSON.parse(JSON.stringify(step.before)), step.input), step.result);
  let state = run.state;
  const memories = Array.from({ length: 6 }, (_, seat) => createBehaviorMemory(state, seat));
  assert.ok(memories.every(isBehaviorMemory));
  const saved = JSON.parse(JSON.stringify({ state, memories }));
  assert.deepEqual(saved, { state, memories }); assert.ok(isWorldState(saved.state));
  assert.deepEqual(landBeat(saved.state), landBeat(state));
  for (let seat = 0; seat < 6; seat++) {
    const choose = (world: WorldState, memory: typeof memories[number]) => seat === 5 ? chooseDirectorBehavior(world, memory, landTime(world, seat)) : chooseCivilizationBehavior(world, seat, memory, landTime(world, seat));
    assert.deepEqual(choose(saved.state, saved.memories[seat]!), choose(state, memories[seat]!));
  }
  const witness = structuredClone(connection(state)); const proof = structuredClone(state.milestoneProofs!['connected-world']!);
  const owner = routeOf(state, run.routeId).owner;
  state = readyAction(state, owner, { type: 'stop-trade', routeId: run.routeId });
  assert.deepEqual(connection(state), witness);
  const initialCount = Object.values(state.eventCounts).reduce((sum, count) => sum + count, 0);
  while (Object.values(state.eventCounts).reduce((sum, count) => sum + count, 0) - initialCount <= 96) state = landBeat(state).state;
  assert.equal(state.events.length, 96);
  assert.equal(state.events.some(event => event.id === proof.eventId), false);
  assert.deepEqual(connection(state), witness); assert.ok(isWorldState(state));
  assert.deepEqual(landBeat(JSON.parse(JSON.stringify(state))), landBeat(state));
  const command = nextEarnedHistoryAdvance(state, landTime(state)); assert.ok(command);
  assert.deepEqual(command.cause, { kind: 'milestone', id: 'connected-world' });
  const advanced = applyHistoryAdvance(state, command); assert.ok(advanced.ok, advanced.error);
  assert.equal(advanced.state.year, -500); assert.equal(advanced.state.round, state.round); assert.equal(advanced.state.clockTicks, state.clockTicks);
  assert.deepEqual(connection(advanced.state), witness);
  const duplicate = applyHistoryAdvance(advanced.state, { ...command, expectedRevision: advanced.state.revision, deltaYears: 0 });
  assert.equal(duplicate.ok, false); assert.strictEqual(duplicate.state, advanced.state);
  assert.ok(isWorldState(advanced.state));
});

void test('the unchanged coastal branch still needs real coastal founding and an actual three-route network on its registered release', () => {
  const journey = freshFixtureJourney('settlement-coastal-1', state => {
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
    for (const civ of state.civilizations) { civ.era = 1; civ.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, culture: 0, science: 0 }; }
    state.cities[0]!.population = 12;
    syntheticTechnologies(state, 0, ['navigation', 'water-management']);
  }, 'Preserved coastal finite engine probe: synthetic prior history, stocks, residents and learning; ordinary departure, Boat yard construction, resident growth, three consented paid routes and coastal founding are actual');
  journey.act({ type: 'settle', sourceCityId: 'city-0', tileId: 23 });
  const departure = journey.state.cities.find(city => city.tileId === 23)!;
  assert.equal(departure.landFounding, undefined);
  journey.act({ type: 'build', cityId: departure.id, project: 'boat-yard' });
  journey.until(() => !!journey.state.cities.find(city => city.id === departure.id)?.buildings.includes('boat-yard') && journey.state.cities.find(city => city.id === departure.id)!.population >= 6, 'Actual completed Boat yard and enough conserved departure residents');
  let state = addCapitalRoutes(journey.state, 3);
  for (let count = 0; count < 40 && state.routes.filter(route => route.active).length < 3; count++) state = landBeat(state).state;
  assert.equal(state.routes.filter(route => route.active).length, 3);
  assert.equal(milestoneEligible(state, [], connectedDefinition), false);
  const action: GameAction = { type: 'settle-coast', sourceCityId: departure.id, tileId: 26 };
  const noNavigation = structuredClone(state); noNavigation.civilizations[0]!.technologies = noNavigation.civilizations[0]!.technologies.filter(id => id !== 'navigation');
  const refused = applyCommand(noNavigation, { seat: 0, action, timestamp: landTime(noNavigation), expectedRevision: noNavigation.revision });
  assert.equal(refused.ok, false); assert.strictEqual(refused.state, noNavigation);
  const result = landAct(state, 0, action);
  const city = result.state.cities.find(city => city.tileId === 26)!;
  assert.ok(city.coastalFounding); assert.equal(city.landFounding, undefined);
  assert.ok(result.state.calendarMilestones.includes('connected-world'));
  assert.ok(result.state.civilizations.every(civ => civ.era === 2));
  assert.equal(result.state.year, state.year); assert.ok(isWorldState(result.state));
});

void test('earned inland connection does not replace the two supplied Foundries and newly consented Coal-paid faster steam proof', () => {
  const inland = fixture().state;
  syntheticTechnologies(inland, 0, ['industrialization']);
  assert.equal(industrialEvidenceComplete(inland), false);
  const milestone = HISTORICAL_MILESTONES.find(item => item.id === 'industrial-world')!;
  assert.equal(milestoneEligible(inland, [], milestone), false);
  const journey = industrialSteamJourney();
  assert.equal(industrialEvidenceComplete(journey.researched), false);
  assert.equal(industrialEvidenceComplete(journey.twoFoundries), false);
  assert.equal(journey.state.industrialEvidence!.foundryOperations.length, 2);
  assert.ok(journey.state.industrialEvidence!.foundryOperations.every(receipt => receipt.paid.energy === 2 && receipt.strategicPaid.iron === 1 && receipt.residents.allocated === 3 && (receipt.produced.materials ?? 0) > 0));
  const delivery = journey.state.industrialEvidence!.steamDelivery!;
  assert.ok(delivery.proposerStrategicPaid.coal! > 0);
  assert.ok(delivery.terms.transport?.mode === 'steam');
  assert.ok(delivery.terms.cadenceRounds < delivery.terms.transport.unrailedCadence);
  assert.ok(industrialEvidenceComplete(journey.state));
  assert.ok(journey.state.calendarMilestones.includes('industrial-world'));
  assert.equal(journey.state.year, journey.prepared.year);
  for (const missing of ['foundry', 'steam'] as const) {
    const negative = structuredClone(journey.state);
    negative.calendarMilestones = negative.calendarMilestones.filter(id => id !== 'industrial-world');
    if (missing === 'foundry') negative.industrialEvidence!.foundryOperations.pop(); else negative.industrialEvidence!.steamDelivery = null;
    assert.equal(milestoneEligible(negative, [], milestone), false);
  }
});

void test('inland connection alone cannot launch Mars; separate synthetic future tools still require actual manifest, flight, habitat and three funded beats', () => {
  let state = fixture().state;
  assert.deepEqual(availableSpaceMissions(state, 0), []);
  assert.equal(quoteMarsMission(state, 0, 'city-0', 'settle'), null);
  assert.equal(state.outcome, null);
  const initialCiv = state.civilizations[0]!; const source = state.cities.find(city => city.id === 'city-0')!;
  initialCiv.era = 5; initialCiv.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, culture: 0, science: 0 }; initialCiv.strategicResources = { coal: 100 }; source.population = 18;
  syntheticTechnologies(state, 0, ['spaceflight']);
  for (const building of ['industrial-zone', 'coal-plant', 'launchpad']) syntheticInstitution(state, source.id, building);
  const civ = () => state.civilizations[0]!;
  const ledger = () => state.spaceflight!.civilizations[0]!;
  let naturalGrowth = 0;
  const beat = (): void => {
    const result = landBeat(state); state = result.state;
    naturalGrowth += result.events.reduce((sum, event) => sum + (event.populationGrowth ? event.populationGrowth.populationAfter - event.populationGrowth.populationBefore : 0), 0);
    assert.equal(result.events.some(event => event.type === 'supply-shortage'), false);
    assert.ok(isWorldState(state));
  };
  const launch = (mission: 'settle' | 'resupply'): void => { state = landAct(state, 0, { type: 'expedition', cityId: source.id, mission }).state; assert.ok(isWorldState(state)); };
  const people = () => state.cities.reduce((sum, town) => sum + town.population, 0) + state.civilizations.reduce((sum, actor) => sum + actor.marsPopulation, 0) + state.spaceflight!.civilizations.reduce((sum, record) => sum + (record.activeMission?.settlers ?? 0), 0);
  beat(); naturalGrowth = 0;
  const quote = quoteMarsMission(state, 0, source.id, 'settle'); assert.ok(quote);
  assert.deepEqual(quote.cargo, SPACEFLIGHT_RULES.settle.cargo);
  const unfunded = structuredClone(state); unfunded.civilizations[0]!.resources.materials = quote.totalCost.materials! - 1;
  const unchanged = structuredClone(unfunded);
  const refused = applyCommand(unfunded, { seat: 0, expectedRevision: unfunded.revision, timestamp: landTime(unfunded), action: { type: 'expedition', cityId: source.id, mission: 'settle' } });
  assert.equal(refused.ok, false); assert.strictEqual(refused.state, unfunded); assert.deepEqual(unfunded, unchanged);
  const population = people(); const opening = structuredClone(civ().resources); const round = state.round;
  launch('settle'); assert.equal(people(), population); assert.equal(civ().marsPopulation, 0);
  for (const resource of RESOURCE_IDS) assert.equal(civ().resources[resource], opening[resource] - (quote.totalCost[resource] ?? 0));
  assert.deepEqual(ledger().activeMission!.paid, quote.totalCost);
  assert.deepEqual(ledger().activeMission!.cargo, SPACEFLIGHT_RULES.settle.cargo);
  for (let index = 1; index < SPACEFLIGHT_RULES.flightRounds; index++) { beat(); assert.equal(civ().marsPopulation, 0); assert.equal(state.outcome, null); }
  beat(); assert.equal(state.round, round + SPACEFLIGHT_RULES.flightRounds);
  assert.equal(civ().marsPopulation, 3); assert.equal(people(), population + naturalGrowth); assert.equal(civ().marsProgress, 25); assert.equal(civ().marsSupplyStreak, 0);
  assert.deepEqual(ledger().lastArrival!.cargo, SPACEFLIGHT_RULES.settle.cargo);
  assert.deepEqual(ledger().lastHabitatWork!.paid, SPACEFLIGHT_RULES.habitat.costPerBeat);
  const shortage = structuredClone(state); const shortageLedger = shortage.spaceflight!.civilizations[0]!; shortageLedger.colony!.stock.materials = 0;
  const earth = structuredClone(shortage.civilizations[0]!.resources); const stock = structuredClone(shortageLedger.colony!.stock);
  shortage.round++; shortage.revision++; resolveSpaceflight(shortage, []);
  assert.deepEqual(shortageLedger.colony!.stock, stock); assert.deepEqual(shortage.civilizations[0]!.resources, earth); assert.equal(shortage.civilizations[0]!.marsProgress, 25); assert.equal(shortage.outcome, null);
  launch('resupply');
  while (state.round < round + 7) { beat(); assert.equal(state.outcome, null); }
  assert.equal(civ().marsProgress, SPACEFLIGHT_RULES.habitat.requiredWork); assert.equal(civ().marsSupplyStreak, 0);
  beat(); assert.equal(civ().marsSupplyStreak, 1); assert.equal(state.outcome, null);
  beat(); assert.equal(civ().marsSupplyStreak, 2); assert.equal(state.outcome, null);
  beat(); assert.equal(civ().marsSupplyStreak, VICTORY_RULES.mars.suppliedRounds); const outcome = state.outcome as WorldState['outcome']; assert.equal(outcome?.kind, 'mars'); assert.deepEqual(outcome?.winners, [0]);
});
