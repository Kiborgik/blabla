import { BEHAVIOR_POLICY_VERSION, LEGACY_BEHAVIOR_POLICY_VERSION, BEHAVIOR_PROFILES, behaviorSeed, civilizationBehaviorProfile, type BehaviorPhase, type BehaviorProfile } from './behavior-profiles.ts';
import { deriveDiplomacyPlan, diplomacyPriority, diplomacyProtects, diplomacyReason, diplomacyWeight, type DiplomacyPlan } from './behavior-diplomacy.ts';
import { deriveProgressionPlan, progressionOperationalPriority, progressionTransportPriority, progressionWeight, type ProgressionPlan } from './behavior-progression.ts';
import { BUILDINGS, CIVICS, ECONOMY_RULES, FOCUS_IDS, GOVERNMENTS, IMPROVEMENTS, POLICIES, RESOURCE_IDS, TECHNOLOGIES, TRADE_RECIPES, WONDERS } from './content.ts';
import { legalActions } from './engine.ts';
import { decisionObligations } from './simulation/decisions.ts';
import { districtAdjacencyFacts } from './simulation/districts.ts';
import { governmentModifiers } from './simulation/government.ts';
import { hasFeatures } from './simulation/history.ts';
import { historicalEventQuote, historicalEventWeight, isHistoricalEventId } from './simulation/historical-events.ts';
import { randomStep } from './simulation/random.ts';
import { siteProduction } from './simulation/sites.ts';
import { cityProductivity } from './simulation/world.ts';
import { DIRECTOR_SEAT, type ActionOption, type City, type Civilization, type Focus, type GameAction, type Resources, type TradeTerms, type WorldState } from './types.ts';

export { BEHAVIOR_POLICY_VERSION };
export type { BehaviorPhase, BehaviorProfile };

export interface BehaviorMemory {
  version: 2;
  policyVersion: typeof BEHAVIOR_POLICY_VERSION;
  seed: number;
  seat: number;
  profileId: string;
  decisionCount: number;
  phase: BehaviorPhase;
  phaseSinceRound: number;
  lastDecisionRound: number;
  lastRequiredLane: string | null;
  lastActionKey: string | null;
  urgentStreak: number;
  focusLocks: Array<{ cityId: string; focus: Focus; untilRound: number }>;
}

export interface LegacyBehaviorMemory {
  readonly version: 1;
  readonly policyVersion: typeof LEGACY_BEHAVIOR_POLICY_VERSION;
  readonly seed: number;
  readonly seat: number;
  readonly profileId: string;
  readonly decisionCount: number;
  readonly phase: 'survival' | 'recovery' | 'development' | 'expansion' | 'trade' | 'consolidation' | 'director';
  readonly phaseSinceRound: number;
  readonly lastDecisionRound: number;
  readonly lastRequiredLane: string | null;
  readonly lastActionKey: string | null;
  readonly urgentStreak: number;
  readonly focusLocks: ReadonlyArray<Readonly<{ cityId: string; focus: 'growth' | 'industry' | 'research' | 'culture' | 'diplomacy'; untilRound: number }>>;
}

export interface BehaviorDecision {
  action: GameAction | null;
  memory: BehaviorMemory;
  explanation: { profileId: string; phase: BehaviorPhase; reason: string; required: boolean };
}

export type CivilizationBehaviorMemory = BehaviorMemory;
export type CivilizationBehaviorDecision = BehaviorDecision;

const legacyProfileIds = ['aster-scholars', 'verdant-stewards', 'ember-builders', 'pelagos-traders', 'vesper-custodians'] as const;
const legacyFocusIds: readonly string[] = ['growth', 'industry', 'research', 'culture', 'diplomacy'];
const legacyPhases = ['survival', 'recovery', 'development', 'expansion', 'trade', 'consolidation', 'director'] as const;
const phases: readonly BehaviorPhase[] = legacyPhases;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const shortString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

function validMemoryFields(value: unknown, legacy = false): boolean {
  if (!record(value)
    || !integer(value.seed) || value.seed > 0xffffffff || !integer(value.seat) || value.seat > DIRECTOR_SEAT
    || value.profileId !== (value.seat === DIRECTOR_SEAT ? 'world-director' : legacy ? legacyProfileIds[value.seat] : BEHAVIOR_PROFILES[value.seat]?.id)
    || !integer(value.decisionCount) || !integer(value.phaseSinceRound) || !integer(value.lastDecisionRound)
    || value.phaseSinceRound > value.lastDecisionRound || !(legacy ? legacyPhases : phases).includes(value.phase as BehaviorPhase)
    || (value.seat === DIRECTOR_SEAT) !== (value.phase === 'director')
    || !(value.lastRequiredLane === null || shortString(value.lastRequiredLane))
    || !(value.lastActionKey === null || typeof value.lastActionKey === 'string' && value.lastActionKey.length <= 2048)
    || !integer(value.urgentStreak) || value.urgentStreak > 2 || !Array.isArray(value.focusLocks) || value.focusLocks.length > 256)
    return false;
  const ids = new Set<string>();
  return value.focusLocks.every(lock => {
    if (!record(lock) || !shortString(lock.cityId) || !(legacy ? legacyFocusIds : FOCUS_IDS).includes(lock.focus as Focus) || !integer(lock.untilRound) || ids.has(lock.cityId)) return false;
    ids.add(lock.cityId);
    return true;
  });
}

