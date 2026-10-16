import { ECONOMY_RULES, RESEARCH_INVESTMENT_RULES, RESOURCE_IDS, TECHNOLOGIES } from '../content.ts';
import type { City, GameEvent, Resources, WorldState } from '../types.ts';
import { siteProduction } from './sites.ts';
import { emitEvent } from './events.ts';
import { citiesOf, civilizationById, cityProductivity, clamp } from './world.ts';
import { allocateOperations, emitOperations, paidRecipe, productiveBuildings } from './operations.ts';
import { resolvePublicProjects } from './public-projects.ts';
import { resolveTrade } from './trade.ts';
import { openingConstructionWork, resolveConstruction } from './construction.ts';
import { hasFeatures } from './history.ts';

function quantize(value: number): number {
  return Math.round(value * 100) / 100;
}

function produceCity(
  state: WorldState,
  city: City,
): { food: number; science: number; culture: number } {
  const civilization = civilizationById(state, city.civId);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
  const site = state.tiles.find((tile) => tile.id === city.tileId);
  const productivity = cityProductivity(city);
  const siteOutputs = site ? siteProduction(state, site) : {};
  const produced = { food: 0, science: 0, culture: 0 };
  const buildings = productiveBuildings(state, city);
  const free = buildings.filter((building) => !paidRecipe(building));
  const paid = buildings.filter(paidRecipe);
  for (const resource of RESOURCE_IDS) {
    const terrain = siteOutputs[resource] ?? 0;
    let raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (focus[resource] ?? 0)
      + free.reduce((total, building) => total + (building.production[resource] ?? 0), 0) + terrain;
    let amount = quantize(raw * productivity);
    for (const building of paid) {
      raw += building.production[resource] ?? 0;
      const next = quantize(raw * productivity);
      const result = city.buildingOperations?.[building.id]?.lastResult;
      const contribution = quantize(next - amount);
      if (result?.status === 'operated' && contribution > 0) result.produced[resource] = contribution;
      amount = next;
    }
    civilization.resources[resource] = quantize(
      clamp(civilization.resources[resource] + amount, 0),
    );
    if (resource === 'food' || resource === 'science' || resource === 'culture')
      produced[resource] = amount;
  }
  return produced;
}

function supplyCity(state: WorldState, city: City, events: GameEvent[]): boolean {
  const civilization = civilizationById(state, city.civId);
  const upkeep = quantize(city.population * ECONOMY_RULES.populationFoodUpkeep);
  const supplied = civilization.resources.food >= upkeep;
  if (supplied) {
    civilization.resources.food = quantize(civilization.resources.food - upkeep);
    city.wellbeing = clamp(city.wellbeing + ECONOMY_RULES.suppliedWellbeingGain, 0, 100);
    if (
      city.population < ECONOMY_RULES.growth.cityPopulationCap &&
      city.wellbeing >= ECONOMY_RULES.growth.wellbeing &&
      civilization.resources.food >=
        ECONOMY_RULES.growth.foodReserve + ECONOMY_RULES.growth.foodCost
    ) {
      civilization.resources.food = quantize(
        civilization.resources.food - ECONOMY_RULES.growth.foodCost,
      );
      city.population += ECONOMY_RULES.growth.populationGain;
      emitEvent(state, events, {
        type: 'population-growth',
        title: `${city.name} grows`,
        detail: 'A supplied settlement invested its food reserve in new households',
        actor: city.civId,
        target: city.civId,
        tileId: city.tileId,
        cause: `Wellbeing ${city.wellbeing} and a food surplus met growth requirements`,
        effects: [
          `Population +${ECONOMY_RULES.growth.populationGain}`,
          `Food -${ECONOMY_RULES.growth.foodCost}`,
        ],
        importance: 2,
      });
    }
    return true;
  }
  civilization.resources.food = 0;
  city.wellbeing = clamp(city.wellbeing - ECONOMY_RULES.shortageWellbeingLoss, 0, 100);
  civilization.legitimacy = clamp(
    civilization.legitimacy - ECONOMY_RULES.shortageLegitimacyLoss,
    0,
    100,
  );
  const lostPopulation =
    city.wellbeing <= ECONOMY_RULES.starvationWellbeing && city.population > 1
      ? Math.min(city.population - 1, ECONOMY_RULES.starvationPopulationLoss)
      : 0;
  city.population -= lostPopulation;
  emitEvent(state, events, {
    type: 'supply-shortage',
    title: `${city.name} faces a food shortage`,
    detail: 'Available food did not cover settlement upkeep',
    actor: city.civId,
    target: city.civId,
    tileId: city.tileId,
    cause: `${upkeep} food was required by the settlement population`,
    effects: [
      `Wellbeing -${ECONOMY_RULES.shortageWellbeingLoss}`,
      `Legitimacy -${ECONOMY_RULES.shortageLegitimacyLoss}`,
      `Population -${lostPopulation}`,
    ],
    importance: 3,
  });
  return false;
}

