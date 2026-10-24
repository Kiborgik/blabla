import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import { TRADE_RECIPES } from '../core/content.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import { createStrategicDeposits } from '../core/simulation/metals.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { metalEconomyPrefix } from './fixtures/metal-economy-prefix.ts';

export function connectedMetalJourney(prefix = metalEconomyPrefix()) {
  let state = structuredClone(prefix.state);
  const steps: CoastalPrefixStep[] = [];
  const researchWork: Array<{ seat: number; technology: string; startedRound: number; completedRound: number; progress: number[] }> = [];
  const time = (seat = 0): string => {
    assert.ok(state.independentTurns);
    return coastalPrefixTime(Math.max(state.independentTurns.strategyTicks * 60 + 20, ((state.independentTurns.lastActionWindow[seat] ?? -1) + 1) * 10));
  };
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state), `Canonical world after ${JSON.stringify(input)} at revision ${result.state.revision}`);
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (seat: number, action: GameAction): void => {
    assert.ok(legalActions(state, seat, time(seat)).some(option => sameAction(option.action, action)), `Unavailable ${JSON.stringify(action)} at round ${state.round}`);
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(seat), action } });
  };
  const beat = (): void => { assert.ok(state.independentTurns); commit({ kind: 'strategy', timestamp: coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60) }); };
  const until = (condition: () => boolean, maximum = 120): void => {
    for (let count = 0; count < maximum && !condition(); count++) beat();
    assert.ok(condition(), `Bounded legal objective not reached at round ${state.round}`);
  };
  const research = (seat: number, technology: string): void => {
    act(seat, { type: 'research', technology });
    const startedRound = state.round;
    const progress: number[] = [state.civilizations[seat]?.researchProgress ?? 0];
    for (let count = 0; count < 120; count++) { if (state.civilizations[seat]?.technologies.includes(technology)) break; beat(); progress.push(state.civilizations[seat]?.researchProgress ?? 0); }
    assert.ok(state.civilizations[seat]?.technologies.includes(technology));
    researchWork.push({ seat, technology, startedRound, completedRound: state.round, progress });
  };
  const build = (cityId: string, project: string, tileId?: number): void => {
    const city = state.cities.find(candidate => candidate.id === cityId); assert.ok(city);
    act(city.civId, { type: 'build', cityId, project, ...(tileId === undefined ? {} : { tileId }) });
    until(() => !state.cities.find(candidate => candidate.id === cityId)?.construction?.active);
  };
  return { prefix, get state() { return state; }, steps, researchWork, time, act, beat, until, research, build };
}

await test('fresh connected-metal rules expose actual Bronze and Currency decisions', () => {
  const journey = connectedMetalJourney();
  assert.deepEqual(journey.state.tiles, journey.prefix.state.tiles);
  for (const technology of ['bronze-working', 'currency']) assert.ok(legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'research' && option.action.technology === technology));
  assert.ok(TRADE_RECIPES.some(recipe => recipe.id === 'iron-for-food'));
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'propose-trade' && option.action.recipeId === 'iron-for-food'));
});

export function metalDeliveryJourney() {
  const journey = connectedMetalJourney();
  const prepared = structuredClone(journey.state);
  journey.beat();
  const unrevealed = structuredClone(journey.state);
  journey.research(0, 'bronze-working');
  const discovered = structuredClone(journey.state);
  journey.beat();
  const extracted = structuredClone(journey.state);
  journey.research(0, 'currency');
  const beforeProposal = structuredClone(journey.state);
  journey.act(0, { type: 'propose-trade', partner: 1, recipeId: 'iron-for-food', sourceCityId: 'city-0', recipientCityId: 'city-1' });
  const offer = journey.state.tradeOffers?.find(candidate => candidate.status === 'pending' && candidate.terms.recipeId === 'iron-for-food'); assert.ok(offer);
  const proposed = structuredClone(journey.state);
  journey.act(1, { type: 'respond-trade', offerId: offer.id, accept: true });
  const route = journey.state.routes.find(candidate => candidate.agreement?.offerId === offer.id); assert.ok(route?.agreement);
  const accepted = structuredClone(journey.state);
  journey.until(() => (journey.state.routes.find(candidate => candidate.id === route.id)?.agreement?.deliveryCount ?? 0) > 0);
  return { journey, prepared, unrevealed, discovered, extracted, beforeProposal, proposed, accepted, routeId: route.id };
}

function nextMetalBeat(state: WorldState): WorldState {
  const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60));
  assert.ok(result.ok, result.error); return result.state;
}

