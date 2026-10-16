import { CIV_COUNT } from './types.ts';
import type {
  BuildingDefinition, CivilizationDefinition, DirectorEventDefinition, EffectDefinition,
  EraDefinition, FeatureDefinition, Focus, GameAction, HistoricalMilestone, Resource,
  Resources, TechnologyDefinition, TradeRecipe,
} from './types.ts';

export const RESOURCE_IDS: readonly Resource[] = ['food', 'materials', 'energy', 'credits', 'science', 'culture'];
export const FOCUS_IDS: readonly Focus[] = ['growth', 'industry', 'research', 'culture', 'diplomacy'];
export const DIRECTOR_CLOCK_RULES = { intervalMs: 360000, yearsPerTick: 10, majorEveryTicks: 10, maxCatchUpTicks: 240, eventAdvanceYears: 0, reviewAdvanceYears: 0 };

export const CIVILIZATIONS: CivilizationDefinition[] = [
  { name: 'Aster', adjective: 'Asterian', color: '#78baff', capital: 'Dawnwell', focus: 'research', objective: 'Discover what the world can become.' },
  { name: 'Verdant', adjective: 'Verdant', color: '#8edc9d', capital: 'Willowmere', focus: 'growth', objective: 'Build places where people choose to flourish.' },
  { name: 'Ember', adjective: 'Ember', color: '#ff996b', capital: 'Cinderhold', focus: 'industry', objective: 'Turn scarce materials into lasting power.' },
  { name: 'Pelagos', adjective: 'Pelagian', color: '#68d9d3', capital: 'Tidehaven', focus: 'diplomacy', objective: 'Make cooperation worth more than isolation.' },
  { name: 'Vesper', adjective: 'Vesperian', color: '#cea2ed', capital: 'Lumen', focus: 'culture', objective: 'Give people a shared story worth joining.' },
];

export const FEATURES: FeatureDefinition[] = [
  { id: 'settlement-turns', name: 'Five civilizations awaken', description: 'Five civilization actors and one World Director inhabit a shared, revisioned world.' },
  { id: 'settlement-production', name: 'Working settlements', description: 'Food, materials, city focus and buildings sustain actual populations.' },
  { id: 'settlement-research', name: 'First discoveries', description: 'Civilizations invest their knowledge in released discoveries.' },
  { id: 'director-events', name: 'A changing world', description: 'The World Director introduces real environmental pressures and opportunities.' },
  { id: 'history-advancement', name: 'Turning points in history', description: 'Deliberate, explained historical advances move the calendar once without changing the regular clock or unlocking unfinished capabilities.' },
  { id: 'release-evolution', name: 'A world that keeps growing', description: 'Compatible delivered releases enter the inhabited world once while preserving its state, identity and history.' },
  { id: 'independent-actions', name: 'Civilizations act together', description: 'Independent fair tactical windows and shared strategic beats let each civilization act without waiting for another actor.' },
  { id: 'bounded-plans', name: 'The next useful step', description: 'At most two explicit actionable intentions guide real agent decisions and retain concrete lifecycle results without automatic execution.' },
  { id: 'settlement-expansion', name: 'Beyond the first hearth', description: 'New settlements make land, migration and supply consequential.' },
  { id: 'trade-routes', name: 'Roads between peoples', description: 'Routes exchange scarce goods and can be disrupted and repaired.' },
  { id: 'statecraft', name: 'Institutions and belonging', description: 'Public institutions connect knowledge, culture, welfare and political cooperation.' },
  { id: 'navigation', name: 'A connected world', description: 'Navigation expands the reach of exchange, exploration and influence.' },
  { id: 'industrialization', name: 'Power and production', description: 'Energy, mass production and their social consequences reshape cities.' },
  { id: 'planetary-networks', name: 'A planetary civilization', description: 'Communications and global dependencies connect distant decisions.' },
  { id: 'interplanetary-logistics', name: 'Beyond Earth', description: 'Launch infrastructure and sustained supply make other worlds habitable.' },
  { id: 'federations', name: 'Shared political futures', description: 'Negotiated commitments and delivered public goods can sustain a federation.' },
  { id: 'cultural-networks', name: 'Influence without conquest', description: 'Attractive institutions spread voluntary cultural affiliation.' },
  { id: 'resilient-markets', name: 'An economic world order', description: 'Independent partners depend on contestable, resilient productive networks.' },
  { id: 'supplied-conflict', name: 'Power with consequences', description: 'Armies, occupation and reconstruction compete for the world’s resources.' },
  { id: 'disaster-recovery', name: 'Rupture and rebuilding', description: 'Damage creates reconstruction, relief and transport decisions.' },
  { id: 'anomalous-contact', name: 'We are not alone', description: 'Unexpected contact creates scientific opportunities and social disagreement.' },
  { id: 'speculative-markets', name: 'Manias and markets', description: 'Speculative wealth changes investment opportunities and political risk.' },
];