export function isBehaviorMemory(value: unknown): value is BehaviorMemory {
  return record(value) && value.version === 2 && value.policyVersion === BEHAVIOR_POLICY_VERSION && validMemoryFields(value);
}

export function isLegacyBehaviorMemory(value: unknown): value is LegacyBehaviorMemory {
  return record(value) && value.version === 1 && value.policyVersion === LEGACY_BEHAVIOR_POLICY_VERSION && validMemoryFields(value, true);
}

export const isCivilizationBehaviorMemory = isBehaviorMemory;

export function createBehaviorMemory(state: WorldState, seat: number): BehaviorMemory {
  if (!Number.isInteger(seat) || seat < 0 || seat > DIRECTOR_SEAT || (seat !== DIRECTOR_SEAT && !state.civilizations.some(actor => actor.id === seat)))
    throw new RangeError('Behavior memory requires an existing civilization or the Director');
  return {
    version: 2, policyVersion: BEHAVIOR_POLICY_VERSION, seed: state.seed, seat,
    profileId: seat === DIRECTOR_SEAT ? 'world-director' : civilizationBehaviorProfile(state.seed, seat).id,
    decisionCount: 0, phase: seat === DIRECTOR_SEAT ? 'director' : 'development',
    phaseSinceRound: state.round, lastDecisionRound: state.round, lastRequiredLane: null,
    lastActionKey: null, urgentStreak: 0, focusLocks: [],
  };
}

function readMemory(state: WorldState, seat: number, previous?: BehaviorMemory): BehaviorMemory {
  const memory = previous ?? createBehaviorMemory(state, seat);
  if (!isBehaviorMemory(memory) || memory.seed !== state.seed || memory.seat !== seat || memory.lastDecisionRound > state.round)
    throw new RangeError('Behavior memory does not match this world, seat or policy version');
  return structuredClone(memory);
}

function noDecision(memory: BehaviorMemory, reason: string): BehaviorDecision {
  return { action: null, memory, explanation: { profileId: memory.profileId, phase: memory.phase, reason, required: false } };
}

interface Situation {
  state: WorldState;
  actor: Civilization;
  cities: City[];
  profile: BehaviorProfile;
  memory: BehaviorMemory;
  upkeep: number;
  foodRisk: boolean;
  severeFoodRisk: boolean;
  maxDamage: number;
  weights: Resources;
  phase: BehaviorPhase;
  progression: ProgressionPlan;
  diplomacy: DiplomacyPlan | null;
}

function situation(state: WorldState, actor: Civilization, profile: BehaviorProfile, memory: BehaviorMemory, options: readonly ActionOption[]): Situation {
  const cities = state.cities.filter(city => city.civId === actor.id);
  const upkeep = cities.reduce((sum, city) => sum + city.population * ECONOMY_RULES.populationFoodUpkeep, 0);
  const maxDamage = cities.reduce((maximum, city) => Math.max(maximum, city.damage), 0);
  const government = governmentModifiers(state, actor.id);
  const foodOutput = cities.reduce((sum, city) => {
    const site = state.tiles.find(tile => tile.id === city.tileId);
    const buildings = BUILDINGS.filter(building => city.buildings.includes(building.id) && hasFeatures(state, building.requiredFeatures));
    const buildingFood = buildings.reduce((total, building) => total + (!building.operatingInputs && !building.strategicInputs || city.buildingOperations?.[building.id]?.lastResult?.status === 'operated' ? building.production.food ?? 0 : 0), 0);
    return sum + (ECONOMY_RULES.baseProduction.food + ((ECONOMY_RULES.focusProduction[city.focus] as Partial<Resources>).food ?? 0)
      + (site ? siteProduction(state, site).food ?? 0 : 0) + buildingFood + (government.baseProduction.food ?? 0)) * cityProductivity(city) * government.ordinaryOutputMultiplier;
  }, 0);
  const severeFoodRisk = actor.resources.food < Math.max(3, upkeep * 1.5);
  const foodRisk = severeFoodRisk || foodOutput < upkeep && actor.resources.food < upkeep * 4;
  const weights = { ...profile.resources };
  if (foodRisk) weights.food *= 6;
  else if (actor.resources.food < upkeep * 4) weights.food *= 2;
  if (actor.resources.materials < 12) weights.materials *= 2;
  if (actor.resources.energy < 4) weights.energy *= 2;
  if (actor.resources.credits < 12) weights.credits *= 2;
  return { state, actor, cities, profile, memory, upkeep, foodRisk, severeFoodRisk, maxDamage, weights, phase: memory.phase, progression: deriveProgressionPlan(state, actor, profile, options), diplomacy: hasFeatures(state, ['partnership-stewardship']) ? deriveDiplomacyPlan(state, actor, profile, options) : null };
}