function resolveResearch(state: WorldState, civilizationId: number, producedScience: number, events: GameEvent[]): void {
  const civilization = civilizationById(state, civilizationId);
  const technology = TECHNOLOGIES.find((candidate) => candidate.id === civilization.researchTarget);
  if (!technology) return;
  const invested = Math.min(
    hasFeatures(state, [RESEARCH_INVESTMENT_RULES.featureId]) ? producedScience : Infinity,
    civilization.resources.science,
    Math.max(0, technology.cost - civilization.researchProgress),
  );
  civilization.resources.science = quantize(civilization.resources.science - invested);
  civilization.researchProgress = quantize(civilization.researchProgress + invested);
  if (civilization.researchProgress < technology.cost) return;
  civilization.technologies.push(technology.id);
  civilization.researchTarget = '';
  civilization.researchProgress = 0;
  const completed = emitEvent(state, events, {
    type: 'research-completed',
    title: `${civilization.name} discovers ${technology.name}`,
    detail: technology.capability,
    actor: civilizationId,
    target: civilizationId,
    tileId: citiesOf(state, civilizationId)[0]?.tileId ?? null,
    cause: `Working settlements supplied ${technology.cost} science to the research program`,
    effects: [
      `Technology ${technology.id} unlocked`,
      'Capability stages require released milestones; the world clock is independent',
    ],
    importance: 4,
  });
  if (hasFeatures(state, ['recurring-decisions'])) civilization.lastResearchCompletion = { technologyId: technology.id, completedRound: state.round, eventId: completed.id };
}

export function resolveEconomy(state: WorldState, events: GameEvent[]): void {
  const openingWork = openingConstructionWork(state);
  const researchBudgets = new Map<number, number>();
  allocateOperations(state);
  for (const civilization of state.civilizations) {
    let culture = 0;
    let science = 0;
    let food = 0;
    let suppliedCities = 0;
    const cities = citiesOf(state, civilization.id);
    for (const city of cities) {
      const production = produceCity(state, city);
      emitOperations(state, city, events);
      culture += production.culture;
      science += production.science;
      food += production.food;
      if (supplyCity(state, city, events)) suppliedCities += 1;
    }
    researchBudgets.set(civilization.id, quantize(science));
    civilization.influence = quantize(clamp(civilization.influence + culture, 0));
    if (suppliedCities === cities.length)
      civilization.legitimacy = quantize(clamp(civilization.legitimacy + culture / 20, 0, 100));
    civilization.score = Math.floor(
      civilization.influence +
        cities.reduce((total, city) => total + city.population * 5 + city.infrastructure * 2, 0) +
        civilization.technologies.length * 10,
    );
    emitEvent(state, events, {
      type: 'settlement-production',
      title: `${civilization.name} completes a working season`,
      detail: `${suppliedCities} of ${cities.length} settlements met food upkeep`,
      actor: civilization.id,
      target: civilization.id,
      tileId: cities[0]?.tileId ?? null,
      cause:
        'Population wellbeing, terrain, focus and actual constructed buildings determined production',
      effects: [
        `Produced ${quantize(food)} food`,
        `Produced ${quantize(science)} science`,
        `Produced ${quantize(culture)} culture`,
      ],
      importance: 1,
    });
  }
  resolveTrade(state, events);
  resolvePublicProjects(state, events);
  for (const civilization of state.civilizations) resolveResearch(state, civilization.id, researchBudgets.get(civilization.id) ?? 0, events);
  resolveConstruction(state, openingWork, events);
}
