import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS, TECHNOLOGIES } from '../content.ts';
import type { City, GameEvent, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { canAfford, citiesOf, civilizationById, clamp, transferCost } from './world.ts';

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
  const productivity =
    (0.5 + city.wellbeing / 100) * (1 - city.damage / 100) * (1 + city.infrastructure / 10);
  const produced = { food: 0, science: 0, culture: 0 };
  for (const resource of RESOURCE_IDS) {
    const buildings = city.buildings.reduce(
      (total, id) =>
        total + (BUILDINGS.find((building) => building.id === id)?.production[resource] ?? 0),
      0,
    );
    const terrain = site?.resource === resource ? 1 : 0;
    const amount = quantize(
      ((ECONOMY_RULES.baseProduction[resource] ?? 0) +
        (focus[resource] ?? 0) +
        buildings +
        terrain) *
        productivity,
    );
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

function resolveRoutes(state: WorldState, events: GameEvent[]): void {
  for (const route of state.routes) {
    const owner = civilizationById(state, route.owner);
    const partner = civilizationById(state, route.partner);
    const endpointsExist =
      state.cities.some((city) => city.id === route.from && city.civId === owner.id) &&
      state.cities.some((city) => city.id === route.to && city.civId === partner.id);
    const active =
      endpointsExist &&
      route.damage < ECONOMY_RULES.trade.damageDisableAt &&
      canAfford(owner.resources, ECONOMY_RULES.trade.ownerCargo) &&
      canAfford(partner.resources, ECONOMY_RULES.trade.partnerCargo) &&
      canAfford(owner.resources, ECONOMY_RULES.trade.upkeep) &&
      canAfford(partner.resources, ECONOMY_RULES.trade.upkeep);
    route.active = active;
    route.volume = 0;
    if (!active) continue;
    transferCost(owner.resources, ECONOMY_RULES.trade.upkeep);
    transferCost(partner.resources, ECONOMY_RULES.trade.upkeep);
    transferCost(owner.resources, ECONOMY_RULES.trade.ownerCargo);
    transferCost(partner.resources, ECONOMY_RULES.trade.partnerCargo);
    transferCost(partner.resources, ECONOMY_RULES.trade.ownerCargo, 1);
    transferCost(owner.resources, ECONOMY_RULES.trade.partnerCargo, 1);
    transferCost(owner.resources, ECONOMY_RULES.trade.commerceYield, 1);
    transferCost(partner.resources, ECONOMY_RULES.trade.commerceYield, 1);
    const ownerCargo: Partial<Resources> = ECONOMY_RULES.trade.ownerCargo;
    const partnerCargo: Partial<Resources> = ECONOMY_RULES.trade.partnerCargo;
    route.volume = RESOURCE_IDS.reduce(
      (total, resource) => total + (ownerCargo[resource] ?? 0) + (partnerCargo[resource] ?? 0),
      0,
    );
    emitEvent(state, events, {
      type: 'trade-delivered',
      title: `${owner.name} and ${partner.name} exchange cargo`,
      detail: 'Both route endpoints supplied real goods and paid transport upkeep',
      actor: owner.id,
      target: partner.id,
      tileId: state.cities.find((city) => city.id === route.to)?.tileId ?? null,
      cause: `Route ${route.id} was intact and both partners could supply cargo and energy`,
      effects: [
        `${route.volume} cargo exchanged`,
        'Commerce income credited to both partners',
        'Transport energy consumed at both endpoints',
      ],
      importance: 2,
    });
  }
}

function resolveResearch(state: WorldState, civilizationId: number, events: GameEvent[]): void {
  const civilization = civilizationById(state, civilizationId);
  const technology = TECHNOLOGIES.find((candidate) => candidate.id === civilization.researchTarget);
  if (!technology) return;
  const invested = Math.min(
    civilization.resources.science,
    Math.max(0, technology.cost - civilization.researchProgress),
  );
  civilization.resources.science = quantize(civilization.resources.science - invested);
  civilization.researchProgress = quantize(civilization.researchProgress + invested);
  if (civilization.researchProgress < technology.cost) return;
  civilization.technologies.push(technology.id);
  civilization.researchTarget = '';
  civilization.researchProgress = 0;
  emitEvent(state, events, {
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
}

export function resolveEconomy(state: WorldState, events: GameEvent[]): void {
  for (const civilization of state.civilizations) {
    let culture = 0;
    let science = 0;
    let food = 0;
    let suppliedCities = 0;
    const cities = citiesOf(state, civilization.id);
    for (const city of cities) {
      const production = produceCity(state, city);
      culture += production.culture;
      science += production.science;
      food += production.food;
      if (supplyCity(state, city, events)) suppliedCities += 1;
    }
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
  resolveRoutes(state, events);
  for (const civilization of state.civilizations) resolveResearch(state, civilization.id, events);
}
