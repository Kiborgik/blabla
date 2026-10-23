import { civilizationFoodUpkeep } from './simulation/food-security.ts';
import type { BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, CIVICS, IMPROVEMENTS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, SPACEFLIGHT_RULES, STRATEGIC_RESOURCE_IDS, STRATEGIC_RESOURCE_RULES, VICTORY_RULES, TECHNOLOGIES, TRADE_RECIPES } from './content.ts';
import { isCoastalSite } from './simulation/coastal.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { observedStrategicResources } from './simulation/metals.ts';
import { paidRecipe } from './simulation/operations.ts';
import { railEdgeId } from './simulation/rail.ts';
import { strategicObligations } from './simulation/trade.ts';
import { createLandTransportPlanner, createSteamTransportPlanner, transportCadence } from './simulation/transport.ts';
import type { ActionOption, BuildingDefinition, City, Civilization, Resource, Resources, SteamTransportQuote, StrategicDeposit, TradeTerms, WorldState } from './types.ts';

export interface ProgressionPlan {
  coastalNeeded: boolean;
  coastalCities: ReadonlySet<string>;
  coastalSites: ReadonlySet<number>;
  researchNeeded: boolean;
  researchGoals: ReadonlySet<string>;
  foundryCitiesNeeded: ReadonlySet<string>;
  deposits: ReadonlyMap<number, StrategicDeposit>;
  usefulRailEdges: ReadonlySet<string>;
  usefulRailTiles: ReadonlySet<number>;
  replaceableRoutes: ReadonlySet<string>;
  desiredBuildings: ReadonlySet<string>;
  desiredImprovements: ReadonlySet<string>;
  shortages: Resources;
  cityById: ReadonlyMap<string, City>;
  spaceSupplyNeeded: boolean;
}

const buildingById = new Map(BUILDINGS.map(building => [building.id, building]));
const operationKey = (cityId: string, buildingId: string): string => `${cityId}/${buildingId}`;
const improvementKey = (cityId: string, tileId: number): string => `${cityId}/${tileId}`;

function technologyAncestors(targets: readonly string[], actor: Civilization): Set<string> {
  const result = new Set<string>();
  const visit = (id: string): void => {
    if (actor.technologies.includes(id) || result.has(id)) return;
    result.add(id);
    for (const prerequisite of TECHNOLOGIES.find(technology => technology.id === id)?.requires ?? []) visit(prerequisite);
  };
  targets.forEach(visit);
  return result;
}

function economyNeeds(state: WorldState, actor: Civilization, cities: readonly City[]): Resources {
  const upkeep = civilizationFoodUpkeep(state, actor.id);
  const operations = cities.flatMap(city => city.buildings.flatMap(id => buildingById.get(id) ?? []));
  const demand = (resource: Resource): number => operations.reduce((sum, building) => sum + (building.operatingInputs?.[resource] ?? 0), 0);
  return {
    food: actor.resources.food < upkeep * 4 + cities.length * 8 ? 4 : 1,
    materials: actor.resources.materials < cities.length * 16 + 24 ? 3 : 0.7,
    energy: actor.resources.energy < demand('energy') * 4 + 24 ? 5 : 0.7,
    credits: actor.resources.credits < demand('credits') * 5 + cities.length * 12 + 20 ? 5 : 1,
    science: TECHNOLOGIES.some(technology => hasFeatures(state, technology.requiredFeatures) && !actor.technologies.includes(technology.id)) ? 5 : 0,
    culture: CIVICS.some(civic => !actor.civics?.completedCivicIds.includes(civic.id)) ? 1.5 : 0.25,
  };
}

function stateSpaceNeed(actor: Civilization, plan: ProgressionPlan): boolean {
  return actor.technologies.includes('spaceflight') && plan.spaceSupplyNeeded;
}

function operationUtility(building: BuildingDefinition, city: City, actor: Civilization, plan: ProgressionPlan, profile: BehaviorProfile): number {
  let value = RESOURCE_IDS.reduce((sum, resource) => sum + (building.production[resource] ?? 0) * plan.shortages[resource] * Math.sqrt(profile.resources[resource]), 0);
  value -= RESOURCE_IDS.reduce((sum, resource) => sum + (building.operatingInputs?.[resource] ?? 0) * plan.shortages[resource] * 0.5, 0);
  if (building.id === 'launchpad') {
    const mission = stateSpaceNeed(actor, plan);
    value = mission ? 180 : 0;
  }
  if (building.id === 'foundry' && plan.foundryCitiesNeeded.has(city.id)) value += 100;
  if (building.id === 'factory' && actor.resources.materials > 80) value = 0;
  if ((building.strategicInputs?.iron ?? 0) > 0 && !plan.foundryCitiesNeeded.has(city.id) && actor.resources.materials > 80) value = 0;
  if ((building.strategicInputs?.coal ?? 0) > 0) value = 0;
  return Math.max(0, value);
}

