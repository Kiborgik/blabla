import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createWorld, legalActions, observe } from '../core/engine.ts';
import { isGameAction } from '../core/planning.ts';
import { RELEASES } from '../core/release.ts';
import { PUBLIC_PROJECT_RECIPES } from '../core/content.ts';
import { RELIEF_RULES } from '../core/relief-content.ts';
import { isReliefState } from '../core/relief-validation.ts';
import { availableReliefActions, executeReliefAction, quoteReliefProposal, reliefActionFailure, reliefPromisedResources, resolveReliefCharters } from '../core/simulation/relief-charters.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { executeTradeAction, resolveTrade } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { ReliefAction, ReliefCharter } from '../core/relief-types.ts';
import type { GameEvent, WorldState } from '../core/types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
function syntheticPaidCorridor(donor = 1, recipient = 4): WorldState {
  const target = RELEASES.find(release => release.featureIds.includes(RELIEF_RULES.featureId)); assert.ok(target);
  const state = createWorld(1701, epoch, target.id);
  const source = state.cities.find(city => city.civId === donor)!; const destination = state.cities.find(city => city.civId === recipient)!;
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, donor, { type: 'propose-trade', partner: recipient, recipeId: 'harvest-for-materials', sourceCityId: source.id, recipientCityId: destination.id }, events); commitEvents(state, events);
  const offer = state.tradeOffers!.at(-1)!; const constructionBefore = state.civilizations[donor]!.resources.materials;
  state.revision++; events = [];
  executeTradeAction(state, recipient, { type: 'respond-trade', offerId: offer.id, accept: true }, events); commitEvents(state, events);
  assert.equal(state.civilizations[donor]!.resources.materials, constructionBefore - (offer.terms.constructionCost.materials ?? 0));
  source.population = 10; destination.population = 30;
  state.civilizations[donor]!.resources.food = 100; state.civilizations[donor]!.resources.energy = 30;
  state.civilizations[recipient]!.resources.food = 0; state.civilizations[recipient]!.resources.materials = 0;
  assert.ok(isWorldState(state), 'synthetic populations and stocks, actual paid consenting route, otherwise canonical state');
  return state;
}
function proposal(state: WorldState, donor = 1): Extract<ReliefAction, { type: 'propose-relief' }> {
  const route = state.routes.find(route => route.owner === donor || route.partner === donor)!;
  return { type: 'propose-relief', routeId: route.id, sourceCityId: route.owner === donor ? route.from : route.to, recipientCityId: route.owner === donor ? route.to : route.from };
}
function act(state: WorldState, actor: number, action: ReliefAction): GameEvent[] {
  state.revision++; const events: GameEvent[] = [];
  assert.equal(reliefActionFailure(state, actor, action), null);
  assert.ok(executeReliefAction(state, actor, action, events)); commitEvents(state, events); return events;
}
function propose(state: WorldState, donor = 1): ReliefCharter { act(state, donor, proposal(state, donor)); return state.relief!.active.find(charter => charter.terms.donorId === donor)!; }
function accept(state: WorldState, donor = 1): ReliefCharter { const pending = propose(state, donor); act(state, pending.terms.recipientId, { type: 'respond-relief', charterId: pending.id, accept: true }); return state.relief!.active.find(charter => charter.id === pending.id)!; }
function resolve(state: WorldState, round: number): GameEvent[] { state.round = round; state.revision++; const events: GameEvent[] = []; resolveReliefCharters(state, events); commitEvents(state, events); return events; }

void test('synthetic paid corridor quotes initial need and unpromised surplus, with exact minimum, maximum and no upward clamp', () => {
  const state = syntheticPaidCorridor(); const action = proposal(state);
  const first = quoteReliefProposal(state, 1, action); assert.ok(first.ok); assert.equal(first.terms.food, 30);
  assert.equal(first.terms.proposal.horizonRounds, RELIEF_RULES.pendingLifetime + first.terms.travelRounds);
  state.cities.find(city => city.civId === 4)!.population = 50;
  const maximum = quoteReliefProposal(state, 1, action); assert.ok(maximum.ok); assert.equal(maximum.terms.food, 36);
  state.civilizations[4]!.resources.food = 44;
  const minimum = quoteReliefProposal(state, 1, action); assert.ok(minimum.ok); assert.equal(minimum.terms.food, 6);
  state.civilizations[4]!.resources.food = 44.01;
  assert.equal(quoteReliefProposal(state, 1, action).ok, false);
  state.civilizations[4]!.resources.food = 0;
  state.civilizations[1]!.resources.food = 20 + first.terms.proposal.promisedFood + 5.99;
  assert.equal(quoteReliefProposal(state, 1, action).ok, false);
});