export const ACTION_FEATURES: Record<GameAction['type'], readonly string[]> = {
  focus: ['settlement-production'], research: ['settlement-research'], build: ['settlement-production'],
  settle: ['settlement-expansion'], trade: ['trade-routes'], federate: ['federations'],
  'propose-trade': ['trade-routes'], 'respond-trade': ['trade-routes'], 'withdraw-trade': ['trade-routes'], 'stop-trade': ['trade-routes'],
  repair: ['trade-routes'], expedition: ['interplanetary-logistics'], event: ['director-events'],
  wait: ['settlement-turns'],
};

export const TECHNOLOGIES: TechnologyDefinition[] = [
  { id: 'agriculture', name: 'Cultivation', requiredFeatures: ['settlement-research'], era: 0, cost: 10, requires: [], capability: 'Cultivation supports farms, workshops and more reliable settlements.' },
  { id: 'civic-institutions', name: 'Civic institutions', requiredFeatures: ['statecraft'], era: 1, cost: 24, requires: ['agriculture'], capability: 'Public institutions connect learning, belonging and durable cooperation.' },
  { id: 'navigation', name: 'Navigation', requiredFeatures: ['navigation'], era: 2, cost: 42, requires: ['civic-institutions'], capability: 'Navigation extends the reach of trade and cultural contact.' },
  { id: 'industrialization', name: 'Industrialization', requiredFeatures: ['industrialization'], era: 3, cost: 66, requires: ['navigation'], capability: 'Energy and mechanization change production, transport and urban life.' },
  { id: 'computing', name: 'Planetary computing', requiredFeatures: ['planetary-networks'], era: 4, cost: 100, requires: ['industrialization'], capability: 'Information networks connect markets and political projects across the planet.' },
  { id: 'spaceflight', name: 'Interplanetary logistics', requiredFeatures: ['interplanetary-logistics'], era: 5, cost: 144, requires: ['computing'], capability: 'Launch infrastructure and life-support supply make off-world settlements possible.' },
];

const ERA_PRESENTATION: Array<Pick<EraDefinition, 'id' | 'name' | 'year' | 'technology'>> = [
  { id: 'settlement', name: 'The First Hearths', year: -10000, technology: 'agriculture' },
  { id: 'states', name: 'Cities and States', year: -3000, technology: 'civic-institutions' },
  { id: 'connected', name: 'A Connected World', year: -500, technology: 'navigation' },
  { id: 'industrial', name: 'The Industrial Age', year: 1750, technology: 'industrialization' },
  { id: 'planetary', name: 'The Planetary Age', year: 2000, technology: 'computing' },
  { id: 'interplanetary', name: 'Beyond Earth', year: 2150, technology: 'spaceflight' },
];

export const ERAS: EraDefinition[] = ERA_PRESENTATION.map(era => {
  const technology = TECHNOLOGIES.find(item => item.id === era.technology);
  if (!technology) throw new Error(`Era ${era.id} has no discovery`);
  return { ...era, cost: technology.cost, capability: technology.capability };
});