function planOperations(state: WorldState, actor: Civilization, cities: readonly City[], plan: ProgressionPlan, profile: BehaviorProfile): void {
  const desired = plan.desiredBuildings as Set<string>;
  const improvements = plan.desiredImprovements as Set<string>;
  const budget = { ...actor.resources };
  const strategic = { ...actor.strategicResources };
  for (const city of cities.toSorted((a, b) => a.id.localeCompare(b.id))) {
    let available = hasFeatures(state, ['resident-capacity']) ? Math.max(0, city.population - RESIDENT_CAPACITY_RULES.communityReserve) : Infinity;
    const mines = Object.values(city.improvements ?? {}).filter(improvement => {
      const deposit = plan.deposits.get(improvement.tileId);
      return improvement.improvementId === 'mine' && deposit && deposit.remaining > 0 && (actor.strategicResources?.[deposit.resource] ?? 0) < cities.length * STRATEGIC_RESOURCE_RULES[deposit.resource].capacityPerCity;
    });
    for (const mine of mines.toSorted((a, b) => a.tileId - b.tileId)) {
      const residents = IMPROVEMENTS.find(definition => definition.id === mine.improvementId)?.residentsRequired ?? 1;
      if (available < residents) continue;
      improvements.add(improvementKey(city.id, mine.tileId)); available -= residents;
    }
    const installed = city.buildings.flatMap(id => buildingById.get(id) ?? []).filter(paidRecipe);
    const ranked = installed.filter(building => !(building.localPowerOutput ?? 0)).map(building => ({ building, utility: operationUtility(building, city, actor, plan, profile) }))
      .sort((a, b) => b.utility - a.utility || a.building.id.localeCompare(b.building.id));
    let power = 0;
    for (const { building, utility } of ranked) {
      if (utility <= 0) continue;
      const generator = (building.localPowerInput ?? 0) > power ? installed.find(candidate => (candidate.localPowerOutput ?? 0) >= (building.localPowerInput ?? 0)) : undefined;
      if ((building.localPowerInput ?? 0) > power && (!generator || desired.has(operationKey(city.id, generator.id)))) continue;
      const recipes = generator && !desired.has(operationKey(city.id, generator.id)) ? [generator, building] : [building];
      const residents = hasFeatures(state, ['resident-capacity']) ? RESIDENT_CAPACITY_RULES.perPaidRecipe * recipes.length : 0;
      if (available < residents) continue;
      if (RESOURCE_IDS.some(resource => budget[resource] < recipes.reduce((sum, recipe) => sum + (recipe.operatingInputs?.[resource] ?? 0), 0))) continue;
      if ((['iron', 'coal'] as const).some(resource => {
        const required = recipes.reduce((sum, recipe) => sum + (recipe.strategicInputs?.[resource] ?? 0), 0);
        return required > 0 && (strategic[resource] ?? 0) < required + (resource === 'coal' ? 2 : 0);
      })) continue;
      for (const recipe of recipes) {
        desired.add(operationKey(city.id, recipe.id));
        for (const resource of RESOURCE_IDS) budget[resource] -= recipe.operatingInputs?.[resource] ?? 0;
        for (const resource of ['iron', 'coal'] as const) strategic[resource] = (strategic[resource] ?? 0) - (recipe.strategicInputs?.[resource] ?? 0);
        power += (recipe.localPowerOutput ?? 0) - (recipe.localPowerInput ?? 0);
      }
      available -= residents;
    }
    for (const improvement of Object.values(city.improvements ?? {}).toSorted((a, b) => a.tileId - b.tileId)) {
      if (improvements.has(improvementKey(city.id, improvement.tileId))) continue;
      const residents = IMPROVEMENTS.find(definition => definition.id === improvement.improvementId)?.residentsRequired ?? 1;
      if (available < residents) continue;
      improvements.add(improvementKey(city.id, improvement.tileId)); available -= residents;
    }
  }
}