await test('Bronze reveals actual finite iron and the same staffed Mine conserves reserve and credited stock', context => {
  const result = metalDeliveryJourney();
  assert.deepEqual(observe(result.unrevealed, 0).revealedDeposits, []);
  assert.ok(observe(result.discovered, 0).revealedDeposits?.some(deposit => deposit.tileId === 58));
  assert.deepEqual(observe(result.discovered, 1).revealedDeposits, []);
  const hidden = result.unrevealed.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction; assert.ok(hidden);
  assert.equal(hidden.status, 'unrevealed'); assert.equal(hidden.quantity, 0);
  const receipt = result.extracted.cities[0]?.improvements?.['58']?.operation.lastResult; assert.ok(receipt?.extraction);
  assert.equal(receipt.residents.allocated, 1); assert.ok((receipt.produced.materials ?? 0) > 0);
  assert.equal(receipt.extraction.quantity, 2); assert.equal(receipt.extraction.reserveBefore - receipt.extraction.reserveAfter, 2); assert.equal(receipt.extraction.stockAfter - receipt.extraction.stockBefore, 2);
  assert.deepEqual(result.extracted.events.find(event => event.strategicExtraction?.tileId === 58 && event.round === receipt.round)?.strategicExtraction, receipt.extraction);
  assert.equal(result.discovered.civilizations[0]?.strategicResources?.iron ?? 0, 0);
  context.diagnostic(JSON.stringify({ research: result.journey.researchWork, extraction: receipt.extraction, revision: result.journey.state.revision, round: result.journey.state.round }));
});

await test('legal Currency proposal and recipient consent retain exact mixed cargo and deliver only on the acceptance-relative due beat', () => {
  const result = metalDeliveryJourney();
  assert.deepEqual(result.proposed.civilizations, result.beforeProposal.civilizations);
  const route = result.accepted.routes.find(candidate => candidate.id === result.routeId); assert.ok(route?.agreement);
  assert.deepEqual(route.agreement.terms.strategicCargo, { proposer: { iron: 2 }, recipient: {} });
  assert.equal(route.agreement.terms.transport?.edges, 9); assert.equal(route.agreement.terms.cadenceRounds, 5);
  assert.equal(route.agreement.nextDeliveryRound, result.accepted.round + 5); assert.equal(route.agreement.deliveryCount, 0);
  assert.deepEqual(result.accepted.civilizations.map(civ => civ.strategicResources), result.proposed.civilizations.map(civ => civ.strategicResources));
  assert.equal(result.accepted.civilizations[0]?.resources.materials, (result.proposed.civilizations[0]?.resources.materials ?? 0) - 6);
  assert.equal(result.accepted.civilizations[0]?.resources.credits, (result.proposed.civilizations[0]?.resources.credits ?? 0) - 8);
  const event = result.journey.state.events.find(candidate => candidate.strategicShipment?.routeId === result.routeId); assert.ok(event?.strategicShipment);
  assert.deepEqual(event.strategicShipment.proposerSent, { iron: 2 }); assert.deepEqual(event.strategicShipment.recipientSent, {});
  assert.equal(result.journey.state.civilizations[1]?.strategicResources?.iron, 2);
  assert.equal(result.journey.state.routes.find(candidate => candidate.id === result.routeId)?.volume, 7);
  for (const step of result.journey.steps) assert.deepEqual(replayCoastalStep(structuredClone(step.before), step.input), step.result);
});

await test('synthetic last-unit, storage-full and retained over-cap stocks never lose uncredited ore', () => {
  const { extracted } = metalDeliveryJourney();
  for (const [remaining, stock, quantity, status] of [[1, 0, 1, 'extracted'], [240, 80, 0, 'storage-full'], [240, 100, 0, 'storage-full'], [0, 0, 0, 'exhausted']] as const) {
    const state = structuredClone(extracted); const deposit = state.strategicDeposits?.deposits['58']; const civ = state.civilizations[0]; assert.ok(deposit && civ?.strategicResources);
    deposit.remaining = remaining; civ.strategicResources.iron = stock;
    const result = nextMetalBeat(state); const receipt = result.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction; assert.ok(receipt);
    assert.equal(receipt.quantity, quantity); assert.equal(receipt.status, status); assert.equal(receipt.reserveAfter, remaining - quantity); assert.equal(receipt.stockAfter, stock + quantity);
    assert.equal(state.civilizations[0]?.strategicResources?.iron, stock);
  }
});

