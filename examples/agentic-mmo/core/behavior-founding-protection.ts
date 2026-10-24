import { woodlandContinuousCapacity } from './behavior-woodlands.ts';
import { isWoodlandImprovement } from './simulation/woodlands.ts';
import { WOODLAND_RULES } from './woodland-content.ts';
import { exchangePromisedResources } from './behavior-knowledge.ts';
import { selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, LOCAL_GROWTH_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, WONDERS } from './content.ts';
import { borderReturnReservations } from './simulation/border-incidents.ts';
import { districtSiteBlock } from './simulation/districts.ts';
import { householdFoodUpkeep } from './simulation/food-security.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { availableCampusHighGround } from './simulation/observatory.ts';
import { paidRecipe, projectOperationAllocation } from './simulation/operations.ts';
import { railSiteBlock } from './simulation/rail.ts';
import { availableMountainCatchments } from './simulation/water.ts';
import type { BuildingDefinition, City, ConstructionOrder, ImprovementDefinition, Resources, StrategicResources, WorldState } from './types.ts';

export interface FoundingHouseholds {
  readonly cityId: string | null;
  readonly prospective: boolean;
  readonly openingPopulation: number;
  readonly reservedReturning: number;
  readonly capacity: number;
  readonly growthCount: number;
  readonly householdFood: number;
  readonly growthFood: number;
}
export interface FoundingFunding {
  readonly protectedBudget: Readonly<{ ordinary: Readonly<Resources>; strategic: Readonly<StrategicResources> }>;
  readonly households: readonly FoundingHouseholds[];
  readonly retainedOperations: readonly string[];
  readonly allocations: readonly { key: string; openingPopulation: number; required: number; available: number; allocated: number }[];
}
export interface FoundingFundingAssessment { readonly facts: FoundingFunding | null; readonly reason: string | null }
export interface FoundingProtectionRequest {
  readonly kind?: 'founding';
  readonly source: City | null;
  readonly destination: City;
  readonly horizon: number;
  readonly foundingCost: Readonly<Partial<Resources>>;
  readonly setupCost: Readonly<Partial<Resources>>;
  readonly allocationMode?: 'reserved-tail' | 'actual-payment';
  readonly requireEnabledOperations?: boolean;
}
export interface CurrentTownsProtectionRequest {
  readonly kind: 'current-towns';
  readonly horizon: number;
  readonly setupCost: Readonly<Partial<Resources>>;
  readonly allocationMode: 'actual-payment';
  readonly requireEnabledOperations: true;
}
interface Footprint { key: string; id: string; ordinary: Partial<Resources>; strategic: StrategicResources; residents: number; openingPopulation: number; available: number }
interface Pending { cityId: string; order: ConstructionOrder; definition: BuildingDefinition | ImprovementDefinition }
interface Prepared { horizon: number; baseline: Map<string, Footprint>; footprints: Map<string, Footprint>; pending: Pending[]; failure: string | null }
const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (value: number): number => Math.round(value * 100) / 100;
const safeAmount = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const safe = (ordinary: Partial<Resources>, strategic: StrategicResources = {}): boolean => RESOURCE_IDS.every(id => safeAmount(ordinary[id] ?? 0)) && STRATEGIC_RESOURCE_IDS.every(id => Number.isSafeInteger(strategic[id] ?? 0) && (strategic[id] ?? 0) >= 0);
const add = (budget: Resources, cost: Partial<Resources>, count = 1): void => { for (const id of RESOURCE_IDS) budget[id] = quantize(budget[id] + (cost[id] ?? 0) * count); };
const addStrategic = (budget: StrategicResources, cost: StrategicResources, count = 1): void => { for (const id of STRATEGIC_RESOURCE_IDS) budget[id] = (budget[id] ?? 0) + (cost[id] ?? 0) * count; };
const buildingKey = (cityId: string, id: string): string => `${cityId}/building/${id}`;
const siteKey = (cityId: string, tileId: number): string => `${cityId}/site/${tileId}`;
export function freezeFoundingFacts<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) freezeFoundingFacts(nested); Object.freeze(value); }
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
    city.improvements[String(tileId)] = { improvementId: definition.id, tileId, completion: { kind: 'improvement', orderId: pending.order.id, cityId: city.id, improvementId: definition.id, tileId, startedRound: pending.order.startedRound, completedRound: hasFeatures(state, [WOODLAND_RULES.featureId]) && isWoodlandImprovement(definition.id) ? state.round - 1 : state.round, paid: { ...pending.order.paid }, workRequired: pending.order.workRequired, eventId: 'conditional-frontier' }, operation: { enabled: true, lastResult: null } };
  } else {
    city.buildings = [...city.buildings, definition.id];
    if (definition.district) city.districtSites = { ...city.districtSites, [definition.id]: pending.order.tileId! };
    if (paidRecipe(definition)) { city.buildingOperations ??= {}; city.buildingOperations[definition.id] = { enabled: true, lastResult: null }; }
  }
}
function sumFloorsBefore(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor; return divisor * quotient * (quotient - 1n) / 2n + quotient * (value % divisor);
}
function householdEnvelope(state: WorldState, city: City, horizon: number, pendingHousing: number, prospective: boolean): FoundingHouseholds | null {
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

export function createFoundingProtection(state: WorldState, civId: number) {
  const actor = state.civilizations.find(actor => actor.id === civId);
  const ownCities = state.cities.filter(city => city.civId === civId).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const funding = new Map<string, FoundingFundingAssessment>();
  let preparation: Prepared | undefined;
  let allocationProjections = 0;
  const prepare = (): Prepared => {
    if (preparation) return preparation;
    const shared: Prepared = { horizon: 1, baseline: new Map(), footprints: new Map(), pending: [], failure: null }; preparation = shared;
    const reject = (reason: string): void => { shared.failure ??= reason; };
    if (state.civicWorks?.active.some(commission => commission.civId === civId)) { reject('active-civic-works: scheduled crew fees and earlier paid recipes are outside this founding forecast'); return shared; }
    if (!actor || !safe(actor.resources, actor.strategicResources) || !Number.isSafeInteger(state.round) || !Number.isSafeInteger(state.round + 1)) { reject('unsafe-accounting: opening resources or round cannot be bounded'); return shared; }
    if (actor.government?.pending) reject('government-transition: pending modifiers are not projected');
    allocationProjections++;
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
  const fund = (request: FoundingProtectionRequest | CurrentTownsProtectionRequest): FoundingFundingAssessment => {
    const { horizon, setupCost } = request;
    const source = request.kind === 'current-towns' ? null : request.source;
    const destination = request.kind === 'current-towns' ? null : request.destination;
    const foundingCost: Readonly<Partial<Resources>> = request.kind === 'current-towns' ? {} : request.foundingCost;
    const key = JSON.stringify([request.kind ?? 'founding', source?.id ?? null, destination?.id ?? null, horizon, foundingCost, setupCost, request.allocationMode ?? 'reserved-tail', request.requireEnabledOperations ?? false]);
    const cached = funding.get(key); if (cached) return cached;
    const reject = (reason: string) => { const result = { facts: null, reason }; funding.set(key, result); return result; };
    const shared = prepare(); if (shared.failure) return reject(shared.failure);
    if (!Number.isSafeInteger(horizon) || !Number.isSafeInteger(state.round + horizon)) return reject('unsafe-accounting: protected horizon exceeds safe rounds');
    const woodlandSites = ownCities.flatMap(town => Object.values(town.improvements ?? {})).filter(site => site.operation.enabled);
    if (woodlandSites.some(site => !woodlandContinuousCapacity(state, site.improvementId, site.tileId, horizon)) || shared.pending.some(pending => 'residentsRequired' in pending.definition && !woodlandContinuousCapacity(state, pending.definition.id, pending.order.tileId!, horizon))) return reject('woodland-horizon: protected sites need enough opening local stock without assuming recovery');
    const promised = exchangePromisedResources(state, civId, horizon);
    const ordinary = { ...promised.ordinary }; const strategic = { ...promised.strategic };
    const oneOperation = empty(); const oneStrategic: StrategicResources = {};
    if (!safe(ordinary, strategic)) return reject('unsafe-accounting: current promises cannot be bounded');
    add(ordinary, foundingCost); add(ordinary, setupCost);
    for (const footprint of shared.footprints.values()) { add(oneOperation, footprint.ordinary); addStrategic(oneStrategic, footprint.strategic); }
    add(ordinary, oneOperation, horizon); addStrategic(strategic, oneStrategic, horizon);
    const households: FoundingHouseholds[] = [];
    const towns = source ? [...ownCities.map(city => city.id === source.id ? { ...city, population: city.population - ECONOMY_RULES.settle.population } : city), destination!] : ownCities;
    for (const city of towns) {
      const pendingHousing = shared.pending.filter(pending => pending.cityId === city.id).reduce((sum, pending) => sum + ('housing' in pending.definition ? pending.definition.housing ?? 0 : 0), 0);
      const envelope = householdEnvelope(state, city, horizon, pendingHousing, !!source && city.id === destination!.id);
      if (!envelope) return reject('unsafe-accounting: household growth exceeds bounded population or Food arithmetic');
      households.push(envelope); ordinary.food = quantize(ordinary.food + envelope.householdFood + envelope.growthFood);
    }
    if (!safe(ordinary, strategic) || RESOURCE_IDS.some(id => actor!.resources[id] < ordinary[id]) || STRATEGIC_RESOURCE_IDS.some(id => (actor!.strategicResources?.[id] ?? 0) < (strategic[id] ?? 0))) return reject('opening-budget: current stocks must fund setup, growing households, operations and existing promises without future income');
    allocationProjections++;
    const projected = projectOperationAllocation(state, opening => {
      const payer = opening.civilizations.find(actor => actor.id === civId)!;
      for (const id of RESOURCE_IDS) payer.resources[id] = request.allocationMode === 'actual-payment'
        ? quantize(payer.resources[id] - (foundingCost[id] ?? 0) - (setupCost[id] ?? 0))
        : quantize(payer.resources[id] - ordinary[id] + oneOperation[id]);
      payer.strategicResources ??= {};
      if (request.allocationMode !== 'actual-payment') for (const id of STRATEGIC_RESOURCE_IDS) payer.strategicResources[id] = (payer.strategicResources[id] ?? 0) - (strategic[id] ?? 0) + (oneStrategic[id] ?? 0);
      if (source) opening.cities.find(city => city.id === source.id)!.population -= ECONOMY_RULES.settle.population;
      for (const pending of shared.pending) installPending(opening, pending);
    });
    const actual = operated(projected, civId); const required = new Set(request.requireEnabledOperations ? shared.footprints.keys() : shared.baseline.keys());
    for (const pending of shared.pending) {
      const key = 'residentsRequired' in pending.definition ? siteKey(pending.cityId, pending.order.tileId!) : buildingKey(pending.cityId, pending.definition.id);
      if (shared.footprints.has(key)) required.add(key);
    }
    if ([...required].some(key => !actual.has(key)) || !selectedInstitutionsFunded(projected, civId)) return reject('protected-operation: current residents and retained supplies cannot support every funded or already-paid recipe');
    const retainedOperations = [...required].sort();
    const facts: FoundingFunding = { protectedBudget: { ordinary, strategic }, households, retainedOperations, allocations: retainedOperations.map(key => { const result = actual.get(key)!; return { key, openingPopulation: result.openingPopulation, required: result.residents, available: result.available, allocated: result.residents }; }) };
    const result = { facts, reason: null }; funding.set(key, result); return result;
  };
  return Object.freeze({ prepare: (): Readonly<Pick<Prepared, 'horizon' | 'failure'>> => prepare(), fund, get work() { return Object.freeze({ allocationProjections }); } });
}