function planTransport(state: WorldState, actor: Civilization, options: readonly ActionOption[], plan: ProgressionPlan): void {
  if (!actor.technologies.includes('steam-power') || state.industrialEvidence?.steamDelivery) return;
  const land = createLandTransportPlanner(state);
  const steam = createSteamTransportPlanner(state);
  const pairs = new Map<string, { from: City; to: City; cadence: number }>();
  const replaceable = plan.replaceableRoutes as Set<string>;
  for (const route of state.routes) {
    if (!route.agreement?.enabled || route.owner !== actor.id && route.partner !== actor.id) continue;
    const from = state.cities.find(city => city.id === route.from); const to = state.cities.find(city => city.id === route.to);
    if (!from || !to) continue;
    const recipe = TRADE_RECIPES.find(candidate => candidate.id === route.agreement?.terms.recipeId);
    if (!recipe) continue;
    pairs.set(`${from.id}/${to.id}`, { from, to, cadence: recipe.terms.cadenceRounds });
    if (route.agreement.terms.transport?.mode === 'steam') continue;
    const own = from.civId === actor.id ? from : to; const partner = own === from ? to : from;
    const quote = steam.quote(own.tileId, partner.tileId, recipe.terms.cadenceRounds);
    if (quote && quote.railEdges.length && transportCadence(recipe.terms.cadenceRounds, quote) < quote.unrailedCadence && fundedSteam(actor, recipe.terms, quote)
      && RESOURCE_IDS.every(resource => actor.resources[resource] >= (recipe.terms.constructionCost[resource] ?? 0) + (recipe.terms.proposerCargo[resource] ?? 0) + (recipe.terms.proposerUpkeep[resource] ?? 0) * 3)) replaceable.add(route.id);
  }
  for (const option of options) {
    const action = option.action;
    if (action.type !== 'propose-trade' || !option.tradeQuote) continue;
    const from = plan.cityById.get(action.sourceCityId ?? ''); const to = state.cities.find(city => city.id === action.recipientCityId);
    const recipe = TRADE_RECIPES.find(candidate => candidate.id === action.recipeId);
    if (from && to && recipe) pairs.set(`${from.id}/${to.id}`, { from, to, cadence: recipe.terms.cadenceRounds });
  }
  const edges = plan.usefulRailEdges as Set<string>; const tiles = plan.usefulRailTiles as Set<number>;
  for (const { from, to, cadence } of pairs.values()) {
    const quote = land.quote(from.tileId, to.tileId);
    if (!quote || quote.edges <= cadence * 2) continue;
    const existing = steam.quote(from.tileId, to.tileId, cadence);
    if (existing && existing.railEdges.length && transportCadence(cadence, existing) < existing.unrailedCadence) continue;
    for (let index = 1; index < quote.tileIds.length; index++) {
      const first = quote.tileIds[index - 1]; const second = quote.tileIds[index];
      if (first === undefined || second === undefined) continue;
      const edge = railEdgeId(first, second);
      if (state.railEdges?.[edge]) continue;
      edges.add(edge); tiles.add(first); tiles.add(second);
    }
  }
}

function fundedSteam(actor: Civilization, terms: TradeTerms, quote: SteamTransportQuote): boolean {
  const required = strategicObligations({ ...terms, transport: quote }, 'proposer');
  return STRATEGIC_RESOURCE_IDS.every(resource => (actor.strategicResources?.[resource] ?? 0) >= (required[resource] ?? 0));
}