function selectPhase(context: Situation, options: readonly ActionOption[]): BehaviorPhase {
  const { state, actor, memory, profile, upkeep, foodRisk, maxDamage } = context;
  if (foodRisk || memory.phase === 'survival' && actor.resources.food < Math.max(12, upkeep * 4)) return 'survival';
  if (maxDamage >= 25 || memory.phase === 'recovery' && maxDamage >= 10) return 'recovery';
  const scores: Partial<Record<BehaviorPhase, number>> = {
    development: options.some(option => ['research', 'build', 'choose-civic', 'improve', 'build-wonder', 'build-rail'].includes(option.action.type)) ? 10 : 2,
    expansion: options.some(option => ['settle', 'settle-coast'].includes(option.action.type)) && (context.cities.length < profile.settlementGoal || context.progression.coastalNeeded) && actor.resources.food > upkeep * 4 + 10 ? 8 * profile.priorities.expansion : 0,
    trade: options.some(option => ['propose-trade', 'respond-trade'].includes(option.action.type)) ? 7 * profile.priorities.trade : 0,
    consolidation: 3,
  };
  const candidate = (Object.keys(scores) as BehaviorPhase[]).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))[0] ?? 'consolidation';
  const currentScore = scores[memory.phase] ?? 0;
  if (currentScore > 0 && (state.round - memory.phaseSinceRound < profile.commitmentRounds || (scores[candidate] ?? 0) < currentScore * 1.25)) return memory.phase;
  return candidate;
}

function outputValue(outputs: Partial<Resources>, context: Situation): number {
  return RESOURCE_IDS.reduce((sum, resource) => sum + (outputs[resource] ?? 0) * context.weights[resource], 0);
}

function constructionWeight(action: GameAction, context: Situation): number {
  const { state, profile, actor } = context;
  const city = 'cityId' in action ? context.cities.find(candidate => candidate.id === action.cityId) : context.cities[0];
  if (action.type === 'build') {
    const building = BUILDINGS.find(definition => definition.id === action.project);
    if (!building) return 0;
    let value = 4 + outputValue(building.production, context);
    if (action.tileId !== undefined) {
      const adjacency = districtAdjacencyFacts(state, building, action.tileId);
      if (adjacency) value += adjacency.bonus * context.weights[adjacency.resource];
    }
    if (building.housing && city) {
      const capacity = (city.housing?.baseCapacity ?? ECONOMY_RULES.growth.cityPopulationCap)
        + BUILDINGS.filter(definition => city.buildings.includes(definition.id)).reduce((sum, definition) => sum + (definition.housing ?? 0), 0);
      value += building.housing * (city.population >= capacity - 2 ? 3 : 0.3);
    }
    if (building.capabilities?.includes('coastal-departure')) value += profile.priorities.expansion * 3;
    if (building.localPowerOutput) value += building.localPowerOutput * profile.priorities.construction * (city?.buildings.some(id => (BUILDINGS.find(definition => definition.id === id)?.localPowerInput ?? 0) > 0) ? 2 : 0.3);
    if ((building.localPowerInput ?? 0) > 0 && !city?.buildings.some(id => (BUILDINGS.find(definition => definition.id === id)?.localPowerOutput ?? 0) > 0)) value *= 0.3;
    if (building.operatingInputs) {
      value -= Math.min(value * 0.5, outputValue(building.operatingInputs, context));
      if (RESOURCE_IDS.some(resource => (building.operatingInputs?.[resource] ?? 0) * 3 > actor.resources[resource])) value *= 0.4;
      if (hasFeatures(state, ['resident-capacity']) && (city?.population ?? 0) < 6) value *= 0.4;
    }
    return Math.max(1, value) * profile.priorities.construction / (1 + outputValue(building.cost, context) / 80);
  }
  if (action.type === 'improve') {
    const definition = IMPROVEMENTS.find(candidate => candidate.id === action.improvementId);
    if (!definition) return 0;
    const deposit = context.progression.deposits.get(action.tileId);
    return (4 + outputValue(definition.production, context) + (deposit && deposit.remaining > 0 ? 4 : 0)) * profile.priorities.construction;
  }
  if (action.type === 'build-wonder') {
    const definition = WONDERS.find(candidate => candidate.id === action.wonderId);
    return definition ? (5 + outputValue(definition.production, context)) * profile.priorities.research : 0;
  }
  if (action.type === 'build-rail') return 3 * profile.priorities.trade;
  return 0;
}

