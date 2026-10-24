import { createFoundingProtection, freezeFoundingFacts, type FoundingHouseholds } from './behavior-founding-protection.ts';
import { BUILDINGS, ECONOMY_RULES, LOCAL_GROWTH_RULES, RESIDENT_CAPACITY_RULES, TRADE_RECIPES } from './content.ts';
import { borderDealFailure } from './simulation/border-incidents.ts';
import { buildingEligibility } from './simulation/capabilities.ts';
import { foundingSiteEligible, foundingSourceEligible } from './simulation/coastal.ts';
import { constructionWork, requiredConstructionWork } from './simulation/construction.ts';
import { districtSiteOccupied } from './simulation/districts.ts';
import { hexDistance } from './simulation/geography.ts';
import { hasFeatures } from './simulation/history.ts';
import { createLandTransportPlanner, landTransportCadence } from './simulation/transport.ts';
import type { City, GameAction, Resources, StrategicResources, WorldState } from './types.ts';

export type FrontierHouseholds = FoundingHouseholds;
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
type Founding = Extract<GameAction, { type: 'settle' }>;
const prospectiveId = 'conditional-frontier-prospective-town';
const safeAmount = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const refuse = (reason: string): FrontierAssessment => Object.freeze({ quote: null, reason });

export function createProductiveFrontierAssessment(state: WorldState, civId: number) {
  const revision = state.revision; const round = state.round;
  const actor = state.civilizations.find(actor => actor.id === civId);
  const farmDefinition = BUILDINGS.find(building => building.id === 'farm');
  const ownCities = state.cities.filter(city => city.civId === civId).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const land = createLandTransportPlanner(state);
  const assessments = new Map<string, FrontierAssessment>();
  const locations = new Map<number, Pick<FundedFrontierQuote, 'landOpportunity' | 'contactOpportunity' | 'locationMultiplier'>>();
  const protection = createFoundingProtection(state, civId);
  const prepare = protection.prepare;
  const budget = (source: City | null, destination: City, horizon: number) => protection.fund({ source, destination, horizon, foundingCost: source ? ECONOMY_RULES.settle.cost : {}, setupCost: farmDefinition!.cost });
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
    return freezeFoundingFacts({ quote: { kind: 'conditional-frontier', mode: source ? 'founding' : 'farm', revision, sourceCityId: source?.id ?? null, cityId: source ? null : destination.id, tileId: destination.tileId,
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
