import { exchangePromisedResources } from './behavior-knowledge.ts';
import { selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, LOCAL_GROWTH_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TRADE_RECIPES, WONDERS } from './content.ts';
import { borderDealFailure, borderReturnReservations } from './simulation/border-incidents.ts';
import { buildingEligibility } from './simulation/capabilities.ts';
import { foundingSiteEligible, foundingSourceEligible } from './simulation/coastal.ts';
import { constructionWork, requiredConstructionWork } from './simulation/construction.ts';
import { districtSiteBlock, districtSiteOccupied } from './simulation/districts.ts';
import { householdFoodUpkeep } from './simulation/food-security.ts';
import { hexDistance } from './simulation/geography.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { availableCampusHighGround } from './simulation/observatory.ts';
import { paidRecipe, projectOperationAllocation } from './simulation/operations.ts';
import { railSiteBlock } from './simulation/rail.ts';
import { createLandTransportPlanner, landTransportCadence } from './simulation/transport.ts';
import { availableMountainCatchments } from './simulation/water.ts';
import type { BuildingDefinition, City, ConstructionOrder, GameAction, ImprovementDefinition, Resources, StrategicResources, WorldState } from './types.ts';

export interface FrontierHouseholds {
  readonly cityId: string | null;
  readonly prospective: boolean;
  readonly openingPopulation: number;
  readonly reservedReturning: number;
  readonly capacity: number;
  readonly growthCount: number;
  readonly householdFood: number;
  readonly growthFood: number;
}
export interface FundedFrontierQuote {
  readonly kind: 'conditional-frontier';
  readonly mode: 'founding' | 'farm';
  readonly revision: number;
  readonly sourceCityId: string | null;
  readonly cityId: string | null;
  readonly tileId: number;
  readonly sourcePopulationBefore: number | null;
  readonly sourcePopulationAfter: number | null;
  readonly arrivingPopulation: number;
  readonly arrivingWorkforce: number;
  readonly foundingCost: Readonly<Partial<Resources>>;
  readonly setupCost: Readonly<Partial<Resources>>;
  readonly admissionAllowanceBeats: number;
  readonly workBeats: number;
  readonly firstOperationBeat: number;
  readonly protectedHorizon: number;
  readonly protectedBudget: Readonly<{ ordinary: Readonly<Resources>; strategic: Readonly<StrategicResources> }>;
  readonly households: readonly FrontierHouseholds[];
  readonly retainedOperations: readonly string[];
  readonly allocations: readonly { key: string; openingPopulation: number; required: number; available: number; allocated: number }[];
  readonly landOpportunity: number;
  readonly contactOpportunity: number;
  readonly locationMultiplier: number;
}
export interface FrontierAssessment { readonly quote: FundedFrontierQuote | null; readonly reason: string | null }
interface Footprint { key: string; id: string; ordinary: Partial<Resources>; strategic: StrategicResources; residents: number; openingPopulation: number; available: number }
interface Pending { cityId: string; order: ConstructionOrder; definition: BuildingDefinition | ImprovementDefinition }
interface Prepared { horizon: number; baseline: Map<string, Footprint>; footprints: Map<string, Footprint>; pending: Pending[]; failure: string | null }
type Founding = Extract<GameAction, { type: 'settle' }>;
type Funding = Pick<FundedFrontierQuote, 'protectedBudget' | 'households' | 'retainedOperations' | 'allocations'>;
const prospectiveId = 'conditional-frontier-prospective-town';
const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (value: number): number => Math.round(value * 100) / 100;
const safeAmount = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const safe = (ordinary: Partial<Resources>, strategic: StrategicResources = {}): boolean => RESOURCE_IDS.every(id => safeAmount(ordinary[id] ?? 0)) && STRATEGIC_RESOURCE_IDS.every(id => Number.isSafeInteger(strategic[id] ?? 0) && (strategic[id] ?? 0) >= 0);
const add = (budget: Resources, cost: Partial<Resources>, count = 1): void => { for (const id of RESOURCE_IDS) budget[id] = quantize(budget[id] + (cost[id] ?? 0) * count); };
const addStrategic = (budget: StrategicResources, cost: StrategicResources, count = 1): void => { for (const id of STRATEGIC_RESOURCE_IDS) budget[id] = (budget[id] ?? 0) + (cost[id] ?? 0) * count; };
const buildingKey = (cityId: string, id: string): string => `${cityId}/building/${id}`;
const siteKey = (cityId: string, tileId: number): string => `${cityId}/site/${tileId}`;
const refuse = (reason: string): FrontierAssessment => Object.freeze({ quote: null, reason });
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) freeze(nested); Object.freeze(value); }
  return value;
}
function operated(state: WorldState, civId: number): Map<string, Footprint> {
  const result = new Map<string, Footprint>();
  for (const city of state.cities.filter(city => city.civId === civId)) {
    for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) {
      const receipt = operation.lastResult; if (receipt?.status !== 'operated') continue;
      const key = buildingKey(city.id, id); result.set(key, { key, id, ordinary: { ...receipt.paid }, strategic: { ...receipt.strategicPaid }, residents: receipt.residents?.allocated ?? 0, openingPopulation: city.population, available: receipt.residents?.available ?? 0 });
    }
    for (const improvement of Object.values(city.improvements ?? {})) {
      const receipt = improvement.operation.lastResult; if (receipt?.status !== 'operated') continue;
      const key = siteKey(city.id, improvement.tileId); result.set(key, { key, id: improvement.improvementId, ordinary: { ...receipt.paid }, strategic: {}, residents: receipt.residents.allocated, openingPopulation: city.population, available: receipt.residents.available });
    }
  }
  return result;
}
function pendingEffectSafe(definition: BuildingDefinition): boolean {
  return definition.effects.every(effect => Number.isFinite(effect.amount) && Number.isSafeInteger(Math.round(effect.amount * 100)) && (
    effect.kind === 'resource' ? effect.amount >= 0
      : effect.kind === 'civilization' ? ['influence', 'legitimacy'].includes(effect.field) && effect.amount >= 0
        : effect.kind === 'city' ? ['wellbeing', 'infrastructure'].includes(effect.field) && effect.amount >= 0 || effect.field === 'damage' && effect.amount <= 0
          : effect.kind === 'route' && effect.field === 'damage' && effect.amount <= 0));
}
function installPending(state: WorldState, pending: Pending): void {
  const city = state.cities.find(city => city.id === pending.cityId)!; const definition = pending.definition;
  city.construction = { ...city.construction!, active: null };
  if ('residentsRequired' in definition) {
    const tileId = pending.order.tileId!; city.improvements ??= {};
    city.improvements[String(tileId)] = { improvementId: definition.id, tileId, completion: { kind: 'improvement', orderId: pending.order.id, cityId: city.id, improvementId: definition.id, tileId, startedRound: pending.order.startedRound, completedRound: state.round, paid: { ...pending.order.paid }, workRequired: pending.order.workRequired, eventId: 'conditional-frontier' }, operation: { enabled: true, lastResult: null } };
  } else {
    city.buildings = [...city.buildings, definition.id];
    if (definition.district) city.districtSites = { ...city.districtSites, [definition.id]: pending.order.tileId! };
    if (paidRecipe(definition)) { city.buildingOperations ??= {}; city.buildingOperations[definition.id] = { enabled: true, lastResult: null }; }
  }
}
function sumFloorsBefore(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor; return divisor * quotient * (quotient - 1n) / 2n + quotient * (value % divisor);
}
function householdEnvelope(state: WorldState, city: City, horizon: number, pendingHousing: number, prospective: boolean): FrontierHouseholds | null {
  const reservedReturning = prospective ? 0 : borderReturnReservations(state, city.id);
  const population = city.population + reservedReturning;
  const capacity = cityGrowthFacts(state, city).capacity + pendingHousing;
  if (![population, capacity, reservedReturning, horizon].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  const growthCount = Math.min(horizon, Math.max(0, capacity - population));
  const p = BigInt(population); const g = BigInt(growthCount); const h = BigInt(horizon);
  const residentBeats = p * h + g * h - g * (g + 1n) / 2n;
  const householdCents = residentBeats * BigInt(Math.round(householdFoodUpkeep(state, 1) * 100));
  const localGrowth = hasFeatures(state, [LOCAL_GROWTH_RULES.featureId]);
  const growthFood = localGrowth ? BigInt(LOCAL_GROWTH_RULES.baseFoodCost) * g + sumFloorsBefore(p + g, BigInt(LOCAL_GROWTH_RULES.populationPerFoodCost)) - sumFloorsBefore(p, BigInt(LOCAL_GROWTH_RULES.populationPerFoodCost)) : BigInt(ECONOMY_RULES.growth.foodCost) * g;
  if (householdCents + growthFood * 100n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { cityId: prospective ? null : city.id, prospective, openingPopulation: population, reservedReturning, capacity, growthCount, householdFood: Number(householdCents) / 100, growthFood: Number(growthFood) };
}

export function createProductiveFrontierAssessment(state: WorldState, civId: number) {
  const revision = state.revision; const round = state.round;
  const actor = state.civilizations.find(actor => actor.id === civId);
  const farmDefinition = BUILDINGS.find(building => building.id === 'farm');
  const ownCities = state.cities.filter(city => city.civId === civId).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const land = createLandTransportPlanner(state);
  const assessments = new Map<string, FrontierAssessment>();
  const funding = new Map<string, { facts: Funding | null; reason: string | null }>();
  const locations = new Map<number, Pick<FundedFrontierQuote, 'landOpportunity' | 'contactOpportunity' | 'locationMultiplier'>>();
  let preparation: Prepared | undefined;
  const prepare = (): Prepared => {
    if (preparation) return preparation;
    const shared: Prepared = { horizon: 1, baseline: new Map(), footprints: new Map(), pending: [], failure: null }; preparation = shared;
    const reject = (reason: string): void => { shared.failure ??= reason; };
    if (!actor || !safe(actor.resources, actor.strategicResources) || !Number.isSafeInteger(state.round) || !Number.isSafeInteger(state.round + 1)) { reject('unsafe-accounting: opening resources or round cannot be bounded'); return shared; }
    if (actor.government?.pending) reject('government-transition: pending modifiers are not projected');
    const projected = projectOperationAllocation(state); shared.baseline = operated(projected, civId);
    if (!selectedInstitutionsFunded(projected, civId)) reject('selected-institution-unfunded: an accepted Studies institution lacks current inputs or residents');
    for (const compact of state.knowledge?.active ?? []) if (compact.status === 'accepted' && (compact.terms.teacherId === civId || compact.terms.learnerId === civId)) shared.horizon = Math.max(shared.horizon, compact.deadlineRound - state.round);
    for (const charter of state.relief?.active ?? []) if (charter.status === 'accepted' && charter.terms.donorId === civId) shared.horizon = Math.max(shared.horizon, charter.dueRound - state.round);
    for (const project of state.publicProjects ?? []) if (project.status === 'committed' && (project.proposer === civId || project.recipient === civId)) shared.horizon = Math.max(shared.horizon, project.dueRound - state.round);
    for (const route of state.routes) if (route.agreement?.enabled && (route.owner === civId || route.partner === civId)) {
      if (!Number.isSafeInteger(route.agreement.terms.cadenceRounds) || route.agreement.terms.cadenceRounds < 1 || !Number.isSafeInteger(route.agreement.nextDeliveryRound)) reject('unsafe-accounting: invalid route cadence or due round');
      shared.horizon = Math.max(shared.horizon, route.agreement.nextDeliveryRound - state.round);
    }
    for (const incident of state.border?.active ?? []) for (const party of incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]) {
      if (party.departure.actorId !== civId || party.returned) continue;
      shared.horizon = Math.max(shared.horizon, party.departure.returnByRound - state.round);
      for (const obligation of party.departure.operationForecast) {
        const key = obligation.kind === 'building' ? buildingKey(obligation.cityId, obligation.id) : siteKey(obligation.cityId, obligation.tileId!);
        const current = shared.baseline.get(key);
        if (!current || current.id !== obligation.id || current.residents !== obligation.residents || RESOURCE_IDS.some(id => (current.ordinary[id] ?? 0) !== (obligation.inputs[id] ?? 0)) || STRATEGIC_RESOURCE_IDS.some(id => (current.strategic[id] ?? 0) !== (obligation.strategicInputs[id] ?? 0))) reject('border-operation-unfunded: exact retained forecast is unavailable');
      }
    }
    const include = (city: City, definition: BuildingDefinition | ImprovementDefinition, tileId?: number): void => {
      const improvement = 'residentsRequired' in definition;
      if (!improvement && !paidRecipe(definition)) return;
      const key = improvement ? siteKey(city.id, tileId!) : buildingKey(city.id, definition.id);
      const ordinary = { ...definition.operatingInputs }; const strategic = 'strategicInputs' in definition ? { ...definition.strategicInputs } : {};
      if (!safe(ordinary, strategic)) reject('unsafe-accounting: an enabled recipe has unbounded inputs');
      shared.footprints.set(key, { key, id: definition.id, ordinary, strategic, residents: improvement ? definition.residentsRequired : RESIDENT_CAPACITY_RULES.perPaidRecipe, openingPopulation: city.population, available: 0 });
    };
    for (const city of ownCities) {
      if (!Number.isSafeInteger(city.population) || city.population < 1 || !city.housing) reject('unsafe-accounting: exact current population and housing are required');
      for (const id of city.buildings) if (city.buildingOperations?.[id]?.enabled) {
        const definition = BUILDINGS.find(building => building.id === id);
        if (!definition || !hasFeatures(state, definition.requiredFeatures)) reject('unsupported-operation: enabled building definition is unavailable'); else include(city, definition);
      }
      for (const improvement of Object.values(city.improvements ?? {})) if (improvement.operation.enabled) {
        const definition = IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId);
        if (!definition || !hasFeatures(state, definition.requiredFeatures)) reject('unsupported-operation: enabled site definition is unavailable'); else include(city, definition, improvement.tileId);
      }
      const order = city.construction?.active; if (!order) continue;
      if (!safeAmount(order.workRequired) || !safeAmount(order.workDone) || order.workDone > order.workRequired) { reject('unsafe-accounting: retained construction work is invalid'); continue; }
      if ('kind' in order && order.kind === 'rail') {
        if (railSiteBlock(state, city, order.tileId, order.toTileId, order.id)) reject('unsupported-order-support: retained Rail endpoints are unavailable');
        continue;
      }
      if ('kind' in order && order.kind === 'wonder') {
        const definition = WONDERS.find(candidate => candidate.id === order.wonderId);
        if (!definition || !hasFeatures(state, definition.requiredFeatures) || !safe(definition.production)) reject('unsupported-order: unknown Wonder completion effects');
        continue;
      }
      const definition = 'kind' in order ? IMPROVEMENTS.find(candidate => candidate.id === order.improvementId) : BUILDINGS.find(candidate => candidate.id === order.buildingId);
      if (!definition || !hasFeatures(state, definition.requiredFeatures)) { reject('unsupported-order: unknown or unreleased completion'); continue; }
      const temporaryCity = { ...city, construction: { ...city.construction!, active: null } };
      const temporary = { ...state, cities: state.cities.map(candidate => candidate.id === city.id ? temporaryCity : candidate) };
      if ('residentsRequired' in definition) {
        if (improvementSiteBlock(temporary, temporaryCity, definition, order.tileId!)) { reject('unsupported-order-support: retained exact improvement site is unavailable'); continue; }
      } else {
        if ((definition.localPowerInput ?? 0) > 0 || (definition.localPowerOutput ?? 0) > 0 || !pendingEffectSafe(definition)) { reject('unsupported-order-effects: pending Power, population or adverse effects are not bounded'); continue; }
        if (city.buildings.includes(definition.id) || (definition.requiresBuildings ?? []).some(id => !city.buildings.includes(id)) || definition.district && (order.tileId === undefined || districtSiteBlock(temporary, temporaryCity, definition, order.tileId))) { reject('unsupported-order-support: completed prerequisite or retained site is missing'); continue; }
        if (definition.siteRequirement === 'mountain-catchment' && (!('catchmentTileId' in order) || !availableMountainCatchments(state, city).includes(order.catchmentTileId!)) || definition.siteRequirement === 'campus-high-ground' && (!('highGround' in order) || !order.highGround || !availableCampusHighGround(state, city).some(site => site.campusTileId === order.highGround!.campusTileId && site.sourceTileId === order.highGround!.sourceTileId))) { reject('unsupported-order-support: retained mountain or Campus support is missing'); continue; }
      }
      include(city, definition, order.tileId); shared.pending.push({ cityId: city.id, order, definition });
    }
    if (!Number.isSafeInteger(shared.horizon) || shared.horizon < 1 || !Number.isSafeInteger(state.round + shared.horizon)) reject('unsafe-accounting: protected horizon exceeds safe rounds');
    return shared;
  };
  const budget = (source: City | null, destination: City, horizon: number): { facts: Funding | null; reason: string | null } => {
    const key = `${source ? `founding/${source.id}` : `farm/${destination.id}`}/${horizon}`;
    const cached = funding.get(key); if (cached) return cached;
    const reject = (reason: string) => { const result = { facts: null, reason }; funding.set(key, result); return result; };
    const shared = prepare(); if (shared.failure) return reject(shared.failure);
    if (!Number.isSafeInteger(horizon) || !Number.isSafeInteger(state.round + horizon)) return reject('unsafe-accounting: protected horizon exceeds safe rounds');
    const promised = exchangePromisedResources(state, civId, horizon);
    const ordinary = { ...promised.ordinary }; const strategic = { ...promised.strategic };
    const oneOperation = empty(); const oneStrategic: StrategicResources = {};
    if (!safe(ordinary, strategic)) return reject('unsafe-accounting: current promises cannot be bounded');
    if (source) add(ordinary, ECONOMY_RULES.settle.cost); add(ordinary, farmDefinition!.cost);
    for (const footprint of shared.footprints.values()) { add(oneOperation, footprint.ordinary); addStrategic(oneStrategic, footprint.strategic); }
    add(ordinary, oneOperation, horizon); addStrategic(strategic, oneStrategic, horizon);
    const households: FrontierHouseholds[] = [];
    const towns = source ? [...ownCities.map(city => city.id === source.id ? { ...city, population: city.population - ECONOMY_RULES.settle.population } : city), destination] : ownCities;
    for (const city of towns) {
      const pendingHousing = shared.pending.filter(pending => pending.cityId === city.id).reduce((sum, pending) => sum + ('housing' in pending.definition ? pending.definition.housing ?? 0 : 0), 0);
      const envelope = householdEnvelope(state, city, horizon, pendingHousing, !!source && city.id === prospectiveId);
      if (!envelope) return reject('unsafe-accounting: household growth exceeds bounded population or Food arithmetic');
      households.push(envelope); ordinary.food = quantize(ordinary.food + envelope.householdFood + envelope.growthFood);
    }
    if (!safe(ordinary, strategic) || RESOURCE_IDS.some(id => actor!.resources[id] < ordinary[id]) || STRATEGIC_RESOURCE_IDS.some(id => (actor!.strategicResources?.[id] ?? 0) < (strategic[id] ?? 0))) return reject('opening-budget: current stocks must fund setup, growing households, operations and existing promises without future income');
    const projected = projectOperationAllocation(state, opening => {
      const payer = opening.civilizations.find(actor => actor.id === civId)!;
      for (const id of RESOURCE_IDS) payer.resources[id] = quantize(payer.resources[id] - ordinary[id] + oneOperation[id]);
      payer.strategicResources ??= {};
      for (const id of STRATEGIC_RESOURCE_IDS) payer.strategicResources[id] = (payer.strategicResources[id] ?? 0) - (strategic[id] ?? 0) + (oneStrategic[id] ?? 0);
      if (source) opening.cities.find(city => city.id === source.id)!.population -= ECONOMY_RULES.settle.population;
      for (const pending of shared.pending) installPending(opening, pending);
    });
    const actual = operated(projected, civId); const required = new Set(shared.baseline.keys());
    for (const pending of shared.pending) {
      const key = 'residentsRequired' in pending.definition ? siteKey(pending.cityId, pending.order.tileId!) : buildingKey(pending.cityId, pending.definition.id);
      if (shared.footprints.has(key)) required.add(key);
    }
    if ([...required].some(key => !actual.has(key)) || !selectedInstitutionsFunded(projected, civId)) return reject('protected-operation: current residents and retained supplies cannot support every funded or already-paid recipe');
    const retainedOperations = [...required].sort();
    const facts: Funding = { protectedBudget: { ordinary, strategic }, households, retainedOperations, allocations: retainedOperations.map(key => { const result = actual.get(key)!; return { key, openingPopulation: result.openingPopulation, required: result.residents, available: result.available, allocated: result.residents }; }) };
    const result = { facts, reason: null }; funding.set(key, result); return result;
  };
  const location = (tileId: number) => {
    const cached = locations.get(tileId); if (cached) return cached;
    const center = tiles.get(tileId)!; const ownCenters = ownCities.flatMap(city => tiles.get(city.tileId) ?? []);
    const count = state.tiles.filter(tile => tile.id !== tileId && tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && hexDistance(center, tile) <= 3 && !districtSiteOccupied(state, tile.id) && !ownCenters.some(site => hexDistance(site, tile) <= 3)).length;
    const landOpportunity = Math.min(1, count / 4); let contactOpportunity = 0;
    const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials');
    if (recipe && hasFeatures(state, [...recipe.requiredFeatures, 'land-transport']) && (!recipe.requiredTechnology || actor!.technologies.includes(recipe.requiredTechnology))) {
      for (const foreign of state.cities.filter(city => city.civId !== civId)) {
        if (borderDealFailure(state, civId, foreign.civId) || state.routes.some(route => route.agreement?.enabled && (route.owner === civId && route.partner === foreign.civId || route.partner === civId && route.owner === foreign.civId)) || (state.tradeOffers ?? []).some(offer => offer.status === 'pending' && (offer.proposer === civId && offer.recipient === foreign.civId || offer.recipient === civId && offer.proposer === foreign.civId))) continue;
        const candidate = land.quote(foreign.tileId, tileId); if (!candidate) continue;
        const oldCadences = ownCities.flatMap(city => { const path = land.quote(foreign.tileId, city.tileId); return path ? [landTransportCadence(recipe.terms.cadenceRounds, path)] : []; });
        if (!oldCadences.length) continue;
        const improvement = Math.max(0, Math.min(...oldCadences) - landTransportCadence(recipe.terms.cadenceRounds, candidate));
        contactOpportunity = Math.max(contactOpportunity, Math.min(1, improvement / 2));
      }
    }
    const result = { landOpportunity, contactOpportunity, locationMultiplier: 1 + 0.25 * landOpportunity + 0.25 * contactOpportunity }; locations.set(tileId, result); return result;
  };
  const assess = (source: City | null, destination: City): FrontierAssessment => {
    const shared = prepare(); if (shared.failure) return refuse(shared.failure);
    if (!farmDefinition || !actor?.technologies.includes('agriculture')) return refuse('Farm-unavailable: current Cultivation and the ordinary Farm are required');
    const eligibilityState = source ? { ...state, cities: [...state.cities, destination] } : state;
    if (buildingEligibility(eligibilityState, civId, farmDefinition, destination.id).blockers.length) return refuse('Farm-unavailable: ordinary Farm prerequisites are not currently met');
    const work = constructionWork(state, destination); const workRequired = requiredConstructionWork(farmDefinition.id);
    const admissionAllowanceBeats = source ? 1 : 0; const workBeats = Math.ceil(workRequired / work); const firstOperationBeat = admissionAllowanceBeats + workBeats + 1;
    if (!safeAmount(work) || work <= 0 || !safeAmount(workRequired) || !Number.isSafeInteger(firstOperationBeat) || firstOperationBeat > 8) return refuse('first-output-horizon: conditional Farm output cannot fit within eight beats');
    const protectedHorizon = Math.max(shared.horizon, firstOperationBeat + 1); const funded = budget(source, destination, protectedHorizon);
    if (!funded.facts) return refuse(funded.reason!);
    const opportunity = source ? location(destination.tileId) : { landOpportunity: 0, contactOpportunity: 0, locationMultiplier: 1 };
    return freeze({ quote: { kind: 'conditional-frontier', mode: source ? 'founding' : 'farm', revision, sourceCityId: source?.id ?? null, cityId: source ? null : destination.id, tileId: destination.tileId,
      sourcePopulationBefore: source?.population ?? null, sourcePopulationAfter: source ? source.population - ECONOMY_RULES.settle.population : null, arrivingPopulation: source ? ECONOMY_RULES.settle.population : 0, arrivingWorkforce: source ? Math.max(0, ECONOMY_RULES.settle.population - RESIDENT_CAPACITY_RULES.communityReserve) : 0,
      foundingCost: source ? { ...ECONOMY_RULES.settle.cost } : {}, setupCost: { ...farmDefinition.cost }, admissionAllowanceBeats, workBeats, firstOperationBeat, protectedHorizon, ...funded.facts, ...opportunity }, reason: null });
  };
  const founding = (action: Founding): FrontierAssessment => {
    if (state.revision !== revision || state.round !== round) return refuse('stale-assessment: create a new context for the current immutable chooser call');
    const key = `founding/${action.sourceCityId}/${action.tileId}`; const cached = assessments.get(key); if (cached) return cached;
    const source = ownCities.find(city => city.id === action.sourceCityId); const tile = tiles.get(action.tileId);
    let result: FrontierAssessment;
    if (!source || !foundingSourceEligible(source) || !hasFeatures(state, ['settlement-expansion', 'conserved-founding'])) result = refuse('founding-source: three actual people must leave and at least three remain');
    else if (!tile || !foundingSiteEligible(state, tile) || !state.tiles.some(owned => owned.owner === civId && hexDistance(owned, tile) <= 2)) result = refuse('founding-site: ordinary legal ownership, distance and frontier reach are required');
    else {
      const destination: City = { id: prospectiveId, name: 'Conditional frontier', civId, tileId: tile.id, ...ECONOMY_RULES.initialCity, population: ECONOMY_RULES.settle.population, focus: source.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', baseCapacity: LOCAL_GROWTH_RULES.foundedBaseCapacity, establishedRound: state.round } };
      result = assess(source, destination);
    }
    assessments.set(key, result); return result;
  };
  const farm = (cityId: string): FrontierAssessment => {
    if (state.revision !== revision || state.round !== round) return refuse('stale-assessment: create a new context for the current immutable chooser call');
    const key = `farm/${cityId}`; const cached = assessments.get(key); if (cached) return cached;
    const city = ownCities.find(city => city.id === cityId); const age = city?.housing ? state.round - city.housing.establishedRound : -1;
    const result = !city || city.housing?.origin !== 'founded' || city.coastalFounding || !Number.isSafeInteger(age) || age < 0 || age > 8 || city.buildings.length > 0 || city.construction?.active
      ? refuse('fresh-town: only an idle ordinary founded town aged zero through eight without completed buildings receives this optional preference') : assess(null, city);
    assessments.set(key, result); return result;
  };
  return Object.freeze({ founding, farm });
}