function tradeValue(terms: TradeTerms, proposer: boolean, context: Situation): number {
  const own = proposer ? terms.proposerCargo : terms.recipientCargo;
  const incoming = proposer ? terms.recipientCargo : terms.proposerCargo;
  const upkeep = proposer ? terms.proposerUpkeep : terms.recipientUpkeep;
  const yields = proposer ? terms.proposerYield : terms.recipientYield;
  if (RESOURCE_IDS.some(resource => context.actor.resources[resource] < (own[resource] ?? 0) + (upkeep[resource] ?? 0) + (resource === 'food' ? context.upkeep * 3 : 0))) return -1;
  const strategic = proposer ? terms.strategicCargo?.proposer : terms.strategicCargo?.recipient;
  if (Object.entries(strategic ?? {}).some(([resource, amount]) => (context.actor.strategicResources?.[resource as 'iron' | 'coal'] ?? 0) < (amount ?? 0))) return -1;
  const receivedStrategic = proposer ? terms.strategicCargo?.recipient : terms.strategicCargo?.proposer;
  return outputValue(incoming, context) + outputValue(yields, context) - outputValue(own, context) - outputValue(upkeep, context)
    + Object.values(receivedStrategic ?? {}).reduce((sum, amount) => sum + (amount ?? 0) * 2, 0)
    - Object.values(strategic ?? {}).reduce((sum, amount) => sum + (amount ?? 0), 0);
}

function governmentValue(governmentId: string, assignments: ReadonlyArray<{ policyId: string }>, context: Situation): number {
  const definition = GOVERNMENTS.find(candidate => candidate.id === governmentId);
  if (!definition) return 0;
  const foodValue = (definition.baseProduction.food ?? 0) * context.cities.length * (context.foodRisk ? 8 : 0.5);
  const capital = context.cities.find(city => city.id === `city-${context.actor.id}`);
  const capitalValue = (definition.capitalConstructionWorkPercent ?? 0) / 100 * (capital?.construction?.active ? 20 : 8) * context.profile.priorities.construction;
  return foodValue + capitalValue + assignments.reduce((sum, assignment) => sum + (POLICIES.find(policy => policy.id === assignment.policyId)?.constructionWork ?? 0) * 4, 0);
}