await test('synthetic gross metal, upkeep and receiving-space failure blocks the entire due exchange with zero payment', () => {
  const result = metalDeliveryJourney();
  for (const blocker of ['iron', 'energy', 'storage'] as const) {
    const state = structuredClone(result.accepted); const route = state.routes.find(candidate => candidate.id === result.routeId); assert.ok(route?.agreement);
    state.round = route.agreement.nextDeliveryRound;
    const owner = state.civilizations[0]; const recipient = state.civilizations[1]; assert.ok(owner?.strategicResources && recipient?.strategicResources);
    if (blocker === 'iron') owner.strategicResources.iron = 1;
    if (blocker === 'energy') owner.resources.energy = 0;
    if (blocker === 'storage') recipient.strategicResources.iron = 40;
    const before = structuredClone(state.civilizations); const events = [] as Parameters<typeof resolveTrade>[1];
    resolveTrade(state, events);
    assert.deepEqual(state.civilizations, before); assert.equal(route.agreement.deliveryCount, 0); assert.equal(route.active, false);
    assert.equal(events[0]?.type, 'trade-blocked'); assert.ok(route.agreement.blockedReason);
  }
});

await test('legally stopped equal-beat control isolates both complete cargo vectors, upkeep and commerce', () => {
  const result = metalDeliveryJourney();
  const timestamp = coastalPrefixTime((result.accepted.independentTurns?.strategyTicks ?? 0) * 60 + 40);
  const stopped = applyCommand(result.accepted, { seat: 0, expectedRevision: result.accepted.revision, timestamp, action: { type: 'stop-trade', routeId: result.routeId } }); assert.ok(stopped.ok, stopped.error);
  let control = stopped.state;
  while (control.round < result.journey.state.round) control = nextMetalBeat(control);
  const delivered = result.journey.state;
  const delta = (seat: number, resource: keyof WorldState['civilizations'][number]['resources']): number => Math.round(((delivered.civilizations[seat]?.resources[resource] ?? 0) - (control.civilizations[seat]?.resources[resource] ?? 0)) * 100) / 100;
  assert.equal((delivered.civilizations[0]?.strategicResources?.iron ?? 0) - (control.civilizations[0]?.strategicResources?.iron ?? 0), -2);
  assert.equal((delivered.civilizations[1]?.strategicResources?.iron ?? 0) - (control.civilizations[1]?.strategicResources?.iron ?? 0), 2);
  assert.equal(delta(0, 'food'), 5); assert.equal(delta(1, 'food'), -5);
  for (const seat of [0, 1]) { assert.equal(delta(seat, 'energy'), -1); assert.equal(delta(seat, 'credits'), 2); }
});

await test('paused and resident-blocked Mines retain finite reserves while a new paid Mine first extracts after its completion beat', () => {
  const result = metalDeliveryJourney();
  const paused = applyCommand(result.extracted, { seat: 0, expectedRevision: result.extracted.revision, timestamp: coastalPrefixTime((result.extracted.independentTurns?.strategyTicks ?? 0) * 60 + 20), action: { type: 'set-improvement-operation', cityId: 'city-0', tileId: 58, improvementId: 'mine', enabled: false } });
  assert.ok(paused.ok, paused.error);
  const quiet = nextMetalBeat(paused.state);
  assert.equal(quiet.strategicDeposits?.deposits['58']?.remaining, result.extracted.strategicDeposits?.deposits['58']?.remaining);
  assert.equal(quiet.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction, undefined);
  const scarce = structuredClone(result.extracted); assert.ok(scarce.cities[0]); scarce.cities[0].population = 3;
  const blocked = nextMetalBeat(scarce);
  assert.equal(blocked.strategicDeposits?.deposits['58']?.remaining, scarce.strategicDeposits?.deposits['58']?.remaining);
  assert.equal(blocked.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction, undefined);
  const prefix = metalEconomyPrefix(); const index = prefix.steps.findIndex(step => step.input.kind === 'action' && step.input.command.action.type === 'improve' && step.input.command.action.cityId === 'city-0' && step.input.command.action.tileId === 58 && step.input.command.action.improvementId === 'mine'); assert.ok(index >= 0);
  const earlier = prefix.steps[index]; assert.ok(earlier);
  const run = connectedMetalJourney({ ...prefix, state: structuredClone(earlier.before), steps: prefix.steps.slice(0, index) });
  run.research(0, 'bronze-working');
  run.act(0, { type: 'improve', cityId: 'city-0', tileId: 58, improvementId: 'mine' });
  run.until(() => !run.state.cities[0]?.construction?.active);
  assert.equal(run.state.cities[0]?.improvements?.['58']?.operation.lastResult, null);
  assert.equal(run.state.strategicDeposits?.deposits['58']?.remaining, 240);
  run.beat(); const operated = structuredClone(run.state); assert.equal(operated.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction?.quantity, 2);
});

