import { ECONOMY_RULES, RESOURCE_IDS, SETTLEMENT_SITE_OUTPUTS, TRADE_RECIPES } from './content.ts';
import { observe } from './engine.ts';
import { hasFeatures } from './simulation/history.ts';
import { siteProduction } from './simulation/sites.ts';
import type { City, GameAction, Observation, Resource, Resources, Terrain, TradeTerms, WorldState } from './types.ts';

export interface TradeTownFact {
  cityId: string;
  civId: number;
  name: string;
  tileId: number;
  terrain: Terrain;
  deposit: Resource | null;
  terrainOutputs: Partial<Resources>;
  depositOutputs: Partial<Resources>;
  baseOutputsBeforeFocusAndProductivity: Resources;
}

export interface TradeRecipeFact { id: string; name: string; description: string; terms: TradeTerms }

export interface TradeObservationFacts {
  cities: TradeTownFact[];
  recipes: TradeRecipeFact[];
  semantics: { distance: string; stockScope: string; proposal: string; construction: string; production: string; terms: string };
}

export interface CompactTradeObservation extends Observation {
  observationFormat: 'compact-trade-v1';
  tradeFacts: TradeObservationFacts;
}

function resourceVector(value: Partial<Resources>): Partial<Resources> {
  const result: Partial<Resources> = {};
  for (const resource of RESOURCE_IDS) if (value[resource] !== undefined) result[resource] = value[resource];
  return result;
}

export function observeCompactTrade(state: WorldState, seat: number, timestamp?: string): CompactTradeObservation {
  const observation = observe(state, seat, timestamp, 'compact-trade-v1');
  const cities = new Map(state.cities.map(city => [city.id, city]));
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const referencedCities = new Set<string>();
  const referencedRecipes = new Set<string>();
  const offers = new Map((observation.tradeOffers ?? []).map(offer => [offer.id, offer]));
  const routes = new Map(observation.routes.map(route => [route.id, route]));
  const exact = hasFeatures(state, ['exact-trade-endpoints']);
  const endpoints = (action: Extract<GameAction, { type: 'propose-trade' }>): [City | undefined, City | undefined] => exact
    ? [action.sourceCityId === undefined ? undefined : cities.get(action.sourceCityId), action.recipientCityId === undefined ? undefined : cities.get(action.recipientCityId)]
    : [state.cities.find(city => city.civId === seat), state.cities.find(city => city.civId === action.partner)];
  const referencePair = (from: string, to: string): void => { referencedCities.add(from); referencedCities.add(to); };
  const referenceAction = (action: GameAction): void => {
    if (action.type === 'propose-trade') {
      const [from, to] = endpoints(action);
      if (from) referencedCities.add(from.id);
      if (to) referencedCities.add(to.id);
      referencedRecipes.add(action.recipeId);
    } else if (action.type === 'respond-trade' || action.type === 'withdraw-trade') {
      const offer = offers.get(action.offerId);
      if (offer) referencePair(offer.from, offer.to);
    } else if (action.type === 'stop-trade') {
      const route = routes.get(action.routeId);
      if (route) referencePair(route.from, route.to);
    }
  };
  for (const offer of offers.values()) referencePair(offer.from, offer.to);
  for (const route of routes.values()) referencePair(route.from, route.to);
  for (const item of observation.actionPlan?.items ?? []) referenceAction(item.action);
  for (const option of observation.legalActions) referenceAction(option.action);
  const townFacts: TradeTownFact[] = [];
  for (const id of [...referencedCities].toSorted()) {
    const city = cities.get(id);
    const tile = city ? tiles.get(city.tileId) : undefined;
    if (!city || !tile) continue;
    const outputs = siteProduction(state, tile);
    const terrainOutputs = resourceVector(hasFeatures(state, ['terrain-production']) ? SETTLEMENT_SITE_OUTPUTS[tile.terrain] ?? {} : {});
    const depositOutputs: Partial<Resources> = {};
    for (const resource of RESOURCE_IDS) {
      const amount = (outputs[resource] ?? 0) - (terrainOutputs[resource] ?? 0);
      if (amount !== 0) depositOutputs[resource] = amount;
    }
    const base = { ...ECONOMY_RULES.baseProduction };
    for (const resource of RESOURCE_IDS) base[resource] += outputs[resource] ?? 0;
    townFacts.push({
      cityId: city.id, civId: city.civId, name: city.name, tileId: tile.id, terrain: tile.terrain, deposit: tile.resource,
      terrainOutputs,
      depositOutputs,
      baseOutputsBeforeFocusAndProductivity: base,
    });
  }
  const recipes = TRADE_RECIPES.filter(recipe => referencedRecipes.has(recipe.id) && hasFeatures(state, recipe.requiredFeatures))
    .map(recipe => {
      const terms = structuredClone(recipe.terms);
      for (const key of ['constructionCost', 'proposerCargo', 'recipientCargo', 'proposerUpkeep', 'recipientUpkeep', 'proposerYield', 'recipientYield'] as const) terms[key] = resourceVector(terms[key]);
      return { id: recipe.id, name: recipe.name, description: recipe.description, terms };
    })
    .toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    ...observation,
    observationFormat: 'compact-trade-v1',
    tradeFacts: {
      cities: townFacts,
      recipes,
      semantics: {
        distance: hasFeatures(state, ['industrial-steam']) ? 'Land and explicit steam offers retain exact ordered paths and acceptance-relative cadence. Steam retains edge weights, completed Rail references, an unrailed cadence baseline and one proposer Coal per successful due exchange; current recipe facts do not replace accepted terms' : hasFeatures(state, ['land-transport']) ? 'Land offers quote their exact ordered path and acceptance-relative exchange cadence; straight-line distance is a separate geometric fact' : 'Straight-line hex distance, not a traversed path or travel time',
        stockScope: 'Supplies remain shared across each civilization',
        proposal: 'No payment or shipment; recipient consent required',
        construction: 'Proposer pays construction once at acceptance',
        production: 'Base outputs precede focus, productivity, buildings and upkeep; not net stock change',
        terms: 'Recipe facts describe current proposals; tradeOffers and route agreements retain authoritative snapshotted terms',
      },
    },
  };
}