function actionWeight(option: ActionOption, context: Situation): number {
  const { action } = option;
  const { state, actor, cities, profile, memory, weights } = context;
  switch (action.type) {
    case 'research': {
      if (actor.researchTarget) return 0;
      const definition = TECHNOLOGIES.find(candidate => candidate.id === action.technology);
      if (!definition) return 0;
      const unlocks = BUILDINGS.filter(building => building.requires.includes(definition.id) && hasFeatures(state, building.requiredFeatures));
      const value = unlocks.reduce((sum, building) => sum + outputValue(building.production, context) / Math.max(1, building.requires.filter(id => id !== definition.id && !actor.technologies.includes(id)).length + 1), 0);
      return (8 + value + TECHNOLOGIES.filter(technology => technology.requires.includes(definition.id)).length) * profile.priorities.research / (1 + definition.cost / 80);
    }
    case 'choose-civic': {
      const civic = CIVICS.find(candidate => candidate.id === action.civicId);
      return (8 + (action.civicId === 'foreign-trade' ? profile.priorities.trade * 3 : action.civicId === 'craftsmanship' ? profile.priorities.construction * 3 : 2)) * profile.priorities.civic / (1 + (civic?.cost ?? 0) / 80);
    }
    case 'build': case 'improve': case 'build-wonder': case 'build-rail':
      return constructionWeight(action, context);
    case 'focus': {
      const affected = action.cityId ? cities.filter(city => city.id === action.cityId) : cities;
      const emergency = context.foodRisk && action.focus === 'growth';
      if (!emergency && memory.focusLocks.some(lock => lock.untilRound > state.round && (lock.cityId === '*' || !action.cityId || lock.cityId === action.cityId))) return 0;
      const proposed = outputValue(ECONOMY_RULES.focusProduction[action.focus], context);
      const current = affected.reduce((sum, city) => sum + outputValue(ECONOMY_RULES.focusProduction[city.focus], context), 0) / Math.max(1, affected.length);
      if (emergency) return 40;
      if (context.foodRisk || proposed < current * 1.15 && action.focus !== profile.preferredFocus) return 0;
      if (action.focus !== profile.preferredFocus && proposed <= current) return 0;
      return Math.max(1, proposed - current + (action.focus === profile.preferredFocus ? 4 : 0));
    }
    case 'repair-city': {
      const city = cities.find(candidate => candidate.id === action.cityId);
      return (city?.damage ?? 0) * profile.priorities.recovery;
    }
    case 'repair': {
      const route = state.routes.find(candidate => candidate.id === action.routeId);
      return (route?.damage ?? 0) * profile.priorities.recovery * 0.5;
    }
    case 'settle': case 'settle-coast': {
      const coastalGoal = context.progression.coastalNeeded && (action.type === 'settle-coast' || context.progression.coastalCities.size === 0 && context.progression.coastalSites.has(action.tileId));
      if (context.foodRisk || cities.length >= profile.settlementGoal + (coastalGoal ? 2 : 0) || actor.resources.food < context.upkeep * 3 + ECONOMY_RULES.settle.cost.food
        || actor.resources.materials < ECONOMY_RULES.settle.cost.materials + 8 || actor.resources.credits < ECONOMY_RULES.settle.cost.credits + 4) return 0;
      const site = state.tiles.find(tile => tile.id === action.tileId);
      const output = site ? siteProduction(state, site) : {};
      return (8 + outputValue(output, context)) * profile.priorities.expansion * (context.phase === 'expansion' ? 2 : 1);
    }
    case 'acquire-tile': {
      if (context.foodRisk || actor.resources.credits < (option.territoryQuote?.paid.credits ?? 0) + 12) return 0;
      const tile = state.tiles.find(candidate => candidate.id === action.tileId);
      if (!tile) return 0;
      let potential = outputValue(siteProduction(state, tile), context);
      if (tile.elevation >= 70 && tile.elevation <= 88 && actor.technologies.includes('mining')) potential += weights.materials * 3;
      if (tile.terrain === 'forest' && actor.technologies.includes('machinery')) potential += weights.materials * 3;
      if (actor.technologies.includes('writing') && tile.terrain !== 'mountain' && tile.terrain !== 'ocean') potential += weights.science;
      return potential > 0 ? (2 + potential) / (1 + (option.territoryQuote?.paid.credits ?? 0) / 20) : 0;
    }
    case 'propose-trade': {
      const recipe = TRADE_RECIPES.find(candidate => candidate.id === action.recipeId);
      const value = recipe ? tradeValue(recipe.terms, true, context) : -1;
      return value > 0 ? (6 + value) * profile.priorities.trade / Math.max(1, (option.tradeQuote?.cadenceRounds ?? 4) / 4) : 0;
    }
    case 'respond-trade': {
      const offer = state.tradeOffers?.find(candidate => candidate.id === action.offerId);
      const value = offer ? tradeValue(offer.terms, false, context) : -1;
      return action.accept ? value > 0 ? (20 + value) * profile.priorities.trade : 0 : value <= 0 ? 8 : 0;
    }
    case 'withdraw-trade': {
      const offer = state.tradeOffers?.find(candidate => candidate.id === action.offerId);
      return offer && context.foodRisk && tradeValue(offer.terms, true, context) < 0 ? 5 : 0;
    }
    case 'stop-trade': {
      const route = state.routes.find(candidate => candidate.id === action.routeId);
      return route?.agreement && context.foodRisk && tradeValue(route.agreement.terms, route.owner === actor.id, context) < 0 ? 10 : 0;
    }
    case 'set-building-operation': {
      const building = BUILDINGS.find(candidate => candidate.id === action.buildingId);
      const city = cities.find(candidate => candidate.id === action.cityId);
      if (!building || !city) return 0;
      const stocked = RESOURCE_IDS.every(resource => actor.resources[resource] >= (building.operatingInputs?.[resource] ?? 0) * 3 + ((building.operatingInputs?.[resource] ?? 0) > 0 ? 4 : 0));
      if (action.enabled) return stocked && (!hasFeatures(state, ['resident-capacity']) || city.population >= 6) ? 5 + outputValue(building.production, context) : 0;
      const scarceInput = RESOURCE_IDS.some(resource => (building.operatingInputs?.[resource] ?? 0) > 0 && actor.resources[resource] < (building.operatingInputs?.[resource] ?? 0) * 2);
      const valuableFood = (building.production.food ?? 0) > 0 && context.foodRisk;
      return scarceInput && !valuableFood ? 4 : 0;
    }
    case 'set-improvement-operation': {
      const city = cities.find(candidate => candidate.id === action.cityId);
      const improvement = IMPROVEMENTS.find(candidate => candidate.id === action.improvementId);
      return action.enabled && city && improvement && city.population >= 3 + improvement.residentsRequired ? 5 + outputValue(improvement.production, context) : 0;
    }
    case 'adopt-government': {
      const current = actor.government?.active;
      const value = governmentValue(action.governmentId, action.assignments, context);
      const previous = current ? governmentValue(current.governmentId, current.assignments, context) : 0;
      return value > previous + 0.5 ? 15 + value - previous : 0;
    }
    case 'apply-research-boost': return 30;
    case 'propose-public-project': {
      const route = state.routes.find(candidate => candidate.id === action.routeId);
      return (route?.damage ?? 0) > 0 ? 8 * profile.priorities.trade : 0;
    }
    case 'respond-public-project': {
      const project = state.publicProjects?.find(candidate => candidate.id === action.projectId);
      const route = state.routes.find(candidate => candidate.id === project?.routeId);
      return action.accept === ((route?.damage ?? 0) > 0) ? 12 : 0;
    }
    case 'cancel-public-project': case 'trade': case 'event': return 0;
    case 'federate': return 10 * profile.priorities.trade;
    case 'expedition': return context.foodRisk ? 0 : 10 * profile.priorities.research;
    case 'wait': return 0.8;
  }
}

