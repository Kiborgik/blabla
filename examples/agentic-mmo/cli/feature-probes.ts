import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RESOURCE_IDS, TURN_RULES } from '../core/content.ts';
import type { GameAction, WorldState } from '../core/types.ts';

const EPOCH = '2026-10-16T00:00:00.000Z';

function released(targets: string[]): WorldState {
  let state = createWorld(17, EPOCH);
  for (const targetReleaseId of targets) {
    const result = applyRelease(state, {
      expectedRevision: state.revision,
      expectedFromReleaseId: state.releaseId,
      targetReleaseId,
      timestamp: EPOCH,
    });
    if (!result.ok) throw new Error(`Feature probe release failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

export class FeatureProbes {
  private concurrent!: WorldState;
  private frontier!: WorldState;
  private founding!: Extract<GameAction, { type: 'settle' }>;
  private timestamp = EPOCH;
  private concurrentAccepted = false;
  private frontierAccepted = false;
  private frontierPaid = 0;

  constructor() { this.reset(); }

  reset(): void {
    const independent = ['settlement-foundations-2', 'settlement-independent-1'];
    this.concurrent = released([...independent, 'settlement-plans-1']);
    this.frontier = released([...independent, 'settlement-production-1', 'settlement-frontiers-1']);
    const founding = legalActions(this.frontier, 0, EPOCH).find((option) => option.action.type === 'settle')?.action;
    if (!founding || founding.type !== 'settle' || !founding.sourceCityId)
      throw new Error('Feature probe requires a real legal conserved founding action');
    this.founding = founding;
    this.timestamp = EPOCH;
    this.concurrentAccepted = false;
    this.frontierAccepted = false;
    this.frontierPaid = 0;
  }

  snapshot() {
    return structuredClone({ concurrent: this.concurrent, frontier: this.frontier, founding: this.founding, timestamp: this.timestamp });
  }

  observe() {
    return {
      independent_mode: this.concurrent.independentTurns !== undefined,
      peer_eligible: legalActions(this.concurrent, 1, this.timestamp).some((option) => option.action.type === 'wait'),
      idle_actor: this.concurrent.independentTurns?.lastActionWindow[0] === -1,
      actionable_plan_items: this.concurrent.actionPlans?.[1]?.items.length ?? 0,
      concurrent_last_valid: this.concurrentAccepted,
      concurrent_revision: this.concurrent.revision,
      concurrent_year: this.concurrent.year,
      frontier_source_population: this.frontier.cities.find((city) => city.id === this.founding.sourceCityId)?.population ?? 0,
      frontier_destination_population: this.frontier.cities.find((city) => city.tileId === this.founding.tileId)?.population ?? 0,
      frontier_total_population: this.frontier.cities.reduce((sum, city) => sum + city.population, 0),
      frontier_paid_units: this.frontierPaid,
      frontier_accepted: this.frontierAccepted,
    };
  }

  peerAction(): void {
    const result = applyCommand(this.concurrent, { seat: 1, expectedRevision: this.concurrent.revision, action: { type: 'wait' }, timestamp: this.timestamp });
    this.concurrentAccepted = result.ok;
    this.concurrent = result.state;
  }

  invalidAction(): void {
    const result = applyCommand(this.concurrent, { seat: -1, expectedRevision: this.concurrent.revision, action: { type: 'wait' }, timestamp: this.timestamp });
    this.concurrentAccepted = result.ok;
    this.concurrent = result.state;
  }

  updatePlan(size: number): void {
    const count = Number.isSafeInteger(size) && size >= 0 && size <= TURN_RULES.maximumPlanItems ? size : TURN_RULES.maximumPlanItems + 1;
    const action: GameAction = { type: 'wait' };
    const plan = Array.from({ length: count }, () => ({ action, reason: 'Contract probe: explicitly review the next independent action' }));
    const result = applyCommand(this.concurrent, { seat: 1, expectedRevision: this.concurrent.revision, action, timestamp: this.timestamp, plan });
    this.concurrentAccepted = result.ok;
    this.concurrent = result.state;
  }

  featureWindow(): void {
    const timestamp = new Date(Date.parse(this.timestamp) + TURN_RULES.tacticalWindowMs).toISOString();
    const result = catchUpStrategy(this.concurrent, timestamp);
    if (!result.ok || result.remainingTicks !== 0)
      throw new Error(`Feature probe catchup failed: ${result.error ?? 'unrealized strategic beats'}`);
    this.concurrent = result.state;
    this.timestamp = timestamp;
  }

  found(): void {
    const before = this.frontier.civilizations.find((civilization) => civilization.id === 0);
    if (!before) throw new Error('Feature probe founding civilization is missing');
    const result = applyCommand(this.frontier, { seat: 0, expectedRevision: this.frontier.revision, action: this.founding, timestamp: EPOCH });
    const after = result.state.civilizations.find((civilization) => civilization.id === 0);
    if (!after) throw new Error('Feature probe founding civilization disappeared');
    this.frontierPaid = Math.round(RESOURCE_IDS.reduce((sum, resource) => sum + before.resources[resource] - after.resources[resource], 0) * 100);
    this.frontierAccepted = result.ok;
    this.frontier = result.state;
  }
}