await test('canonical strategic observations and compact recipe terms are detached and never reveal deposits to an undiscovered civilization', async () => {
  const { observeCompactTrade } = await import('../core/observation.ts');
  const result = metalDeliveryJourney();
  const observation = observe(result.extracted, 0); assert.equal(observation.strategicCapacity, 80);
  const deposit = observation.revealedDeposits?.find(candidate => candidate.tileId === 58); assert.ok(deposit); deposit.remaining = 999;
  assert.notEqual(result.extracted.strategicDeposits?.deposits['58']?.remaining, 999);
  const compact = observeCompactTrade(result.beforeProposal, 0, coastalPrefixTime((result.beforeProposal.independentTurns?.strategyTicks ?? 0) * 60 + 40));
  const recipe = compact.tradeFacts.recipes.find(candidate => candidate.id === 'iron-for-food'); assert.ok(recipe?.terms.strategicCargo);
  assert.deepEqual(recipe.terms.strategicCargo.proposer, { iron: 2 }); recipe.terms.strategicCargo.proposer.iron = 999;
  assert.equal(TRADE_RECIPES.find(candidate => candidate.id === 'iron-for-food')?.terms.strategicCargo?.proposer.iron, 2);
});

await test('placement is independent of container order and later economy preserves retained stocks', () => {
  const journey = connectedMetalJourney();
  const reordered = structuredClone(journey.prefix.state); reordered.tiles.reverse(); reordered.cities.reverse(); reordered.civilizations.reverse();
  assert.deepEqual(createStrategicDeposits(reordered), journey.state.strategicDeposits);
  const reduced = structuredClone(journey.state); assert.ok(reduced.civilizations[0]?.strategicResources);
  reduced.civilizations[0].strategicResources.iron = 80;
  reduced.cities = reduced.cities.filter(city => city.tileId !== 23);
  const after = nextMetalBeat(reduced);
  assert.equal(after.civilizations[0]?.strategicResources?.iron, 80);
  assert.equal(observe(after, 0).strategicCapacity, 40);
});

await test('a pending six-resource offer retains exact terms and schedule through consent and scheduled delivery', () => {
  const prefix = metalEconomyPrefix();
  const proposal = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action: { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' } }); assert.ok(proposal.ok, proposal.error);
  const offer = proposal.state.tradeOffers?.find(candidate => candidate.status === 'pending'); assert.ok(offer);
  const accepted = applyCommand(proposal.state, { seat: 1, expectedRevision: proposal.state.revision, timestamp: prefix.timestamp, action: { type: 'respond-trade', offerId: offer.id, accept: true } }); assert.ok(accepted.ok, accepted.error);
  const agreement = accepted.state.routes.find(route => route.agreement?.offerId === offer.id)?.agreement; assert.ok(agreement);
  assert.deepEqual(agreement.terms, offer.terms); assert.equal(agreement.terms.strategicCargo, undefined);
  assert.equal(agreement.nextDeliveryRound, accepted.state.round + offer.terms.cadenceRounds);
  let state = accepted.state;
  while (state.round < agreement.nextDeliveryRound) state = nextMetalBeat(state);
  assert.equal(state.routes.find(route => route.agreement?.offerId === offer.id)?.agreement?.deliveryCount, 1);
  assert.deepEqual(state.civilizations.map(civ => civ.strategicResources), [{}, {}, {}, {}, {}]);
});

await test('an active paid Mine preserves its retained deposit site and exact construction', () => {
  const prefix = metalEconomyPrefix();
  const start = prefix.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'improve' && step.input.command.action.tileId === 58);
  assert.ok(start && start.input.kind === 'action' && start.input.command.timestamp);
  assert.ok(isWorldState(start.result.state));
  const expected = createStrategicDeposits(start.before);
  assert.ok(expected.tileIds.includes(58));
  assert.deepEqual(createStrategicDeposits(start.result.state), expected);
  assert.deepEqual(start.result.state.strategicDeposits, start.before.strategicDeposits);
  assert.ok(isWorldState(JSON.parse(JSON.stringify(start.result.state))));
});