export const BUILDINGS: BuildingDefinition[] = [
  { id: 'farm', name: 'Terraced fields', requiredFeatures: ['settlement-production'], minEra: 0, cost: { materials: 8, credits: 4 }, requires: ['agriculture'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }, { kind: 'city', field: 'wellbeing', amount: 4 }], production: { food: 4 }, description: 'Reliable harvests sustain people and leave a surplus for future growth.' },
  { id: 'workshop', name: 'Artisan quarter', requiredFeatures: ['settlement-production'], minEra: 0, cost: { materials: 12, credits: 8 }, requires: ['agriculture'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }], production: { materials: 3, energy: 1 }, description: 'Specialized work supplies the materials other projects need.' },
  { id: 'academy', name: 'House of learning', requiredFeatures: ['statecraft'], minEra: 1, cost: { materials: 16, credits: 10 }, requires: ['civic-institutions'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }], production: { science: 3, culture: 1 }, description: 'Shared learning supports discoveries and cultural exchange.' },
  { id: 'monument', name: 'Civic gathering place', requiredFeatures: ['statecraft'], minEra: 1, cost: { materials: 12, credits: 8 }, requires: ['civic-institutions'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }, { kind: 'civilization', field: 'legitimacy', amount: 4 }], production: { culture: 4 }, description: 'A public place makes collective identity and political commitments visible.' },
  { id: 'launchpad', name: 'Orbital gateway', requiredFeatures: ['interplanetary-logistics'], minEra: 5, cost: { materials: 40, energy: 24, credits: 30 }, requires: ['spaceflight'], effects: [{ kind: 'city', field: 'infrastructure', amount: 2 }], production: {}, description: 'Launch infrastructure connects Earth’s industry to an off-world supply line.' },
];

export const DIRECTOR_EVENTS: DirectorEventDefinition[] = [
  { id: 'drought', name: 'The rains fail', requiredFeatures: ['director-events'], minEra: 0, description: 'A dry season threatens a civilization’s food reserves.', consequence: 'Food scarcity tests growth choices and the wellbeing of settlements.', effects: [{ kind: 'resource', resource: 'food', amount: -12 }, { kind: 'city', field: 'wellbeing', amount: -10 }], cooldown: 2 },
  { id: 'earthquake', name: 'The earth moves', requiredFeatures: ['director-events', 'disaster-recovery'], minEra: 0, description: 'A fault ruptures beneath settled land.', consequence: 'Damaged buildings and routes create a need for reconstruction and relief.', effects: [{ kind: 'city', field: 'damage', amount: 35 }, { kind: 'city', field: 'infrastructure', amount: -1 }, { kind: 'route', field: 'damage', amount: 25 }], cooldown: 3 },
  { id: 'resource-boom', name: 'A rich seam', requiredFeatures: ['director-events'], minEra: 0, description: 'A newly exposed deposit creates an unexpected opportunity.', consequence: 'Materials and energy can support growth or a new strategic investment.', effects: [{ kind: 'resource', resource: 'materials', amount: 18 }, { kind: 'resource', resource: 'energy', amount: 8 }, { kind: 'civilization', field: 'legitimacy', amount: 3 }], cooldown: 2 },
  { id: 'crypto-boom', name: 'A speculative fever', requiredFeatures: ['director-events', 'speculative-markets'], minEra: 4, description: 'A digital-asset mania draws wealth and attention.', consequence: 'New liquidity comes with political discontent and diverted investment.', effects: [{ kind: 'resource', resource: 'credits', amount: 28 }, { kind: 'resource', resource: 'materials', amount: -5 }, { kind: 'civilization', field: 'legitimacy', amount: -8 }], cooldown: 3 },
  { id: 'ufo-contact', name: 'Visitors in the sky', requiredFeatures: ['director-events', 'anomalous-contact'], minEra: 0, description: 'An unexplained encounter challenges what people believe.', consequence: 'A scientific opportunity arrives alongside cultural fascination and disagreement.', effects: [{ kind: 'resource', resource: 'science', amount: 24 }, { kind: 'resource', resource: 'culture', amount: 8 }, { kind: 'civilization', field: 'legitimacy', amount: -6 }], cooldown: 4 },
  { id: 'calm', name: 'A quiet season', requiredFeatures: ['director-events'], minEra: 0, description: 'The world gives civilizations room to act.', consequence: 'Existing projects and pressures unfold without a new shock.', effects: [], cooldown: 0 },
];

const initialEra = ERAS[0];
if (!initialEra) throw new Error('The world requires a starting era');