interface Candidate { option: ActionOption; weight: number; category: string; variant: string; lane: string | null }

function classify(action: GameAction): { category: string; variant: string } {
  switch (action.type) {
    case 'build': return { category: 'construction', variant: action.project };
    case 'improve': return { category: 'construction', variant: action.improvementId };
    case 'build-wonder': return { category: 'construction', variant: action.wonderId };
    case 'build-rail': return { category: 'construction', variant: 'rail' };
    case 'focus': return { category: 'focus', variant: action.focus };
    case 'settle': case 'settle-coast': return { category: 'expansion', variant: action.type };
    case 'propose-trade': return { category: 'trade', variant: action.recipeId };
    case 'respond-trade': return { category: 'trade-response', variant: String(action.accept) };
    case 'event': return { category: 'event', variant: action.event };
    default: return { category: action.type, variant: action.type };
  }
}

function requiredLanes(state: WorldState, seat: number): Map<string, Set<string>> {
  const lanes = new Map<string, Set<string>>();
  if (!hasFeatures(state, ['recurring-decisions']) && !hasFeatures(state, ['civic-bootstrap'])) return lanes;
  const obligations = decisionObligations(state, seat);
  const applicable = hasFeatures(state, ['recurring-decisions']) ? [obligations.research, ...obligations.construction, ...(obligations.civic ? [obligations.civic] : [])] : obligations.civic ? [obligations.civic] : [];
  for (const lane of applicable) if (lane.status === 'required') lanes.set(lane.kind === 'construction' ? `construction:${lane.cityId}` : lane.kind, new Set(lane.availableIds));
  return lanes;
}

function laneOf(action: GameAction, lanes: Map<string, Set<string>>): string | null {
  if (action.type === 'research') return lanes.get('research')?.has(action.technology) ? 'research' : null;
  if (action.type === 'choose-civic') return lanes.get('civic')?.has(action.civicId) ? 'civic' : null;
  if (!['build', 'improve', 'build-wonder', 'build-rail'].includes(action.type) || !('cityId' in action)) return null;
  const lane = `construction:${action.cityId}`;
  const target = action.type === 'build' ? action.project : action.type === 'improve' ? `improvement:${action.improvementId}` : action.type === 'build-wonder' ? `wonder:${action.wonderId}` : 'rail:rail';
  return lanes.get(lane)?.has(target) ? lane : null;
}

function urgent(candidate: Candidate, context: Situation): boolean {
  const action = candidate.option.action;
  if (context.diplomacy && diplomacyPriority(candidate.option, context.diplomacy) > 0) return true;
  if (!context.foodRisk && (progressionOperationalPriority(candidate.option, context.progression) || progressionTransportPriority(candidate.option, context.state, context.progression))) return true;
  if (context.foodRisk) {
    if (action.type === 'focus' && action.focus === 'growth') return true;
    if (action.type === 'build' && (BUILDINGS.find(building => building.id === action.project)?.production.food ?? 0) > 0) return true;
    if (action.type === 'set-building-operation' && action.enabled && (BUILDINGS.find(building => building.id === action.buildingId)?.production.food ?? 0) > 0) return true;
  }
  if (action.type === 'repair-city') return (context.cities.find(city => city.id === action.cityId)?.damage ?? 0) >= 25;
  if (action.type === 'repair') return (context.state.routes.find(route => route.id === action.routeId)?.damage ?? 0) >= 50;
  return false;
}