export function deriveProgressionPlan(state: WorldState, actor: Civilization, profile: BehaviorProfile, options: readonly ActionOption[]): ProgressionPlan {
  const cities = state.cities.filter(city => city.civId === actor.id);
  const coastalNeeded = hasFeatures(state, ['coastal-founding']) && (state.eventCounts['coastal-founded'] ?? 0) === 0 && !state.cities.some(city => city.coastalFounding);
  const coastCandidates = new Set([...cities.map(city => city.tileId), ...options.flatMap(option => option.action.type === 'settle' || option.action.type === 'settle-coast' ? [option.action.tileId] : [])]);
  const coastalSites = new Set(coastalNeeded ? [...coastCandidates].filter(tileId => isCoastalSite(state, tileId)) : []);
  const coastalCities = new Set(cities.filter(city => coastalSites.has(city.tileId)).map(city => city.id));
  const targets = coastalNeeded ? ['navigation'] : !state.calendarMilestones.includes('industrial-world') ? ['industrialization', 'steam-power'] : ['computing', 'spaceflight'];
  const researchGoals = technologyAncestors([...targets, 'agriculture', 'writing', 'currency', 'education', 'banking', 'masonry', 'fuel-management'], actor);
  const witnessed = new Set(state.industrialEvidence?.foundryOperations.map(receipt => receipt.cityId) ?? []);
  const missingFoundries = (state.industrialEvidence?.foundryOperations.length ?? 0) < 2;
  const space = state.spaceflight?.civilizations[actor.id];
  const supplyHorizon = SPACEFLIGHT_RULES.flightRounds + VICTORY_RULES.mars.suppliedRounds + 2;
  const spaceSupplyNeeded = !space?.activeMission && (!space?.colony || RESOURCE_IDS.some(resource => space.colony && space.colony.stock[resource] < ((VICTORY_RULES.mars.upkeep[resource] ?? 0) + (actor.marsProgress < SPACEFLIGHT_RULES.habitat.requiredWork ? (SPACEFLIGHT_RULES.habitat.costPerBeat as Partial<Resources>)[resource] ?? 0 : 0)) * supplyHorizon));
  const plan: ProgressionPlan = {
    coastalNeeded, coastalSites, coastalCities, researchGoals, spaceSupplyNeeded,
    researchNeeded: TECHNOLOGIES.some(technology => hasFeatures(state, technology.requiredFeatures) && !actor.technologies.includes(technology.id)),
    foundryCitiesNeeded: new Set(missingFoundries ? cities.filter(city => !witnessed.has(city.id)).map(city => city.id) : []),
    deposits: new Map((observedStrategicResources(state, actor.id).revealedDeposits ?? []).map(deposit => [deposit.tileId, deposit])),
    usefulRailEdges: new Set(), usefulRailTiles: new Set(), replaceableRoutes: new Set(), desiredBuildings: new Set(), desiredImprovements: new Set(),
    shortages: economyNeeds(state, actor, cities), cityById: new Map(cities.map(city => [city.id, city])),
  };
  planOperations(state, actor, cities, plan, profile);
  planTransport(state, actor, options, plan);
  return plan;
}

