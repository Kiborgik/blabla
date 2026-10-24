import { borderFieldPopulation, resolveBorderIncidents } from './border-incidents.ts';
import { resolveKnowledgeCompacts } from './knowledge-compacts.ts';
import { resolveReliefCharters } from './relief-charters.ts';
import { resolveSpaceflight } from './spaceflight.ts';
import { recordLocalPower } from './local-power.ts';
import { recordIndustrialFoundry } from './industrial-evidence.ts';
import { resolveGovernmentTransitions } from './government.ts';
import { resolveCivics } from './civics.ts';
import { completeResearch } from './research.ts';
import { emitImprovements } from './improvements.ts';
import { RESEARCH_INVESTMENT_RULES, TECHNOLOGIES } from '../content.ts';
import { produceCity, supplyCity } from './city-production-supply.ts';
import type { GameEvent, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { citiesOf, civilizationById, clamp } from './world.ts';
import { allocateOperations, emitOperations } from './operations.ts';
import { resolvePublicProjects } from './public-projects.ts';
import { resolveTrade } from './trade.ts';
import { openingConstructionWork, resolveConstruction } from './construction.ts';
import { hasFeatures } from './history.ts';
import { extractCityMetals } from './metals.ts';
import { prepareWoodlandBeat, recordWoodlands } from './woodlands.ts';
import { recordRiverFlow } from './river-intakes.ts';

function quantize(value: number): number {
  return Math.round(value * 100) / 100;
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
  completeResearch(state, civilizationId, technology, events);
}

export function resolveEconomy(state: WorldState, events: GameEvent[]): void {
  const woodlandPlan = prepareWoodlandBeat(state);
  const openingWork = openingConstructionWork(state);
  const researchBudgets = new Map<number, number>();
  const civicBudgets = new Map<number, number>();
  const riverFlowPlan = allocateOperations(state, woodlandPlan);
  for (const city of state.cities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) extractCityMetals(state, city);
  for (const civilization of state.civilizations) {
    let culture = 0;
    let science = 0;
    let food = 0;
    let suppliedCities = 0;
    const cities = citiesOf(state, civilization.id);
    for (const city of cities) {
      const foodBefore = civilization.resources.food;
      const production = produceCity(state, city);
      emitOperations(state, city, events);
      recordLocalPower(state, city, events);
      recordIndustrialFoundry(state, city, events);
      emitImprovements(state, city, events);
      culture += production.culture;
      science += production.science;
      food += production.food;
      if (supplyCity(state, city, events, production.food, foodBefore)) suppliedCities += 1;
    }
    researchBudgets.set(civilization.id, quantize(science));
    civicBudgets.set(civilization.id, quantize(culture));
    civilization.influence = quantize(clamp(civilization.influence + culture, 0));
    if (suppliedCities === cities.length)
      civilization.legitimacy = quantize(clamp(civilization.legitimacy + culture / 20, 0, 100));

    civilization.score = Math.floor(civilization.influence
      + cities.reduce((total, city) => total + city.population * 5 + city.infrastructure * 2, 0)
      + borderFieldPopulation(state, civilization.id) * 5 + civilization.technologies.length * 10);
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
  recordWoodlands(state, woodlandPlan, events);
  recordRiverFlow(state, riverFlowPlan, events);
  resolveTrade(state, events);
  resolvePublicProjects(state, events);
  resolveReliefCharters(state, events);
  for (const civilization of state.civilizations) resolveResearch(state, civilization.id, researchBudgets.get(civilization.id) ?? 0, events);
  resolveKnowledgeCompacts(state, events);
  for (const civilization of state.civilizations) resolveCivics(state, civilization.id, civicBudgets.get(civilization.id) ?? 0, events);
  resolveConstruction(state, openingWork, events);
  resolveGovernmentTransitions(state, events);
  resolveBorderIncidents(state, events);
  if (state.border) for (const civilization of state.civilizations) civilization.score = Math.floor(civilization.influence
    + state.cities.filter(city => city.civId === civilization.id).reduce((total, city) => total + city.population * 5 + city.infrastructure * 2, 0)
    + borderFieldPopulation(state, civilization.id) * 5 + civilization.technologies.length * 10);
  resolveSpaceflight(state, events);
}
