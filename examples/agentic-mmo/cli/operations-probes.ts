import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { BUILDINGS, RESOURCE_IDS, TURN_RULES } from '../core/content.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { GameEvent, Resources, TransitionResult, WorldState } from '../core/types.ts';

const EPOCH = '2026-10-16T00:00:00.000Z';

function independentWorld(production: boolean): WorldState {
  return createWorld(17, EPOCH, production ? 'settlement-production-1' : 'settlement-independent-1');
}

function irrigationRecipe() {
  const recipe = BUILDINGS.find((building) => building.id === 'irrigation');
  if (!recipe?.operatingInputs?.materials || RESOURCE_IDS.some((resource) => resource !== 'materials' && (recipe.operatingInputs?.[resource] ?? 0) !== 0))
    throw new Error('The material-debit component contract requires the authored single-material irrigation recipe');
  return recipe;
}

export function createSyntheticOperatingWorld(): WorldState {
  const state = independentWorld(true);
  const city = state.cities.find((candidate) => candidate.id === 'city-0');
  const owner = state.civilizations.find((candidate) => candidate.id === 0);
  const recipe = irrigationRecipe();
  if (!city || !owner) throw new Error('Synthetic operating fixture requires its named city and owner');
  city.buildings.push(recipe.id);
  city.buildingOperations = { [recipe.id]: { enabled: true, lastResult: null } };
  owner.resources.materials = recipe.operatingInputs?.materials ?? 0;
  return state;
}

function units(resources: Partial<Resources>): number {
  return Math.round(RESOURCE_IDS.reduce((sum, resource) => sum + (resources[resource] ?? 0), 0) * 100);
}

export class OperationsProbes {
  private production!: WorldState;
  private strategy!: WorldState;
  private offerId = '';
  private timestamp = EPOCH;
  private productionTimestamp = EPOCH;
  private consentAccepted = false;
  private productionEvents: GameEvent[] = [];

  constructor() { this.reset(); }

  reset(): void {
    this.production = createSyntheticOperatingWorld();
    this.productionTimestamp = EPOCH;
    const initial = independentWorld(false);
    const proposal = applyCommand(initial, { seat: 0, expectedRevision: initial.revision, action: { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials' }, timestamp: EPOCH });
    if (!proposal.ok) throw new Error(`Strategy probe proposal failed: ${proposal.error}`);
    const offer = proposal.state.tradeOffers?.find((candidate) => candidate.proposer === 0 && candidate.recipient === 1 && candidate.status === 'pending');
    if (!offer) throw new Error('Strategy probe proposal created no pending offer');
    this.strategy = proposal.state;
    this.offerId = offer.id;
    this.timestamp = EPOCH;
    this.consentAccepted = false;
    this.productionEvents = [];
  }

  snapshot() {
    return structuredClone({ production: this.production, strategy: this.strategy, offerId: this.offerId, timestamp: this.timestamp, productionTimestamp: this.productionTimestamp, productionEvents: this.productionEvents });
  }

  observe() {
    const recipe = irrigationRecipe();
    const owner = this.production.civilizations.find((candidate) => candidate.id === 0);
    const operation = this.production.cities.find((candidate) => candidate.id === 'city-0')?.buildingOperations?.[recipe.id];
    if (!owner || !operation) throw new Error('Synthetic operation observation lost its real owner or operation');
    const offer = this.strategy.tradeOffers?.find((candidate) => candidate.id === this.offerId);
    const agreement = this.strategy.routes.find((route) => route.id === offer?.routeId)?.agreement;
    return {
      production_enabled: operation.enabled,
      production_inputs_available: RESOURCE_IDS.every((resource) => owner.resources[resource] >= (recipe.operatingInputs?.[resource] ?? 0)),
      production_paid_units: units(operation.lastResult?.paid ?? {}),
      production_produced_units: units(operation.lastResult?.produced ?? {}),
      production_stock_units: Math.round(owner.resources.materials * 100),
      strategy_can_consent: legalActions(this.strategy, 1, this.timestamp).some((option) => option.action.type === 'respond-trade' && option.action.offerId === this.offerId && option.action.accept),
      strategy_last_valid: this.consentAccepted,
      strategy_agreement_enabled: agreement?.enabled ?? false,
      strategy_delivery_count: agreement?.deliveryCount ?? 0,
      strategy_round: this.strategy.round,
      strategy_next_delivery_round: agreement?.nextDeliveryRound ?? 0,
    };
  }

  operate(): void { allocateOperations(this.production); }

  productionBeat(): void {
    const timestamp = new Date(Date.parse(this.productionTimestamp) + TURN_RULES.strategyIntervalMs).toISOString();
    const result = catchUpStrategy(this.production, timestamp);
    if (!result.ok || result.remainingTicks !== 0) throw new Error(`Production probe catchup failed: ${result.error ?? 'unrealized beats'}`);
    this.production = result.state;
    this.productionEvents = result.events;
    this.productionTimestamp = timestamp;
  }

  pause(): TransitionResult {
    const result = applyCommand(this.production, { seat: 0, expectedRevision: this.production.revision, action: { type: 'set-building-operation', cityId: 'city-0', buildingId: irrigationRecipe().id, enabled: false }, timestamp: this.productionTimestamp });
    this.production = result.state;
    return result;
  }

  consent(): TransitionResult {
    const result = applyCommand(this.strategy, { seat: 1, expectedRevision: this.strategy.revision, action: { type: 'respond-trade', offerId: this.offerId, accept: true }, timestamp: this.timestamp });
    this.consentAccepted = result.ok;
    this.strategy = result.state;
    return result;
  }

  strategicBeat(): void {
    const timestamp = new Date(Date.parse(this.timestamp) + TURN_RULES.strategyIntervalMs).toISOString();
    const result = catchUpStrategy(this.strategy, timestamp);
    if (!result.ok || result.remainingTicks !== 0) throw new Error(`Strategy probe catchup failed: ${result.error ?? 'unrealized beats'}`);
    this.strategy = result.state;
    this.timestamp = timestamp;
  }
}