export function progressionWeight(option: ActionOption, base: number, state: WorldState, actor: Civilization, profile: BehaviorProfile, plan: ProgressionPlan): number {
  const action = option.action;
  const city = 'cityId' in action ? plan.cityById.get(action.cityId ?? '') : undefined;
  switch (action.type) {
    case 'research': return base * (plan.researchGoals.has(action.technology) ? 5 : 0.5);
    case 'build': {
      const building = buildingById.get(action.project); if (!building || !city) return base;
      if (building.id === 'launchpad') return plan.spaceSupplyNeeded && ![...plan.cityById.values()].some(town => town.buildings.includes('launchpad') || town.construction?.active && !('kind' in town.construction.active) && town.construction.active.buildingId === 'launchpad') ? Math.max(base, 250) * (city.buildings.includes('coal-plant') ? 2 : 1) * (city.population >= 13 ? 4 : 0.2) : base * 0.05;
      if (building.id === 'boat-yard') return plan.coastalNeeded && plan.coastalCities.has(city.id) ? Math.max(base, 160 * profile.priorities.expansion) : base * 0.05;
      if (building.id === 'foundry') return plan.foundryCitiesNeeded.has(city.id) && (actor.strategicResources?.iron ?? 0) > 0 ? Math.max(base, 160 * profile.priorities.construction) : base * 0.2;
      if (building.housing) return base * (city.population >= cityGrowthFacts(state, city).capacity - 2 ? 6 : 1);
      if (building.localPowerOutput) return base * ((plan.researchNeeded && city.buildings.includes('research-lab') || plan.spaceSupplyNeeded && city.buildings.includes('launchpad')) && (actor.strategicResources?.coal ?? 0) >= 4 ? 10 : 0.1);
      if (building.id === 'research-lab') return base * (plan.researchNeeded && city.population >= 10 ? 4 : 0.2);
      if (building.id === 'industrial-zone' && plan.foundryCitiesNeeded.has(city.id) && actor.technologies.includes('metal-casting')) return base * 8;
      if (building.district && action.tileId !== undefined && plan.deposits.has(action.tileId)) return base * 0.02;
      const productive = RESOURCE_IDS.reduce((sum, resource) => sum + (building.production[resource] ?? 0) * plan.shortages[resource], 0);
      if (paidRecipe(building)) {
        const capacity = city.population - RESIDENT_CAPACITY_RULES.communityReserve;
        const alreadyBetter = city.buildings.some(id => {
          const installed = buildingById.get(id);
          return installed && paidRecipe(installed) && RESOURCE_IDS.every(resource => (installed.production[resource] ?? 0) >= (building.production[resource] ?? 0));
        });
        if (capacity < RESIDENT_CAPACITY_RULES.perPaidRecipe || alreadyBetter) return base * 0.1;
      }
      return base * Math.max(0.3, productive / 6);
    }
    case 'improve': {
      const deposit = plan.deposits.get(action.tileId);
      return base * (action.improvementId === 'mine' && deposit && deposit.remaining > 0 ? 14 : 1);
    }
    case 'acquire-tile': {
      if (base <= 0) return 0;
      const deposit = plan.deposits.get(action.tileId);
      if (deposit && deposit.remaining > 0 && (actor.strategicResources?.[deposit.resource] ?? 0) < 8) return Math.max(base, 80);
      if (plan.usefulRailTiles.has(action.tileId)) return Math.max(base, 60);
      return base * (actor.resources.credits > 80 ? 0.5 : 0.05);
    }
    case 'build-rail': return plan.usefulRailEdges.has(railEdgeId(action.fromTileId, action.toTileId)) ? Math.max(base, 120) : base * 0.02;
    case 'settle': case 'settle-coast': {
      if (!base) return 0;
      if (plan.coastalNeeded && action.type === 'settle-coast') return base * 20;
      if (plan.coastalNeeded && plan.coastalCities.size === 0) return base * (plan.coastalSites.has(action.tileId) ? 20 : plan.cityById.size >= profile.settlementGoal - 1 ? 0.02 : 0.5);
      return base;
    }
    case 'set-building-operation': {
      const desired = plan.desiredBuildings.has(operationKey(action.cityId, action.buildingId));
      return desired === action.enabled ? 90 : 0;
    }
    case 'set-improvement-operation': {
      const desired = plan.desiredImprovements.has(improvementKey(action.cityId, action.tileId));
      return desired === action.enabled ? 70 : 0;
    }
    case 'stop-trade': return plan.replaceableRoutes.has(action.routeId) ? 140 : base;
    case 'propose-trade': {
      if (base <= 0) return 0;
      const quote = option.tradeQuote;
      if (action.transportMode === 'steam') {
        const recipe = TRADE_RECIPES.find(candidate => candidate.id === action.recipeId);
        if (!recipe || quote?.transport.mode !== 'steam' || !quote.transport.railEdges.length || quote.cadenceRounds >= quote.transport.unrailedCadence || !fundedSteam(actor, recipe.terms, quote.transport)) return 0;
        return base * 25;
      }
      return base;
    }
    case 'expedition': return base > 0 && plan.spaceSupplyNeeded ? Math.max(base, 300) : 0;
    case 'respond-trade': {
      const offer = state.tradeOffers?.find(candidate => candidate.id === action.offerId);
      return base * (action.accept && offer?.terms.transport?.mode === 'steam' ? 12 : 1);
    }
    case 'focus': {
      if (base <= 0) return 0;
      if (action.focus === 'research' && plan.researchNeeded) return base * 2;
      if (action.focus === 'diplomacy' && plan.shortages.credits > 1) return base * 3;
      return base;
    }
    default: return base;
  }
}

export function progressionOperationalPriority(option: ActionOption, plan: ProgressionPlan): boolean {
  const action = option.action;
  if (action.type === 'set-building-operation') return action.enabled === plan.desiredBuildings.has(operationKey(action.cityId, action.buildingId));
  if (action.type === 'set-improvement-operation') return action.enabled === plan.desiredImprovements.has(improvementKey(action.cityId, action.tileId));
  return false;
}

export function progressionTransportPriority(option: ActionOption, state: WorldState, plan: ProgressionPlan): boolean {
  if (state.industrialEvidence?.steamDelivery) return false;
  const action = option.action;
  if (action.type === 'stop-trade') return plan.replaceableRoutes.has(action.routeId);
  if (action.type === 'propose-trade') return action.transportMode === 'steam' && option.tradeQuote?.transport.mode === 'steam' && option.tradeQuote.transport.railEdges.length > 0 && option.tradeQuote.cadenceRounds < option.tradeQuote.transport.unrailedCadence;
  if (action.type === 'respond-trade') return action.accept && state.tradeOffers?.some(offer => offer.id === action.offerId && offer.terms.transport?.mode === 'steam' && offer.terms.transport.railEdges.length > 0 && offer.terms.cadenceRounds < offer.terms.transport.unrailedCadence) === true;
  return false;
}
