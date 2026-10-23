import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RESOURCE_IDS, TURN_RULES } from '../core/content.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, PublicProject, Resources, TransitionResult, WorldState } from '../core/types.ts';

const EPOCH = '2026-10-16T00:00:00.000Z';

function accepted(result: TransitionResult): WorldState {
  assert.ok(result.ok, result.error);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function nextBeat(state: WorldState): string {
  const ledger = state.independentTurns;
  assert.ok(ledger);
  return new Date(Date.parse(ledger.epoch) + (ledger.strategyTicks + 1) * TURN_RULES.strategyIntervalMs).toISOString();
}

function legalFixture() {
  let state = createWorld(17, EPOCH, 'settlement-charters-1');
  let timestamp = EPOCH;
  const act = (seat: number, action: GameAction) => {
    state = accepted(catchUpStrategy(state, timestamp));
    assert.ok(legalActions(state, seat, timestamp).some((option) => isDeepStrictEqual(option.action, action)));
    state = accepted(applyCommand(state, { seat, expectedRevision: state.revision, action, timestamp }));
    timestamp = new Date(Date.parse(timestamp) + TURN_RULES.tacticalWindowMs).toISOString();
  };
  const beat = () => { timestamp = nextBeat(state); state = accepted(catchUpStrategy(state, timestamp)); };
  const until = (condition: () => boolean) => { for (let n = 0; n < 60 && !condition(); n++) beat(); assert.ok(condition()); };
  for (const seat of [0, 1, 2]) act(seat, { type: 'research', technology: 'agriculture' });
  until(() => [0, 1, 2].every((seat) => state.civilizations[seat]?.technologies.includes('agriculture')));
  for (const seat of [0, 1, 2]) act(seat, { type: 'build', project: 'farm', cityId: `city-${seat}` });
  for (const seat of [0, 1]) act(seat, { type: 'research', technology: 'civic-institutions' });
  for (const [proposer, recipient] of [[0, 1], [1, 2], [2, 0]] as const) {
    act(proposer, { type: 'propose-trade', partner: recipient, recipeId: 'harvest-for-materials' });
    const offer = state.tradeOffers?.find((candidate) => candidate.proposer === proposer && candidate.recipient === recipient && candidate.status === 'pending');
    assert.ok(offer);
    act(recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
  }
  until(() => state.calendarMilestones.includes('rise-of-states'));
  for (const seat of [0, 1]) act(seat, { type: 'build', project: 'monument', cityId: `city-${seat}` });
  act(5, { type: 'event', event: 'earthquake', target: 0 });
  until(() => state.directorCooldown === 0);
  act(5, { type: 'event', event: 'earthquake', target: 0 });
  for (let n = 0; n < 4 && state.round % 4 !== 2; n++) beat();
  assert.equal(state.round % 4, 2);
  const route = state.routes.find((candidate) => candidate.owner === 0 && candidate.partner === 1);
  assert.ok(route);
  act(0, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' });
  const project = state.publicProjects?.[0];
  assert.ok(project);
  return { state, timestamp, project: structuredClone(project) };
}

function routeHistory(state: WorldState) {
  return state.routes.map(({ damage: _damage, ...route }) => route);
}

export class PublicProjectProbes {
  private readonly baseline = legalFixture();
  private state!: WorldState;
  private timestamp = EPOCH;
  private project!: PublicProject;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private completed = false;
  private paidUnits = 0;
  private atomic = true;
  private zeroWithoutCompletion = true;
  private clamped = true;
  private shipments = true;
  private refusal = true;
  private synthetic = false;

  constructor() { this.reset(); }
  reset(): void { this.prepare(0); }

  private clear(): void {
    this.result = null;
    this.control = null;
    this.completed = false;
    this.paidUnits = 0;
    this.atomic = true;
    this.zeroWithoutCompletion = true;
    this.clamped = true;
    this.shipments = true;
    this.refusal = true;
  }

  prepare(kind: number): void {
    const initial = structuredClone(this.baseline);
    this.state = initial.state;
    this.timestamp = initial.timestamp;
    this.project = initial.project;
    this.synthetic = kind >= 3 && kind <= 8;
    this.clear();
    if (kind >= 1 && kind <= 9) {
      this.state = accepted(applyCommand(this.state, { seat: 1, expectedRevision: this.state.revision, action: { type: 'respond-public-project', projectId: this.project.id, accept: true }, timestamp: this.timestamp }));
      const committed = this.state.publicProjects?.[0];
      assert.ok(committed);
      this.project = structuredClone(committed);
      if (kind >= 2) {
        this.timestamp = nextBeat(this.state);
        this.state = accepted(catchUpStrategy(this.state, this.timestamp));
      }
    }
    const route = this.state.routes.find((candidate) => candidate.id === this.project.routeId);
    assert.ok(route?.agreement);
    if (kind === 3 || kind === 4) route.damage = kind === 3 ? 7 : 0;
    if (kind === 5 || kind === 6) {
      const seat = kind === 5 ? 0 : 1;
      const owner = this.state.civilizations.find((candidate) => candidate.id === seat);
      assert.ok(owner);
      owner.resources.energy = 0;
      for (const city of this.state.cities.filter((candidate) => candidate.civId === seat)) city.damage = 100;
    }
    if (kind === 7) {
      this.state.routes = this.state.routes.filter((candidate) => candidate.id !== route.id);
      this.state.tradeOffers = this.state.tradeOffers?.filter((offer) => offer.routeId !== route.id) ?? [];
    }
    if (kind === 8) {
      const offer = this.state.tradeOffers?.find((candidate) => candidate.id === route.agreement?.offerId);
      assert.ok(offer);
      offer.id = 'synthetic-replaced-agreement';
      route.agreement.offerId = offer.id;
    }
    if (kind === 9) this.state = accepted(applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, action: { type: 'stop-trade', routeId: route.id }, timestamp: this.timestamp }));
    assert.ok(isWorldState(this.state));
  }

  snapshot() { return structuredClone({ state: this.state, timestamp: this.timestamp, project: this.project, synthetic: this.synthetic, result: this.result, control: this.control }); }

  observe() {
    const current = this.state.publicProjects?.find((candidate) => candidate.id === this.project.id);
    const route = this.state.routes.find((candidate) => candidate.id === this.project.routeId);
    return {
      project_committed: current?.status === 'committed',
      project_completed: this.completed,
      project_last_valid: this.result?.ok ?? false,
      project_due: current?.status === 'committed' && current.dueRound <= this.state.round + 1,
      project_paid_units: this.paidUnits,
      project_route_damage_units: Math.round((route?.damage ?? 0) * 100),
      project_delivery_count: route?.agreement?.deliveryCount ?? 0,
      project_refusal_unchanged: this.refusal,
      project_atomic_contributions: this.atomic,
      project_zero_payment_without_completion: this.zeroWithoutCompletion,
      project_clamped_repair: this.clamped,
      project_shipments_preserved: this.shipments,
    };
  }

  private assess(before: WorldState, baseline: WorldState, result: TransitionResult): void {
    const receipt = result.events.find((event) => event.publicProjectResult?.projectId === this.project.id)?.publicProjectResult;
    this.completed = receipt?.outcome === 'completed';
    const costs: Array<[number, Partial<Resources>]> = [[this.project.proposer, this.project.terms.proposerContribution], [this.project.recipient, this.project.terms.recipientContribution]];
    const expectedPayment = this.completed && isDeepStrictEqual(receipt?.proposerPaid, costs[0]?.[1]) && isDeepStrictEqual(receipt?.recipientPaid, costs[1]?.[1]);
    const zeroPayment = !receipt || isDeepStrictEqual(receipt.proposerPaid, {}) && isDeepStrictEqual(receipt.recipientPaid, {});
    let exact = true;
    let unchanged = true;
    let debit = 0;
    for (const owner of baseline.civilizations) {
      const actual = result.state.civilizations.find((candidate) => candidate.id === owner.id);
      assert.ok(actual);
      const cost = costs.find(([seat]) => seat === owner.id)?.[1] ?? {};
      for (const resource of RESOURCE_IDS) {
        const difference = owner.resources[resource] - actual.resources[resource];
        debit += difference;
        unchanged &&= Math.abs(difference) < 1e-9;
        exact &&= Math.abs(difference - (this.completed ? cost[resource] ?? 0 : 0)) < 1e-9;
      }
    }
    this.paidUnits = Math.round(debit * 100);
    this.atomic = exact && (this.completed ? expectedPayment : zeroPayment);
    this.zeroWithoutCompletion = this.completed || unchanged && zeroPayment;
    const expectedRoutes = structuredClone(baseline.routes);
    const target = expectedRoutes.find((route) => route.id === this.project.routeId);
    const damageBefore = target?.damage ?? null;
    if (this.completed && target) target.damage = Math.max(0, target.damage - this.project.terms.damageReduction);
    this.clamped = isDeepStrictEqual(result.state.routes, expectedRoutes) && (!this.completed || !!target && receipt?.damageBefore === damageBefore && receipt.damageAfter === target.damage);
    this.shipments = isDeepStrictEqual(routeHistory(result.state), routeHistory(baseline));
    this.refusal = result.ok || isDeepStrictEqual(before, result.state) && result.events.length === 0;
    this.result = result;
    this.state = result.state;
    assert.ok(isWorldState(this.state));
  }

  private command(seat: number, action: GameAction): TransitionResult {
    this.clear();
    const before = structuredClone(this.state);
    const result = applyCommand(this.state, { seat, expectedRevision: this.state.revision, action, timestamp: this.timestamp });
    this.assess(before, before, result);
    return result;
  }

  consent(): TransitionResult { return this.command(this.project.recipient, { type: 'respond-public-project', projectId: this.project.id, accept: true }); }
  cancel(): TransitionResult { return this.command(this.project.proposer, { type: 'cancel-public-project', projectId: this.project.id }); }

  dueBeat(): TransitionResult {
    this.clear();
    const before = structuredClone(this.state);
    const controlState = structuredClone(before);
    controlState.publicProjects = [];
    assert.ok(isWorldState(controlState));
    const timestamp = nextBeat(before);
    const result = catchUpStrategy(before, timestamp);
    const control = catchUpStrategy(controlState, timestamp);
    accepted(result);
    accepted(control);
    assert.equal(result.remainingTicks, 0);
    assert.equal(control.remainingTicks, 0);
    assert.equal(result.state.round, before.round + 1);
    this.assess(before, control.state, result);
    this.control = control;
    this.timestamp = timestamp;
    return result;
  }
}