void test('synthetic consent leaves stocks unchanged, preserves quoted cargo after recovery, and delivers once at acceptance-relative due round', () => {
  const state = syntheticPaidCorridor(); const opening = structuredClone(state.civilizations); const pending = propose(state);
  assert.deepEqual(state.civilizations, opening); assert.deepEqual(reliefPromisedResources(state, 1), { food: 30, energy: 1 });
  assert.deepEqual(reliefPromisedResources(state, 4), {}); assert.deepEqual(reliefPromisedResources(state, 1, pending.id), {});
  resolve(state, 1); state.civilizations[4]!.resources.food = 27;
  act(state, 4, { type: 'respond-relief', charterId: pending.id, accept: true }); const charter = state.relief!.active[0]!; assert.equal(charter.status, 'accepted');
  if (charter.status !== 'accepted') return;
  assert.equal(charter.dueRound, 1 + charter.terms.travelRounds); assert.equal(charter.terms.food, 30);
  const before = structuredClone(state.civilizations); resolve(state, charter.dueRound - 1); assert.deepEqual(state.civilizations, before);
  resolve(state, charter.dueRound); const result = state.relief!.lastResults[1]!;
  assert.equal(result.outcome, 'delivered'); assert.deepEqual(result.paid, { food: 30, energy: 1 }); assert.equal(result.deliveredFood, 30);
  assert.equal(state.civilizations[1]!.resources.food, before[1]!.resources.food - 30); assert.equal(state.civilizations[1]!.resources.energy, before[1]!.resources.energy - 1);
  assert.equal(state.civilizations[4]!.resources.food, 57); assert.deepEqual(state.routes, syntheticPaidCorridor().routes);
  const unchanged = structuredClone(state); const events: GameEvent[] = []; resolveReliefCharters(state, events); assert.deepEqual(state, unchanged); assert.deepEqual(events, []);
  assert.ok(isReliefState(state.relief, state));
});

void test('synthetic refusals are atomic for unrelated actions, outsiders, wrong exact towns, duplicates and forged quantities', () => {
  const state = syntheticPaidCorridor(); const forged = { ...proposal(state), food: 36 };
  for (const [actor, action] of [[0, proposal(state)], [1, { ...proposal(state), sourceCityId: 'city-0' }], [1, forged], [1, { type: 'wait' }]] as const) {
    const before = structuredClone(state); const events: GameEvent[] = [];
    assert.equal(executeReliefAction(state, actor, action, events), false); assert.deepEqual(state, before); assert.deepEqual(events, []);
  }
  const pending = propose(state); const before = structuredClone(state); const events: GameEvent[] = [];
  assert.equal(executeReliefAction(state, 1, proposal(state), events), false);
  assert.equal(executeReliefAction(state, 1, { type: 'respond-relief', charterId: pending.id, accept: true }, events), false);
  assert.equal(executeReliefAction(state, 0, { type: 'withdraw-relief', charterId: pending.id }, events), false);
  assert.deepEqual(state, before); assert.deepEqual(events, []);
});

void test('synthetic decline, pending donor withdrawal and accepted withdrawal by either party are zero-effect terminal receipts with cooldown', () => {
  for (const kind of ['decline', 'pending-withdraw', 'donor-withdraw', 'recipient-withdraw'] as const) {
    const state = syntheticPaidCorridor(); const charter = kind.includes('pending') || kind === 'decline' ? propose(state) : accept(state);
    const before = structuredClone(state.civilizations);
    act(state, kind === 'decline' || kind === 'recipient-withdraw' ? 4 : 1, kind === 'decline' ? { type: 'respond-relief', charterId: charter.id, accept: false } : { type: 'withdraw-relief', charterId: charter.id });
    const result = state.relief!.lastResults[1]!; assert.equal(result.outcome, kind === 'decline' ? 'declined' : 'withdrawn');
    assert.deepEqual(result.before, result.after); assert.deepEqual(result.paid, { food: 0, energy: 0 }); assert.equal(result.deliveredFood, 0); assert.deepEqual(state.civilizations, before);
    assert.equal(availableReliefActions(state, 1).length, 0); resolve(state, 7); assert.equal(quoteReliefProposal(state, 1, proposal(state)).ok, false);
    resolve(state, 8); const next = propose(state); assert.equal(next.id, 'relief-1-2'); assert.deepEqual(state.relief!.lastResults[1], result);
    assert.ok(isReliefState(state.relief, state));
  }
});

