import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RESOURCE_IDS, TRADE_RECIPES, TURN_RULES } from '../core/content.ts';
import { createLandTransportPlanner, landTransportBlock, landTransportCadence } from '../core/simulation/transport.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, Resources, TradeOffer, TransitionResult, WorldState } from '../core/types.ts';

const EPOCH = '2026-10-16T00:00:00.000Z';
const atRound = (round: number) => new Date(Date.parse(EPOCH) + round * TURN_RULES.strategyIntervalMs).toISOString();

function accepted(result: TransitionResult): WorldState {
  assert.ok(result.ok, result.error);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function release(state: WorldState, targetReleaseId: string): WorldState {
  return accepted(applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: atRound(state.round) }));
}

function baseWorld(): WorldState {
  let state = createWorld(1701, EPOCH);
  for (const id of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1']) state = release(state, id);
  return state;
}

function command(state: WorldState, seat: number, action: GameAction): TransitionResult {
  return applyCommand(state, { seat, action, expectedRevision: state.revision, timestamp: atRound(state.round) });
}

function proposal(): GameAction {
  return { type: 'propose-trade', partner: 3, recipeId: 'harvest-for-materials', sourceCityId: 'city-2', recipientCityId: 'city-3' };
}

function offerIn(state: WorldState): TradeOffer | undefined {
  return state.tradeOffers?.find(offer => offer.proposer === 2 && offer.recipient === 3);
}

function resourcesEqual(first: WorldState, second: WorldState): boolean {
  return isDeepStrictEqual(first.civilizations.map(owner => owner.resources), second.civilizations.map(owner => owner.resources));
}

export class LandTransportProbes {
  private baseline: WorldState | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private operation: 'quote' | 'consent' | 'resolve' | null = null;
  private synthetic = '';
  private legacy: { before: WorldState; adopted: WorldState; accepted: WorldState; replay: WorldState; historical: WorldState } | null = null;
  private preview: { state: WorldState; control: TransitionResult } | null = null;

  reset(): void {
    this.state = null;
    this.clear();
    this.synthetic = '';
    this.legacy = null;
  }

  private clear(): void {
    this.before = null;
    this.result = null;
    this.control = null;
    this.operation = null;
    this.preview = null;
  }

  private initial(): WorldState {
    this.baseline ??= baseWorld();
    return release(structuredClone(this.baseline), 'settlement-land-transport-1');
  }

  prepare(kind: number): void {
    this.reset();
    if (!Number.isSafeInteger(kind) || kind < 1 || kind > 7) {
      this.state = this.initial();
      return;
    }
    this.quote();
    assert.ok(this.state);
    if (kind === 1 || kind === 3) {
      if (kind === 3) this.blockPath();
      this.clear();
      return;
    }
    this.consent();
    assert.ok(this.result?.ok);
    if (kind !== 6) {
      const route = this.state.routes[0];
      assert.ok(route?.agreement);
      this.state = accepted(catchUpStrategy(this.state, atRound(route.agreement.nextDeliveryRound - 1)));
    }
    if (kind === 4) this.blockPath();
    if (kind === 5) {
      this.synthetic = 'Synthetic recipient shortage and suppressed city production after legal consent';
      const recipient = this.state.civilizations[3];
      assert.ok(recipient);
      recipient.resources.materials = 0;
      for (const city of this.state.cities.filter(candidate => candidate.civId === 3)) city.damage = 100;
    }
    if (kind === 7) {
      this.synthetic = 'Synthetic route damage after legal consent';
      const route = this.state.routes[0];
      assert.ok(route?.agreement);
      route.damage = route.agreement.terms.damageDisableAt;
    }
    assert.ok(isWorldState(this.state));
    this.clear();
  }

  private blockPath(): void {
    assert.ok(this.state);
    const quote = offerIn(this.state)?.terms.transport;
    assert.ok(quote);
    const tile = this.state.tiles.find(candidate => candidate.id === quote.tileIds[2]);
    assert.ok(tile);
    tile.terrain = 'mountain';
    this.synthetic = 'Synthetic impassable quoted tile after a legal proposal';
  }

  snapshot() {
    return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, synthetic: this.synthetic, legacy: this.legacy });
  }

  quote(): void {
    this.state = this.initial();
    this.synthetic = '';
    this.clear();
    this.before = structuredClone(this.state);
    this.result = command(this.state, 2, proposal());
    this.state = this.result.state;
    this.operation = 'quote';
  }

  consent(): void {
    this.state ??= this.initial();
    this.clear();
    this.before = structuredClone(this.state);
    this.result = command(this.state, 3, { type: 'respond-trade', offerId: offerIn(this.state)?.id ?? 'absent-offer', accept: true });
    this.state = this.result.state;
    this.operation = 'consent';
  }

  private controlBeat(state: WorldState): TransitionResult {
    if (this.preview?.state === state) return this.preview.control;
    let control = state;
    const route = state.routes.find(candidate => candidate.agreement?.enabled);
    if (route) {
      const timestamp = new Date(Date.parse(atRound(state.round)) + TURN_RULES.tacticalWindowMs).toISOString();
      control = accepted(applyCommand(state, { seat: route.owner, expectedRevision: state.revision, action: { type: 'stop-trade', routeId: route.id }, timestamp }));
    }
    const result = catchUpStrategy(control, atRound(state.round + 1));
    accepted(result);
    this.preview = { state, control: result };
    return result;
  }

  resolve(): void {
    this.state ??= this.initial();
    this.clear();
    this.before = structuredClone(this.state);
    this.control = this.controlBeat(this.state);
    this.result = catchUpStrategy(this.state, atRound(this.state.round + 1));
    this.state = accepted(this.result);
    this.operation = 'resolve';
  }

  replayAbstract(): void {
    this.baseline ??= baseWorld();
    let state = accepted(catchUpStrategy(structuredClone(this.baseline), atRound(2)));
    state = accepted(command(state, 2, proposal()));
    const before = structuredClone(state);
    const adopted = release(state, 'settlement-land-transport-1');
    const offer = offerIn(adopted);
    assert.ok(offer);
    const action: GameAction = { type: 'respond-trade', offerId: offer.id, accept: true };
    const next = accepted(command(adopted, 3, action));
    const restored: unknown = JSON.parse(JSON.stringify(adopted));
    assert.ok(isWorldState(restored));
    this.legacy = { before, adopted, accepted: next, replay: accepted(command(restored, 3, action)), historical: accepted(command(before, 3, action)) };
  }

  observe() {
    const state = this.state;
    const offer = state ? offerIn(state) : undefined;
    const route = state?.routes.find(candidate => candidate.agreement?.offerId === offer?.id);
    const agreement = route?.agreement;
    const quote = offer?.terms.transport;
    const from = state?.cities.find(city => city.id === offer?.from);
    const to = state?.cities.find(city => city.id === offer?.to);
    const valid = !!state && !!quote && !!from && !!to && landTransportBlock(state, quote, from.tileId, to.tileId) === null
      && isDeepStrictEqual(quote, createLandTransportPlanner(state).quote(from.tileId, to.tileId));
    const recipe = TRADE_RECIPES.find(candidate => candidate.id === offer?.terms.recipeId);
    const attemptState = this.operation === 'resolve' ? this.before : state;
    const prior = attemptState?.routes.find(candidate => candidate.id === route?.id)?.agreement;
    const due = !!agreement?.enabled && !!state && agreement.nextDeliveryRound <= state.round + 1;
    const lastDue = this.operation === 'resolve' && !!prior?.enabled && !!attemptState && prior.nextDeliveryRound <= attemptState.round + 1;
    const control = this.control;
    const nextControl = state && agreement ? this.controlBeat(state) : null;
    const funded = !!nextControl && !!route && !!agreement && ([
      [route.owner, agreement.terms.proposerCargo, agreement.terms.proposerUpkeep],
      [route.partner, agreement.terms.recipientCargo, agreement.terms.recipientUpkeep],
    ] as const).every(([seat, cargo, upkeep]) => RESOURCE_IDS.every(resource => (nextControl.state.civilizations.find(owner => owner.id === seat)?.resources[resource] ?? -1) >= (cargo[resource] ?? 0) + (upkeep[resource] ?? 0)));
    const delivered = this.operation === 'resolve' && !!agreement && !!prior && agreement.deliveryCount === prior.deliveryCount + 1
      && this.result?.events.some(event => event.type === 'trade-delivered' && event.detail === route?.id) === true;
    const payment = delivered && !!state && !!control && !!route && !!agreement && state.civilizations.every(owner => {
      const baseline = control.state.civilizations.find(candidate => candidate.id === owner.id);
      if (!baseline) return false;
      const terms = agreement.terms;
      const vectors: Array<[Partial<Resources>, number]> = owner.id === route.owner
        ? [[terms.proposerCargo, -1], [terms.proposerUpkeep, -1], [terms.recipientCargo, 1], [terms.proposerYield, 1]]
        : owner.id === route.partner ? [[terms.recipientCargo, -1], [terms.recipientUpkeep, -1], [terms.proposerCargo, 1], [terms.recipientYield, 1]] : [];
      return RESOURCE_IDS.every(resource => Math.abs(owner.resources[resource] - baseline.resources[resource] - vectors.reduce((sum, [vector, sign]) => sum + sign * (vector[resource] ?? 0), 0)) < 1e-8);
    });
    const legacy = this.legacy;
    const oldOffer = legacy ? offerIn(legacy.before) : undefined;
    const oldAgreement = legacy?.accepted.routes[0]?.agreement;
    return {
      land_initialized: state !== null,
      land_quote_valid: valid,
      land_consent_eligible: !!state && !!offer && legalActions(state, 3, atRound(state.round)).some(option => option.action.type === 'respond-trade' && option.action.offerId === offer.id && option.action.accept),
      land_consent_accepted: this.operation === 'consent' && this.result?.ok === true,
      land_quote_preserved: !!agreement && !!offer && isDeepStrictEqual(agreement.terms, offer.terms) && route?.from === offer.from && route.to === offer.to,
      land_attempt_due: due,
      land_last_attempt_due: lastDue,
      land_exchange_funded: funded,
      land_route_usable: !!route && !!agreement?.enabled && route.damage < agreement.terms.damageDisableAt && from?.civId === route.owner && to?.civId === route.partner,
      land_delivered: delivered,
      land_cadence_exact: !!quote && !!recipe && offer?.terms.cadenceRounds === landTransportCadence(recipe.terms.cadenceRounds, quote),
      land_payment_exact: payment,
      land_refusal_unchanged: this.operation === 'resolve' ? !!state && !!control && resourcesEqual(state, control.state) : !!this.result && !this.result.ok && isDeepStrictEqual(this.result.state, this.before) && this.result.events.length === 0,
      land_legacy_preserved: !!legacy && !!oldOffer && !!oldAgreement && oldOffer.terms.transport === undefined && isDeepStrictEqual(legacy.before.tradeOffers, legacy.adopted.tradeOffers) && isDeepStrictEqual(legacy.before.routes, legacy.adopted.routes) && isDeepStrictEqual(oldAgreement.terms, oldOffer.terms) && isDeepStrictEqual(oldAgreement, legacy.historical.routes[0]?.agreement) && isDeepStrictEqual(legacy.accepted, legacy.replay),
    };
  }
}
