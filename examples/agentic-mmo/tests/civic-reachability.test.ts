import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, TransitionResult, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';

function civicWorld(): WorldState {
  const state = createWorld(17, epoch, 'settlement-civics-1');
  assert.ok(isWorldState(state));
  return state;
}

class LegalJourney {
  state = civicWorld();
  milliseconds = Date.parse(epoch);
  commands = 0;
  beats = 0;

  timestamp(): string { return new Date(this.milliseconds).toISOString(); }

  accept(run: (state: WorldState) => TransitionResult): TransitionResult {
    const before = structuredClone(this.state);
    const restored: unknown = JSON.parse(JSON.stringify(this.state));
    assert.ok(isWorldState(restored));
    const result = run(this.state);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(run(restored), result);
    assert.deepEqual(this.state, before);
    assert.ok(isWorldState(result.state));
    this.state = result.state;
    return result;
  }

  act(seat: number, action: GameAction): void {
    this.accept((state) => catchUpStrategy(state, this.timestamp()));
    assert.ok(legalActions(this.state, seat, this.timestamp()).some((option) => JSON.stringify(option.action) === JSON.stringify(action)), `Unavailable ${JSON.stringify(action)} at round ${this.state.round}`);
    const command = { seat, expectedRevision: this.state.revision, timestamp: this.timestamp(), action };
    this.accept((state) => applyCommand(state, command));
    this.commands += 1;
    this.milliseconds += 10_000;
  }

  beat(): void {
    this.milliseconds = Date.parse(epoch) + ((this.state.independentTurns?.strategyTicks ?? 0) + 1) * 60_000;
    this.accept((state) => catchUpStrategy(state, this.timestamp()));
    this.beats += 1;
  }

  until(condition: (state: WorldState) => boolean): void {
    for (let remaining = 40; !condition(this.state) && remaining > 0; remaining--) this.beat();
    assert.ok(condition(this.state), `Legal progress did not reach its bounded objective at round ${this.state.round}`);
  }

  knows(seat: number, technology: string): boolean {
    return this.state.civilizations.find((civilization) => civilization.id === seat)?.technologies.includes(technology) ?? false;
  }

  build(seat: number, project: string): void {
    const city = this.state.cities.find((candidate) => candidate.civId === seat);
    assert.ok(city);
    this.act(seat, { type: 'build', project, cityId: city.id });
  }