void test('synthetic pending expiry is exclusive and terminal worlds cannot advance it', () => {
  const state = syntheticPaidCorridor(); const charter = propose(state); state.round = 4;
  const action: ReliefAction = { type: 'respond-relief', charterId: charter.id, accept: true }; const before = structuredClone(state); const events: GameEvent[] = [];
  assert.equal(executeReliefAction(state, 4, action, events), false); assert.deepEqual(state, before);
  state.outcome = { kind: 'economic', winners: [0], round: 4, reason: 'Synthetic terminal guard' }; const terminal = structuredClone(state);
  resolveReliefCharters(state, events); assert.deepEqual(state, terminal);
  state.outcome = null; state.revision++; resolveReliefCharters(state, events); commitEvents(state, events); assert.equal(state.relief!.lastResults[1]!.outcome, 'expired');
});

void test('synthetic enabled blocked barter remains eligible; future cargo, upkeep and committed repair cannot be double-promised', () => {
  const state = syntheticPaidCorridor(); const route = state.routes[0]!; assert.equal(route.active, false); assert.equal(state.civilizations[4]!.resources.materials, 0);
  const initial = quoteReliefProposal(state, 1, proposal(state)); assert.ok(initial.ok); assert.ok(initial.terms.proposal.promisedFood >= 2); assert.ok(initial.terms.proposal.promisedEnergy >= 1);
  state.publicProjects = [{ id: 'project-999', routeId: route.id, agreementOfferId: route.agreement!.offerId, proposer: 1, recipient: 4, terms: structuredClone(PUBLIC_PROJECT_RECIPES[0]!.terms), proposedRound: 0, status: 'committed', acceptedRound: 0, dueRound: 2 }];
  const repair = quoteReliefProposal(state, 1, proposal(state)); assert.ok(repair.ok); assert.equal(repair.terms.proposal.promisedEnergy, initial.terms.proposal.promisedEnergy + 1);
  state.civilizations[1]!.resources.energy = repair.terms.proposal.promisedEnergy;
  assert.equal(quoteReliefProposal(state, 1, proposal(state)).ok, false);
});

void test('synthetic structural invalidation and unfunded due transfers preserve all balances and retain truthful failure history', () => {
  const cases: Array<[string, (state: WorldState) => void]> = [
    ['consent', state => { state.routes[0]!.agreement!.enabled = false; state.routes[0]!.agreement!.closedRound = state.round; }],
    ['damage', state => { state.routes[0]!.damage = state.routes[0]!.agreement!.terms.damageDisableAt; }],
    ['impassable corridor', state => { const tileId = state.routes[0]!.agreement!.terms.transport!.tileIds[1]!; state.tiles.find(tile => tile.id === tileId)!.terrain = 'ocean'; }],
    ['missing route', state => { state.routes = []; }],

    ['food', state => { state.civilizations[1]!.resources.food = 29; }],
    ['energy', state => { state.civilizations[1]!.resources.energy = 0; }],
    ['feature', state => { state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== RELIEF_RULES.featureId); }],
  ];
  for (const [name, mutate] of cases) {
    const state = syntheticPaidCorridor(); const charter = accept(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') continue;
    mutate(state); const before = structuredClone(state.civilizations); resolve(state, charter.dueRound);
    const result = state.relief!.lastResults[1]!; assert.equal(result.outcome, 'failed', name); assert.deepEqual(state.civilizations, before, name); assert.deepEqual(result.before, result.after, name);
    assert.ok(isReliefState(state.relief, state), `${name}: durable result cannot require present route ownership or consent`);
  }
});

void test('synthetic reverse-oriented corridor preserves the path and derives delay from edges rather than barter cadence', () => {
  const state = syntheticPaidCorridor(4, 1); state.civilizations[1]!.resources.food = 100; state.civilizations[4]!.resources.food = 0;
  state.cities.find(city => city.civId === 4)!.population = 30; state.cities.find(city => city.civId === 1)!.population = 10;
  const quote = quoteReliefProposal(state, 1, proposal(state)); assert.ok(quote.ok);
  assert.deepEqual(quote.terms.path.tileIds, state.routes[0]!.agreement!.terms.transport!.tileIds.toReversed());
  assert.equal(quote.terms.travelRounds, Math.max(2, Math.ceil(quote.terms.path.edges / 2)));
});