function stableKey(action: GameAction): string {
  return JSON.stringify(Object.fromEntries(Object.entries(action).sort(([left], [right]) => left.localeCompare(right))));
}

function weightedChoice(candidates: Candidate[], seed: number): Candidate {
  let cursor = seed;
  const pick = <T>(items: readonly T[], weight: (item: T) => number): T => {
    const step = randomStep(cursor); cursor = step.seed;
    let draw = step.value * items.reduce((sum, item) => sum + weight(item), 0);
    for (const item of items) { draw -= weight(item); if (draw < 0) return item; }
    const last = items.at(-1); if (!last) throw new RangeError('Weighted choice requires a legal candidate'); return last;
  };
  const bucket = (items: Candidate[], key: (candidate: Candidate) => string): Candidate[][] => {
    const groups = new Map<string, Candidate[]>();
    for (const item of items) { const id = key(item); const group = groups.get(id) ?? []; group.push(item); groups.set(id, group); }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => group);
  };
  const average = (items: Candidate[]): number => items.reduce((sum, item) => sum + item.weight, 0) / items.length;
  const category = pick(bucket(candidates, candidate => candidate.category), average);
  const variant = pick(bucket(category, candidate => candidate.variant), average);
  return pick(variant.toSorted((left, right) => stableKey(left.option.action).localeCompare(stableKey(right.option.action))), candidate => candidate.weight);
}

function committedDecision(state: WorldState, memory: BehaviorMemory, candidate: Candidate, phase: BehaviorPhase, reason: string, profile?: BehaviorProfile, isUrgent = false): BehaviorDecision {
  if (memory.decisionCount >= Number.MAX_SAFE_INTEGER) throw new RangeError('Behavior decision cursor is exhausted');
  const next = structuredClone(memory);
  next.decisionCount += 1;
  next.lastDecisionRound = state.round;
  if (next.phase !== phase) { next.phase = phase; next.phaseSinceRound = state.round; }
  next.lastActionKey = stableKey(candidate.option.action);
  next.urgentStreak = isUrgent ? Math.min(2, next.urgentStreak + 1) : 0;
  if (candidate.lane) next.lastRequiredLane = candidate.lane;
  next.focusLocks = next.focusLocks.filter(lock => lock.untilRound > state.round && (lock.cityId === '*' || state.cities.some(city => city.id === lock.cityId && city.civId === memory.seat)));
  if (candidate.option.action.type === 'focus') {
    const action = candidate.option.action;
    const cityId = action.cityId ?? '*';
    next.focusLocks = next.focusLocks.filter(lock => lock.cityId !== cityId && lock.cityId !== '*' && cityId !== '*');
    next.focusLocks.push({ cityId, focus: action.focus, untilRound: Math.min(Number.MAX_SAFE_INTEGER, state.round + (profile?.commitmentRounds ?? 6)) });
  }
  return {
    action: structuredClone(candidate.option.action), memory: next,
    explanation: { profileId: next.profileId, phase, reason: `${reason} ${candidate.option.label}.`.slice(0, 280), required: candidate.lane !== null },
  };
}