export const ECONOMY_RULES = {
  initialYear: initialEra.year,
  initialResources: { food: 30, materials: 24, energy: 12, credits: 20, science: 0, culture: 0 } satisfies Resources,
  initialCity: { population: 6, wellbeing: 65, infrastructure: 1, damage: 0 },
  initialLegitimacy: 60,
  baseProduction: { food: 4, materials: 2, energy: 1, credits: 2, science: 1, culture: 1 } satisfies Resources,
  focusProduction: {
    growth: { food: 3 }, industry: { materials: 3, energy: 1 }, research: { science: 3 },
    culture: { culture: 3 }, diplomacy: { credits: 2, culture: 1 },
  } satisfies Record<Focus, Partial<Resources>>,
  populationFoodUpkeep: 0.5, suppliedWellbeingGain: 1, shortageWellbeingLoss: 8,
  shortageLegitimacyLoss: 2, starvationWellbeing: 20, starvationPopulationLoss: 1,
  growth: { foodReserve: 10, foodCost: 6, wellbeing: 60, populationGain: 1, cityPopulationCap: 20 },
  settle: { cost: { food: 10, materials: 12, credits: 8 }, population: 3 },
  trade: { cost: { materials: 6, credits: 8 }, ownerCargo: { food: 2 }, partnerCargo: { materials: 2 }, commerceYield: { credits: 2 }, upkeep: { energy: 1 }, damageDisableAt: 50 },
  repair: { cost: { materials: 5, energy: 2 }, damageReduction: 25 },
  expedition: { cost: { food: 5, materials: 8, energy: 8, credits: 6 }, progress: 25, population: 1 },
};

export const TRADE_RULES = { offerExpiryRounds: 8, maxPendingPerPair: 1, maxActivePerPair: 1 };

export const TRADE_RECIPES: TradeRecipe[] = [
  { id: 'harvest-for-materials', version: 1, name: 'Harvest for materials', description: 'A food surplus supports a partner while materials return to build the next settlement project.', requiredFeatures: ['trade-routes'], terms: { recipeId: 'harvest-for-materials', recipeVersion: 1, constructionCost: { materials: 6, credits: 8 }, proposerCargo: { food: 4 }, recipientCargo: { materials: 3 }, proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 1 }, proposerYield: { credits: 2 }, recipientYield: { credits: 2 }, cadenceRounds: 4, damageDisableAt: 50 } },
];

export const VICTORY_RULES = {
  mars: { requiredFeatures: ['interplanetary-logistics'], minEra: 5, requiredTechnology: 'spaceflight', requiredBuilding: 'launchpad', progress: 100, population: 3, suppliedRounds: 3, upkeep: { food: 3, materials: 1, energy: 4 } as Partial<Resources> },
  federation: { requiredFeatures: ['federations', 'planetary-networks'], minEra: 4, members: 3, infrastructurePerMember: 4, wellbeing: 60, legitimacy: 55, suppliedRounds: 4, upkeep: { food: 2, energy: 2 } as Partial<Resources> },
};

export const HISTORICAL_MILESTONES: HistoricalMilestone[] = [
  { id: 'first-harvest', name: 'The first reliable harvest', requiredFeatures: ['settlement-production', 'settlement-research'], requiresMilestones: [], conditions: [{ kind: 'building-count', building: 'farm', minimum: 1 }, { kind: 'technology', technology: 'agriculture', civilizations: 1 }], year: -9500, era: 0, explanation: 'Cultivation and working fields have changed how people live. The released settlement systems have produced their first historical transition.' },
  { id: 'beyond-the-hearth', name: 'Beyond the first hearths', requiredFeatures: ['settlement-expansion'], requiresMilestones: ['first-harvest'], conditions: [{ kind: 'city-count', minimum: 8 }, { kind: 'total-population', minimum: 40 }], year: -8000, era: 0, explanation: 'The expansion feature has become lived history: new communities now support a larger population.' },
  { id: 'roads-between-peoples', name: 'Roads between peoples', requiredFeatures: ['trade-routes'], requiresMilestones: ['first-harvest'], conditions: [{ kind: 'active-routes', minimum: 2 }], year: -6000, era: 0, explanation: 'Working exchanges now connect independent civilizations. Trade is a world fact, not just a newly installed feature.' },
  { id: 'rise-of-states', name: 'The rise of states', requiredFeatures: ['statecraft'], requiresMilestones: ['roads-between-peoples'], conditions: [{ kind: 'technology', technology: 'civic-institutions', civilizations: 2 }, { kind: 'active-routes', minimum: 3 }], year: -3000, era: 1, explanation: 'Civic discoveries and functioning exchanges have made organized states possible. Public institutions can now be built.' },
  { id: 'connected-world', name: 'A connected world', requiredFeatures: ['navigation'], requiresMilestones: ['rise-of-states'], conditions: [{ kind: 'technology', technology: 'navigation', civilizations: 1 }, { kind: 'active-routes', minimum: 3 }], year: -500, era: 2, explanation: 'The released navigation system and an expanding exchange network have connected the world.' },
  { id: 'industrial-world', name: 'The industrial transformation', requiredFeatures: ['industrialization'], requiresMilestones: ['connected-world'], conditions: [{ kind: 'technology', technology: 'industrialization', civilizations: 1 }, { kind: 'building-count', building: 'workshop', minimum: 5 }], year: 1750, era: 3, explanation: 'Industrial capability is now supported by an actual productive foundation.' },
  { id: 'planetary-world', name: 'A planetary civilization', requiredFeatures: ['planetary-networks'], requiresMilestones: ['industrial-world'], conditions: [{ kind: 'technology', technology: 'computing', civilizations: 1 }, { kind: 'active-routes', minimum: 5 }], year: 2000, era: 4, explanation: 'Information systems and functioning global exchanges have made planetary interdependence real.' },
  { id: 'beyond-earth', name: 'The interplanetary threshold', requiredFeatures: ['interplanetary-logistics'], requiresMilestones: ['planetary-world'], conditions: [{ kind: 'technology', technology: 'spaceflight', civilizations: 1 }, { kind: 'active-routes', minimum: 5 }], year: 2150, era: 5, explanation: 'Interplanetary knowledge can now draw on Earth’s connected economy. Launch infrastructure and a viable colony remain separate achievements.' },
];