void test('synthetic frozen charter and result snapshots never alias mutable route, active terms or event buffers', () => {
  const state = syntheticPaidCorridor(); const charter = accept(state); const frozen = structuredClone(charter);
  state.routes[0]!.agreement!.terms.transport!.tileIds.reverse(); assert.deepEqual(charter, frozen);
  const events = resolve(state, 1); const result = state.relief!.lastResults[1]!; assert.equal(result.outcome, 'failed');
  const event = events.find(event => event.reliefResult)!; assert.notEqual(event.reliefResult, result); event.reliefResult!.charter.terms.path.tileIds.reverse(); assert.deepEqual(result.charter, frozen);
});

void test('synthetic ownership loss preserves a valid world by retaining both civilizations and retiring the obsolete trade before resolution', () => {
  const state = syntheticPaidCorridor(); const charter = accept(state);
  const source = state.cities.find(city => city.civId === 4)!;
  const refugeTile = state.tiles.find(tile => tile.owner === 4 && tile.id !== source.tileId && !state.cities.some(city => city.tileId === tile.id))!;
  assert.ok(refugeTile);
  const refuge = structuredClone(source); refuge.id = 'synthetic-refuge'; refuge.tileId = refugeTile.id; refuge.population = 1;
  state.cities.push(refuge); source.civId = 3; state.tiles.find(tile => tile.id === source.tileId)!.owner = 3;
  state.routes = []; state.tradeOffers = [];
  assert.ok(isWorldState(state), 'loss fixture must not discard the last town or retain impossible current trade ownership');
  const before = structuredClone(state.civilizations); resolve(state, 1);
  assert.equal(state.relief!.lastResults[1]!.outcome, 'failed'); assert.deepEqual(state.civilizations, before);
  assert.ok(isWorldState(state)); assert.equal(state.relief!.lastResults[1]!.charter.id, charter.id);
});

void test('synthetic second donor resolves in donor order independently of insertion and deterministic JSON restart', () => {
  const state = syntheticPaidCorridor(); accept(state);
  const from = state.cities.find(city => city.civId === 2)!; const to = state.cities.find(city => city.civId === 3)!;
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, 2, { type: 'propose-trade', partner: 3, recipeId: 'harvest-for-materials', sourceCityId: from.id, recipientCityId: to.id }, events); commitEvents(state, events);
  state.revision++; events = []; executeTradeAction(state, 3, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }, events); commitEvents(state, events);
  from.population = 10; to.population = 30; state.civilizations[2]!.resources.food = 100; state.civilizations[2]!.resources.energy = 30; state.civilizations[3]!.resources.food = 0;
  accept(state, 2); assert.deepEqual(state.relief!.active.map(charter => charter.terms.donorId), [1, 2]);
  const restored = JSON.parse(JSON.stringify(state)) as WorldState; restored.relief!.active.reverse();
  const expected = resolve(state, 6); const actual = resolve(restored, 6);
  assert.deepEqual(actual, expected); assert.deepEqual(restored, state); assert.deepEqual(expected.map(event => event.reliefResult!.charter.terms.donorId), [1, 2]);
});

void test('synthetic steam consent uses ordinary land delay and zero Coal even when the trade itself lacks fuel', () => {
  const state = syntheticPaidCorridor(); const route = state.routes[0]!; const land = route.agreement!.terms.transport!;
  const steam = { mode: 'steam' as const, ruleVersion: 1 as const, tileIds: [...land.tileIds], edges: land.edges, edgeWeights: Array.from({ length: land.edges }, () => 1), railEdges: [], weightedDistance: land.edges, baseCadence: 4, unrailedEdges: land.edges, unrailedCadence: Math.max(4, Math.ceil(land.edges / 2)), proposerFuel: { coal: 1 as const } };
  route.agreement!.terms.transport = steam; state.tradeOffers![0]!.terms.transport = structuredClone(steam);
  state.civilizations[1]!.strategicResources = { coal: 0 }; const charter = accept(state);
  assert.equal(charter.terms.travelRounds, Math.max(2, Math.ceil(land.edges / 2))); assert.equal(charter.status, 'accepted');
  if (charter.status !== 'accepted') return;
  resolve(state, charter.dueRound); assert.equal(state.relief!.lastResults[1]!.outcome, 'delivered'); assert.deepEqual(state.civilizations[1]!.strategicResources, { coal: 0 });
});