export function chooseCivilizationBehavior(state: WorldState, seat: number, previous?: BehaviorMemory, timestamp?: string): BehaviorDecision {
  if (seat === DIRECTOR_SEAT) return chooseDirectorBehavior(state, previous, timestamp);
  const memory = readMemory(state, seat, previous);
  if (hasFeatures(state, ['independent-actions']) && timestamp === undefined) return noDecision(memory, 'An explicit action time is required.');
  const options = legalActions(state, seat, timestamp);
  const actor = state.civilizations.find(candidate => candidate.id === seat);
  if (!actor || options.length === 0) return noDecision(memory, 'No action is currently admitted by the world.');
  const profile = civilizationBehaviorProfile(state.seed, seat);
  const context = situation(state, actor, profile, memory, options);
  context.phase = selectPhase(context, options);
  const lanes = requiredLanes(state, seat);
  const candidates = options.map(option => {
    const action = option.action;
    const base = progressionWeight(option, actionWeight(option, context), state, actor, profile, context.progression);
    const replacing = action.type === 'stop-trade' && context.progression.replaceableRoutes.has(action.routeId)
      && !state.publicProjects?.some(project => project.routeId === action.routeId && project.status === 'committed');
    const weight = context.diplomacy && !replacing ? diplomacyWeight(option, base, context.diplomacy) : base;
    return { option, weight, ...classify(option.action), lane: laneOf(option.action, lanes) };
  });
  const required = candidates.filter(candidate => candidate.lane !== null && (!context.diplomacy || !diplomacyProtects(candidate.option, context.diplomacy)));
  let emergencies = candidates.filter(candidate => candidate.weight > 0 && urgent(candidate, context));
  if (context.diplomacy && !context.severeFoodRisk) {
    const priority = Math.max(0, ...emergencies.map(candidate => diplomacyPriority(candidate.option, context.diplomacy!)));
    if (priority > 0) emergencies = emergencies.filter(candidate => diplomacyPriority(candidate.option, context.diplomacy!) === priority);
  }
  let pool: Candidate[];
  let reason: string;
  let isUrgent = false;
  if (emergencies.length && (memory.urgentStreak < 2 || required.length === 0)) {
    pool = emergencies; isUrgent = true;
    reason = context.foodRisk ? 'Food is low; protect the towns before expanding.' : 'Repair serious damage to restore town production and exchanges.';
  } else if (required.length) {
    const keys = [...new Set(required.map(candidate => candidate.lane as string))].sort();
    const next = keys.find(key => memory.lastRequiredLane === null || key > memory.lastRequiredLane) ?? keys[0];
    pool = required.filter(candidate => candidate.lane === next).map(candidate => ({ ...candidate, weight: Math.max(0.1, candidate.weight) }));
    reason = `Start the next required ${next?.startsWith('construction:') ? 'town construction' : next} commitment.`;
  } else {
    pool = candidates.filter(candidate => candidate.weight > 0);
    reason = `${profile.name} favor ${context.phase === 'trade' ? 'useful exchanges' : context.phase === 'expansion' ? 'careful expansion' : context.phase === 'survival' ? 'food security' : context.phase === 'recovery' ? 'recovery' : 'steady development'}.`;
  }
  if (!pool.length) return noDecision(memory, 'No useful legal action is available; existing commitments remain unchanged.');
  const choice = weightedChoice(pool, behaviorSeed(`${BEHAVIOR_POLICY_VERSION}:${state.seed}:${seat}:${memory.decisionCount}`));
  if (isUrgent && !context.foodRisk && progressionOperationalPriority(choice.option, context.progression)) reason = 'Budget local residents and opening supplies for useful production and learning.';
  else if (isUrgent && !context.foodRisk && progressionTransportPriority(choice.option, state, context.progression)) reason = 'Seek fresh consent for a funded steam exchange whose paid rails improve delivery cadence.';
  if (context.diplomacy && !(choice.option.action.type === 'stop-trade' && context.progression.replaceableRoutes.has(choice.option.action.routeId))) reason = diplomacyReason(choice.option, context.diplomacy) ?? reason;
  return committedDecision(state, memory, choice, context.phase, reason, profile, isUrgent);
}

export function chooseDirectorBehavior(state: WorldState, previous?: BehaviorMemory, timestamp?: string): BehaviorDecision {
  const memory = readMemory(state, DIRECTOR_SEAT, previous);
  if (hasFeatures(state, ['independent-actions']) && timestamp === undefined) return noDecision(memory, 'An explicit action time is required.');
  const options = legalActions(state, DIRECTOR_SEAT, timestamp).filter(option => option.action.type === 'event' || option.action.type === 'wait');
  if (!options.length) return noDecision(memory, 'No Director action is currently admitted by the world.');
  const candidates = options.map(option => {
    const action = option.action;
    let weight = 30;
    if (action.type === 'event' && hasFeatures(state, ['historical-pressures']) && isHistoricalEventId(action.event)) {
      weight = historicalEventWeight(state, action.event, action.target);
    } else if (action.type === 'event') {
      const actor = state.civilizations.find(candidate => candidate.id === action.target);
      const cities = state.cities.filter(city => city.civId === action.target);
      const damage = cities.reduce((maximum, city) => Math.max(maximum, city.damage), 0);
      const upkeep = cities.reduce((sum, city) => sum + city.population * ECONOMY_RULES.populationFoodUpkeep, 0);
      weight = action.event === 'calm' ? 24 : action.event === 'drought' ? (actor?.resources.food ?? 0) > upkeep * 5 + 12 ? 2 : 0.1
        : action.event === 'earthquake' ? damage < 25 ? 2 : 0.1 : action.event === 'resource-boom' ? 5 : 1;
    }
    return { option, weight, ...classify(action), lane: null };
  });
  const choice = weightedChoice(candidates, behaviorSeed(`${BEHAVIOR_POLICY_VERSION}:${state.seed}:${DIRECTOR_SEAT}:${memory.decisionCount}`));
  const action = choice.option.action;
  const cause = action.type === 'event' && hasFeatures(state, ['historical-pressures']) && isHistoricalEventId(action.event) ? historicalEventQuote(state, action.event, action.target)?.cause : undefined;
  return committedDecision(state, memory, choice, 'director', cause ?? (action.type === 'wait' ? 'Let existing events and civilization decisions unfold.' : 'A seeded world event uses only released effects and an admitted target.'));
}