  route(proposer: number, recipient: number): void {
    this.act(proposer, { type: 'propose-trade', partner: recipient, recipeId: 'harvest-for-materials' });
    const offer = this.state.tradeOffers?.find((candidate) => candidate.proposer === proposer && candidate.recipient === recipient && candidate.status === 'pending');
    assert.ok(offer);
    assert.equal(this.state.routes.some((candidate) => candidate.agreement?.offerId === offer.id), false);
    this.act(recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
    const route = this.state.routes.find((candidate) => candidate.agreement?.offerId === offer.id);
    assert.ok(route);
    assert.equal(route.agreement?.deliveryCount, 0);
  }
}

function civicJourney(): LegalJourney {
  const journey = new LegalJourney();
  assert.equal(legalActions(journey.state, 0, epoch).some(({ action }) => action.type === 'research' && action.technology === 'civic-institutions'), false);
  for (const seat of [0, 1, 2]) journey.act(seat, { type: 'research', technology: 'agriculture' });
  journey.until(() => [0, 1, 2].every((seat) => journey.knows(seat, 'agriculture')));
  for (const seat of [0, 1, 2]) journey.build(seat, 'farm');
  assert.ok(journey.state.calendarMilestones.includes('first-harvest'));
  for (const seat of [0, 1]) journey.act(seat, { type: 'research', technology: 'civic-institutions' });
  journey.route(0, 1);
  journey.route(1, 2);
  journey.route(2, 0);
  journey.until(() => [0, 1].every((seat) => journey.knows(seat, 'civic-institutions')) && journey.state.routes.every((route) => (route.agreement?.deliveryCount ?? 0) > 0));
  assert.ok(journey.state.calendarMilestones.includes('roads-between-peoples'));
  assert.ok(journey.state.calendarMilestones.includes('rise-of-states'));
  assert.ok(journey.state.civilizations.every((civilization) => civilization.era === 1));
  assert.equal(journey.state.year, -10000);
  journey.build(0, 'academy');
  journey.act(0, { type: 'research', technology: 'kiln-firing' });
  journey.until(() => journey.knows(0, 'kiln-firing'));
  const academy = journey.state.cities.find((city) => city.civId === 0)?.buildingOperations?.academy?.lastResult;
  assert.equal(academy?.status, 'operated');
  assert.deepEqual(academy.paid, { credits: 1, culture: 2 });
  assert.ok((academy.produced.science ?? 0) > 0);
  assert.equal(academy.produced.culture, undefined);
  journey.act(0, { type: 'research', technology: 'fuel-management' });
  journey.until(() => journey.knows(0, 'fuel-management'));
  journey.build(0, 'fuel-yard');
  journey.build(0, 'kiln');
  journey.beat();
  const fuel = journey.state.cities.find((city) => city.civId === 0)?.buildingOperations?.['fuel-yard']?.lastResult;
  assert.equal(fuel?.status, 'operated');
  assert.deepEqual(fuel.paid, { materials: 2 });
  assert.ok((fuel.produced.energy ?? 0) > 0);
  return journey;
}

await test('legal civic research, consented delivery and historical rise of states reach paid learning and useful fuel production', (context) => {
  const journey = civicJourney();
  assert.ok(journey.commands > 15 && journey.commands < 40);
  assert.ok(journey.beats < 80);
  assert.ok(journey.state.civilizations[0]?.technologies.includes('fuel-management'));
  assert.ok(journey.state.routes.length === 3 && journey.state.routes.every((route) => route.agreement?.enabled));
  context.diagnostic(JSON.stringify({ commands: journey.commands, explicitBeats: journey.beats, strategicTicks: journey.state.independentTurns?.strategyTicks, round: journey.state.round, routeDeliveries: journey.state.routes.map((route) => route.agreement?.deliveryCount), technologies: journey.state.civilizations[0]?.technologies, source: 'legal deterministic test witness; not live model play' }));
});

await test('isolated synthetic culture shortage cannot spend same-beat gathering-place output on academy operation', () => {
  const journey = civicJourney();
  journey.build(0, 'monument');
  const fixture = structuredClone(journey.state);
  const civilization = fixture.civilizations.find((candidate) => candidate.id === 0);
  assert.ok(civilization);
  civilization.resources.culture = 0;
  assert.ok(isWorldState(fixture));
  const before = structuredClone(fixture);
  const timestamp = new Date(Date.parse(epoch) + ((fixture.independentTurns?.strategyTicks ?? 0) + 1) * 60_000).toISOString();
  const result = catchUpStrategy(fixture, timestamp);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(fixture, before);
  const city = result.state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  assert.ok(city.buildings.includes('monument'));
  const receipt = city.buildingOperations?.academy?.lastResult;
  assert.equal(receipt?.status, 'blocked');
  assert.deepEqual(receipt.paid, {});
  assert.deepEqual(receipt.produced, {});
  assert.ok(receipt.shortages.some((shortage) => shortage.resource === 'culture' && shortage.required === 2 && shortage.available === 0));
  assert.ok((result.state.civilizations[0]?.resources.culture ?? 0) > 2);
  assert.deepEqual(catchUpStrategy(structuredClone(fixture), timestamp), result);
});

await test('isolated synthetic energy shortage cannot spend same-beat fuel-yard output on kiln operation', () => {
  const journey = civicJourney();
  const fixture = structuredClone(journey.state);
  const civilization = fixture.civilizations.find((candidate) => candidate.id === 0);
  assert.ok(civilization);
  civilization.resources.energy = 0;
  assert.ok(isWorldState(fixture));
  const before = structuredClone(fixture);
  const timestamp = new Date(Date.parse(epoch) + ((fixture.independentTurns?.strategyTicks ?? 0) + 1) * 60_000).toISOString();
  const result = catchUpStrategy(fixture, timestamp);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(fixture, before);
  const operations = result.state.cities.find((candidate) => candidate.civId === 0)?.buildingOperations;
  assert.equal(operations?.['fuel-yard']?.lastResult?.status, 'operated');
  assert.deepEqual(operations?.['fuel-yard']?.lastResult?.paid, { materials: 2 });
  assert.ok((operations?.['fuel-yard']?.lastResult?.produced.energy ?? 0) > 0);
  const kiln = operations?.kiln?.lastResult;
  assert.equal(kiln?.status, 'blocked');
  assert.deepEqual(kiln.paid, {});
  assert.deepEqual(kiln.produced, {});
  assert.ok(kiln.shortages.some((shortage) => shortage.resource === 'energy' && shortage.required === 2 && shortage.available === 0));
  assert.deepEqual(catchUpStrategy(structuredClone(fixture), timestamp), result);
});