void test('synthetic accepted aid honors the full promise despite donor reserve risk, while a recovered recipient can explicitly withdraw', () => {
  const state = syntheticPaidCorridor(); const charter = accept(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') return;
  state.civilizations[1]!.resources.food = charter.terms.food; state.civilizations[4]!.resources.food = 100;
  state.round = charter.dueRound; state.revision++; const events: GameEvent[] = []; resolveTrade(state, events); resolveReliefCharters(state, events); commitEvents(state, events);
  assert.equal(state.relief!.lastResults[1]!.outcome, 'delivered'); assert.equal(state.civilizations[1]!.resources.food, 0);
  const withdrawn = syntheticPaidCorridor(); const accepted = accept(withdrawn); withdrawn.civilizations[4]!.resources.food = 100;
  act(withdrawn, 4, { type: 'withdraw-relief', charterId: accepted.id }); assert.equal(withdrawn.relief!.lastResults[1]!.outcome, 'withdrawn');
});

void test('synthetic unordered-pair restriction rejects a reverse offer after needs reverse without silently replacing consent', () => {
  const state = syntheticPaidCorridor(); propose(state);
  state.civilizations[1]!.resources.food = 0; state.civilizations[4]!.resources.food = 100;
  state.cities.find(city => city.civId === 1)!.population = 30; state.cities.find(city => city.civId === 4)!.population = 10;
  const before = structuredClone(state); const events: GameEvent[] = [];
  assert.equal(executeReliefAction(state, 4, proposal(state, 4), events), false); assert.deepEqual(state, before); assert.deepEqual(events, []);
});

void test('synthetic acceptance excludes its own promise rather than charging exact available cargo twice', () => {
  const state = syntheticPaidCorridor(); const pending = propose(state);
  const agreement = state.routes[0]!.agreement!;
  const deliveries = agreement.nextDeliveryRound <= pending.terms.travelRounds ? Math.floor((pending.terms.travelRounds - agreement.nextDeliveryRound) / agreement.terms.cadenceRounds) + 1 : 0;
  state.civilizations[1]!.resources.food = pending.terms.food + deliveries * (agreement.terms.proposerCargo.food ?? 0);
  state.civilizations[1]!.resources.energy = 1 + deliveries * (agreement.terms.proposerUpkeep.energy ?? 0);
  act(state, 4, { type: 'respond-relief', charterId: pending.id, accept: true }); assert.equal(state.relief!.active[0]!.status, 'accepted');
});

void test('synthetic real geography admits the ten-edge corridor but refuses an over-twelve-edge consenting trade', () => {
  const far = syntheticPaidCorridor(2, 3); const quote = quoteReliefProposal(far, 2, proposal(far, 2)); assert.ok(quote.ok);
  assert.equal(quote.terms.path.edges, 10); assert.equal(quote.terms.travelRounds, 5);
  const distant = syntheticPaidCorridor(0, 3); assert.ok(distant.routes[0]!.agreement!.terms.transport!.edges > 12);
  assert.equal(quoteReliefProposal(distant, 0, proposal(distant, 0)).ok, false);
});

void test('synthetic actual command integration admits exact relief, rejects forged action fields and detaches spectator observation', () => {
  const initial = syntheticPaidCorridor(); const action = proposal(initial); const before = structuredClone(initial);
  const forged = { ...action, food: 36 };
  assert.ok(isGameAction(action)); assert.equal(isGameAction(forged), false);
  assert.ok(legalActions(initial, 1, epoch).some(option => JSON.stringify(option.action) === JSON.stringify(action)));
  const rejected = applyCommand(initial, { seat: 1, action: forged, expectedRevision: initial.revision, timestamp: epoch });
  assert.equal(rejected.ok, false); assert.deepEqual(initial, before);
  const proposed = applyCommand(initial, { seat: 1, action, expectedRevision: initial.revision, timestamp: epoch });
  assert.ok(proposed.ok, proposed.error); assert.deepEqual(initial, before); assert.ok(isWorldState(proposed.state));
  const charter = proposed.state.relief!.active[0]!;
  const accepted = applyCommand(proposed.state, { seat: 4, action: { type: 'respond-relief', charterId: charter.id, accept: true }, expectedRevision: proposed.state.revision, timestamp: epoch });
  assert.ok(accepted.ok, accepted.error); assert.ok(accepted.events.some(event => event.type === 'relief-accepted')); assert.ok(isWorldState(accepted.state));
  const snapshot = structuredClone(accepted.state); const observed = observe(accepted.state, 4, epoch);
  assert.deepEqual(observed.relief, accepted.state.relief); observed.relief!.active[0]!.terms.path.tileIds.reverse(); observed.relief!.active.length = 0;
  assert.deepEqual(accepted.state, snapshot);
});