export interface ContentCatalog {
  civilizations: CivilizationDefinition[];
  features: FeatureDefinition[];
  technologies: TechnologyDefinition[];
  eras: EraDefinition[];
  buildings: BuildingDefinition[];
  events: DirectorEventDefinition[];
  milestones: HistoricalMilestone[];
  actionFeatures: Record<GameAction['type'], readonly string[]>;
  victoryRules: typeof VICTORY_RULES;
  tradeRecipes: TradeRecipe[];
  tradeRules: typeof TRADE_RULES;
}

export const CONTENT: ContentCatalog = {
  civilizations: CIVILIZATIONS, features: FEATURES, technologies: TECHNOLOGIES, eras: ERAS,
  buildings: BUILDINGS, events: DIRECTOR_EVENTS, milestones: HISTORICAL_MILESTONES,
  actionFeatures: ACTION_FEATURES, victoryRules: VICTORY_RULES,
  tradeRecipes: TRADE_RECIPES, tradeRules: TRADE_RULES,
};

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateContent(catalog: ContentCatalog = CONTENT): string[] {
  const errors: string[] = [];
  const unique = (label: string, values: string[]) => {
    if (new Set(values).size !== values.length) errors.push(`${label}: duplicate identifier`);
    if (values.some(value => value.trim().length === 0)) errors.push(`${label}: empty identifier`);
  };
  const eraValid = (era: number) => Number.isInteger(era) && era >= 0 && era < catalog.eras.length;
  const resources = (label: string, values: Partial<Resources>) => {
    for (const [resource, value] of Object.entries(values)) {
      if (!RESOURCE_IDS.some(id => id === resource) || !Number.isFinite(value) || value < 0) errors.push(`${label}: invalid resource cost or production ${resource}`);
    }
  };
  const features = new Set(catalog.features.map(feature => feature.id));
  const requireFeatures = (label: string, required: readonly string[]) => {
    if (required.length === 0) errors.push(`${label}: missing release feature gate`);
    for (const id of required) if (!features.has(id)) errors.push(`${label}: unknown feature ${id}`);
  };
  unique('trade recipes', catalog.tradeRecipes.map(recipe => recipe.id));
  for (const [name, value] of Object.entries(catalog.tradeRules)) {
    if (!Number.isSafeInteger(value) || value < 1) errors.push(`trade rules: invalid ${name}`);
  }
  for (const recipe of catalog.tradeRecipes) {
    const label = `trade ${recipe.id}`;
    const terms = recipe.terms;
    requireFeatures(label, recipe.requiredFeatures);
    if (!Number.isSafeInteger(recipe.version) || recipe.version < 1 || terms.recipeId !== recipe.id || terms.recipeVersion !== recipe.version) errors.push(`${label}: inconsistent recipe identity`);
    if (!Number.isSafeInteger(terms.cadenceRounds) || terms.cadenceRounds < 1 || !positive(terms.damageDisableAt) || terms.damageDisableAt > 100) errors.push(`${label}: invalid strategic cadence or damage threshold`);
    for (const [name, values] of Object.entries({ constructionCost: terms.constructionCost, proposerCargo: terms.proposerCargo, recipientCargo: terms.recipientCargo, proposerUpkeep: terms.proposerUpkeep, recipientUpkeep: terms.recipientUpkeep, proposerYield: terms.proposerYield, recipientYield: terms.recipientYield })) resources(`${label} ${name}`, values);
    if (![terms.proposerCargo, terms.recipientCargo].every(cargo => Object.values(cargo).some(positive))) errors.push(`${label}: both partners require meaningful cargo`);
  }
  const technologies = new Map(catalog.technologies.map(technology => [technology.id, technology]));
  const buildings = new Map(catalog.buildings.map(building => [building.id, building]));
  const milestones = new Map(catalog.milestones.map(milestone => [milestone.id, milestone]));
  unique('civilizations', catalog.civilizations.map(civ => civ.name));
  unique('capitals', catalog.civilizations.map(civ => civ.capital));
  unique('features', catalog.features.map(feature => feature.id));
  unique('technologies', catalog.technologies.map(technology => technology.id));
  unique('eras', catalog.eras.map(era => era.id));
  unique('buildings', catalog.buildings.map(building => building.id));
  unique('events', catalog.events.map(event => event.id));
  unique('milestones', catalog.milestones.map(milestone => milestone.id));
  if (catalog.civilizations.length !== CIV_COUNT) errors.push('civilizations: wrong actor count');
  for (const civ of catalog.civilizations) {
    if (!FOCUS_IDS.includes(civ.focus) || !/^#[\da-f]{6}$/i.test(civ.color)) errors.push(`civilization ${civ.name}: invalid presentation or focus`);
  }
  for (const technology of catalog.technologies) {
    requireFeatures(technology.id, technology.requiredFeatures);
    if (!eraValid(technology.era) || !positive(technology.cost)) errors.push(`technology ${technology.id}: invalid era or cost`);
    for (const required of technology.requires) {
      const prerequisite = technologies.get(required);
      if (!prerequisite) errors.push(`technology ${technology.id}: missing prerequisite ${required}`);
      else if (prerequisite.era > technology.era) errors.push(`technology ${technology.id}: future prerequisite ${required}`);
    }
  }
  const visit = (id: string, path: Set<string>, completed: Set<string>, dependencies: (key: string) => readonly string[]) => {
    if (path.has(id)) { errors.push(`${id}: prerequisite cycle`); return; }
    if (completed.has(id)) return;
    const next = new Set(path).add(id);
    for (const dependency of dependencies(id)) visit(dependency, next, completed, dependencies);
    completed.add(id);
  };
  const checkedTechnologies = new Set<string>();
  for (const id of technologies.keys()) visit(id, new Set(), checkedTechnologies, key => technologies.get(key)?.requires ?? []);
  for (const [index, era] of catalog.eras.entries()) {
    const technology = technologies.get(era.technology);
    if (!technology || technology.era !== index || era.cost !== technology.cost || era.capability !== technology.capability) errors.push(`era ${era.id}: discovery metadata drift`);
    const previous = catalog.eras[index - 1];
    if (!Number.isFinite(era.year) || (previous && era.year <= previous.year)) errors.push(`era ${era.id}: chronology out of order`);
  }
  const effects = (label: string, values: EffectDefinition[]) => {
    for (const effect of values) {
      if (!Number.isFinite(effect.amount) || effect.amount === 0) errors.push(`${label}: effects require finite nonzero amounts`);
      if (effect.kind === 'resource' && !RESOURCE_IDS.includes(effect.resource)) errors.push(`${label}: unknown effect resource`);
      if (effect.kind === 'city' && !['population', 'wellbeing', 'infrastructure', 'damage'].includes(effect.field)) errors.push(`${label}: unknown city field`);
      if (effect.kind === 'civilization' && !['influence', 'legitimacy'].includes(effect.field)) errors.push(`${label}: unknown civilization field`);
      if (effect.kind === 'route' && effect.field !== 'damage') errors.push(`${label}: unknown route field`);
      if (!['resource', 'city', 'civilization', 'route'].includes(effect.kind)) errors.push(`${label}: unknown effect kind`);
    }
  };
  for (const building of catalog.buildings) {
    requireFeatures(building.id, building.requiredFeatures);
    if (!eraValid(building.minEra)) errors.push(`building ${building.id}: invalid era`);
    resources(`${building.id} cost`, building.cost);
    resources(`${building.id} production`, building.production);
    effects(building.id, building.effects);
    for (const required of building.requires) {
      const technology = technologies.get(required);
      if (!technology) errors.push(`building ${building.id}: missing prerequisite ${required}`);
      else if (technology.era > building.minEra) errors.push(`building ${building.id}: future prerequisite ${required}`);
    }
  }
  for (const event of catalog.events) {
    requireFeatures(event.id, event.requiredFeatures);
    if (!eraValid(event.minEra) || !Number.isInteger(event.cooldown) || event.cooldown < 0) errors.push(`event ${event.id}: invalid era or cooldown`);
    if (event.id !== 'calm' && event.effects.length === 0) errors.push(`event ${event.id}: no world effect`);
    effects(event.id, event.effects);
  }
  for (const [action, required] of Object.entries(catalog.actionFeatures)) requireFeatures(action, required);
  for (const milestone of catalog.milestones) {
    requireFeatures(milestone.id, milestone.requiredFeatures);
    if (!eraValid(milestone.era) || !Number.isFinite(milestone.year) || milestone.conditions.length === 0) errors.push(`milestone ${milestone.id}: missing world evidence or chronology`);
    for (const required of milestone.requiresMilestones) {
      const previous = milestones.get(required);
      if (!previous) errors.push(`milestone ${milestone.id}: missing milestone ${required}`);
      else if (previous.year >= milestone.year || previous.era > milestone.era) errors.push(`milestone ${milestone.id}: chronology regresses`);
    }
    for (const condition of milestone.conditions) {
      if ('minimum' in condition && (!Number.isInteger(condition.minimum) || condition.minimum < 1)) errors.push(`milestone ${milestone.id}: invalid evidence minimum`);
      if (condition.kind === 'building-count') {
        const building = buildings.get(condition.building);
        if (!building) errors.push(`milestone ${milestone.id}: missing building ${condition.building}`);
        else {
          const priorEra = Math.max(0, ...milestone.requiresMilestones.map(id => milestones.get(id)?.era ?? 0));
          if (building.minEra > priorEra) errors.push(`milestone ${milestone.id}: circular building eligibility ${building.id}`);
        }
      }
      if (condition.kind === 'technology' && (!technologies.has(condition.technology) || !Number.isInteger(condition.civilizations) || condition.civilizations < 1 || condition.civilizations > CIV_COUNT)) errors.push(`milestone ${milestone.id}: invalid technology evidence`);
      if ('eventType' in condition && condition.eventType.trim().length === 0) errors.push(`milestone ${milestone.id}: empty event evidence`);
    }
  }
  const checkedMilestones = new Set<string>();
  for (const id of milestones.keys()) visit(id, new Set(), checkedMilestones, key => milestones.get(key)?.requiresMilestones ?? []);
  const { mars, federation } = catalog.victoryRules;
  requireFeatures('mars victory', mars.requiredFeatures);
  requireFeatures('federation victory', federation.requiredFeatures);
  resources('mars upkeep', mars.upkeep);
  resources('federation upkeep', federation.upkeep);
  if (mars.minEra !== catalog.eras.length - 1 || !technologies.has(mars.requiredTechnology) || !buildings.has(mars.requiredBuilding) || !positive(mars.progress) || !positive(mars.population) || !Number.isInteger(mars.suppliedRounds) || mars.suppliedRounds < 2) errors.push('mars: missing developed, sustained colony prerequisites');
  if (federation.minEra < 4 || !eraValid(federation.minEra) || !Number.isInteger(federation.members) || federation.members < 3 || federation.members > CIV_COUNT || !Number.isInteger(federation.suppliedRounds) || federation.suppliedRounds < 2 || !positive(federation.infrastructurePerMember) || !positive(federation.wellbeing) || !positive(federation.legitimacy)) errors.push('federation: immediate or unsupported pact victory');
  return errors;
}

export const TURN_RULES = { tacticalWindowMs: 10_000, actionsPerWindow: 1, strategyIntervalMs: 60_000, maximumCatchupTicks: 60, maximumPlanItems: 2 } as const;
