import { CIV_COUNT } from './types.ts';
import type {
  BuildingCapability, BuildingDefinition, CivilizationDefinition, DirectorEventDefinition, EffectDefinition,
  EraDefinition, FeatureDefinition, Focus, GameAction, HistoricalMilestone, Resource,
  Resources, TechnologyDefinition, Terrain, TradeRecipe, PublicProjectRecipe, ImprovementDefinition,
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

export const RESIDENT_CAPACITY_RULES = { ruleVersion: 1, communityReserve: 3, perPaidRecipe: 3 } as const;

export const CONSTRUCTION_RULES = { version: 1, baseWork: 1, industryWork: 2, defaultRequiredWork: 6, requiredWork: { farm: 4, workshop: 4, campus: 8, library: 8, 'commercial-hub': 10, market: 10, university: 14, bank: 14, 'industrial-zone': 12, 'guild-workshop': 12 } } as const;

export const BUILDING_CAPABILITY_ACTIONS: Record<BuildingCapability, readonly GameAction['type'][]> = { 'coastal-departure': ['settle-coast'] };
export const RESEARCH_INVESTMENT_RULES = { ruleVersion: 1, featureId: 'productive-research', budget: 'current-city-science-output' } as const;

export const DISTRICT_RULES = { ruleVersion: 1, featureId: 'district-planning', baseCapacity: 1, populationPerDistrict: 4 } as const;
export const IMPROVEMENT_RULES = { ruleVersion: 1, featureId: 'worked-land', hillElevation: { minimum: 70, maximum: 88 }, allocationPriority: 'paid-buildings-then-numeric-tile' } as const;

export const CONNECTED_RESEARCH_PACING = { ruleVersion: 1, featureId: 'learning-commerce', multiplier: 3, baseCosts: { 'bronze-working': 36, currency: 42, mathematics: 44, education: 72, banking: 120 } } as const;

export const MANUFACTURING_RESEARCH_PACING = { ruleVersion: 1, featureId: 'manufacturing', multiplier: 3, baseCosts: { 'iron-working': 48, apprenticeship: 68 } } as const;

export const METAL_RULES = { ruleVersion: 1, featureId: 'finite-metals', resource: 'iron', revealTechnology: 'bronze-working', capacityPerCity: 40, extractionPerBeat: 2, initialReserve: 240, placement: { id: 'iron-placement-1', maximumDeposits: 8, frontierMinimumDistance: 2, ownedSiteRange: 3, seedMultiplier: 0x9e3779b1, mixMultipliers: [0x7feb352d, 0x846ca68b], hillOnly: true } } as const;

export const COASTAL_FOUNDING_RULES = { ruleVersion: 1, requiredTechnology: 'navigation', requiredBuildingCapability: 'coastal-departure' } as const;

export const FEATURES: FeatureDefinition[] = [
  { id: 'manufacturing', name: 'Connected local manufacturing', description: 'Iron working and Apprenticeship connect real worked Mine sites to Industrial zones and resident-supported Guild workshops.' },
  { id: 'finite-metals', name: 'Finite useful deposits', description: 'Bronze working reveals finite iron on existing hills; staffed Mines extract it for consensual exchange.' },
  { id: 'learning-commerce', name: 'Connected learning and commerce', description: 'Currency, Mathematics, Education and Banking connect useful local institutions and paid operations.' },
  { id: 'worked-land', name: 'People work the land', description: 'Commit an exact owned site to a timed improvement, then assign local residents to its actual output.' },
  { id: 'mining', name: 'Work useful hills', description: 'Mining opens resident-supported material production on existing hill sites. Finite strategic deposits remain a later capability.' },
  { id: 'district-planning', name: 'Choose a district site', description: 'A town commits its existing construction lane to an exact owned site; nearby terrain changes its later output.' },
  { id: 'writing', name: 'Writing and local learning', description: 'Writing opens a real Campus and its own Library; specialist and great-person systems remain planned.' },
  { id: 'coastal-founding', name: 'New shores', description: 'Navigation and a completed coastal Boat yard let existing residents found a new coastal town along a recorded ocean path.' },
  { id: 'productive-research', name: 'Productive research', description: 'Research advances from actual science made each season; old reserves do not accelerate the current project.' },
  { id: 'resident-capacity', name: 'People support local work', description: 'Each town uses its opening residents and complete supplies together for paid operations, so conserved founding changes later local support.' },
  { id: 'recurring-decisions', name: 'Choose the next commitment', description: 'Research and each town retain real commitments and expose required next choices after completion without stopping other civilizations.' },
  { id: 'settlement-turns', name: 'Five civilizations awaken', description: 'Five civilization actors and one World Director inhabit a shared, revisioned world.' },
  { id: 'settlement-production', name: 'Working settlements', description: 'Food, materials, city focus and buildings sustain actual populations.' },
  { id: 'settlement-research', name: 'First discoveries', description: 'Civilizations invest their knowledge in released discoveries.' },
  { id: 'director-events', name: 'A changing world', description: 'The World Director introduces real environmental pressures and opportunities.' },
  { id: 'history-advancement', name: 'Turning points in history', description: 'Deliberate, explained historical advances move the calendar once without changing the regular clock or unlocking unfinished capabilities.' },
  { id: 'release-evolution', name: 'A world that keeps growing', description: 'Compatible delivered releases enter the inhabited world once while preserving its state, identity and history.' },
  { id: 'independent-actions', name: 'Civilizations act together', description: 'Independent fair tactical windows and shared strategic beats let each civilization act without waiting for another actor.' },
  { id: 'bounded-plans', name: 'The next useful step', description: 'At most two explicit actionable intentions guide real agent decisions and retain concrete lifecycle results without automatic execution.' },
  { id: 'building-operations', name: 'Working choices', description: 'Pause or operate constructed recipes that consume scarce inputs for useful output.' },
  { id: 'settlement-crafts', name: 'Water and fire', description: 'Connected discoveries create distinct food and material production commitments.' },
  { id: 'city-repair', name: 'Rebuild a working city', description: 'Materials and energy restore damage in an exactly selected owned city.' },
  { id: 'city-specialization', name: 'Distinct settlement roles', description: 'Each settlement can choose its own focus and construction while sharing civilization supplies.' },
  { id: 'conserved-founding', name: 'People build a frontier', description: 'New settlements transfer people from an owned source city without creating population.' },
  { id: 'terrain-production', name: 'Useful land', description: 'Released terrain yields make food and material locations distinct productive choices.' },
  { id: 'settlement-expansion', name: 'Beyond the first hearth', description: 'New settlements make land, migration and supply consequential.' },
  { id: 'trade-routes', name: 'Roads between peoples', description: 'Routes exchange scarce goods and can be disrupted and repaired.' },
  { id: 'public-projects', name: 'Promises that build', description: 'Consenting partners fund delayed shared repairs from their actual supplies.' },
  { id: 'exact-trade-endpoints', name: 'Choose the towns that connect', description: 'A trade proposal names two exact owned towns while keeping shared civilization stocks and the existing delivery schedule.' },
  { id: 'land-transport', name: 'Paths between towns', description: 'New consensual exchanges quote actual passable land paths and an acceptance-relative delivery interval.' },
  { id: 'operating-resource-exchange', name: 'Fuel through cooperation', description: 'Consenting partners exchange energy and materials to support later productive work.' },
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
  improve: ['worked-land', 'mining', 'recurring-decisions', 'resident-capacity'],
  'set-improvement-operation': ['worked-land', 'resident-capacity'],
  focus: ['settlement-production'], research: ['settlement-research'], build: ['settlement-production'],
  'set-building-operation': ['building-operations'],
  'settle-coast': ['settlement-expansion', 'conserved-founding', 'coastal-founding', 'navigation'],
  settle: ['settlement-expansion'], trade: ['trade-routes'], federate: ['federations'],
  'propose-trade': ['trade-routes'], 'respond-trade': ['trade-routes'], 'withdraw-trade': ['trade-routes'], 'stop-trade': ['trade-routes'],
  'propose-public-project': ['public-projects'], 'respond-public-project': ['public-projects'], 'cancel-public-project': ['public-projects'],
  'repair-city': ['city-repair'], repair: ['trade-routes'], expedition: ['interplanetary-logistics'], event: ['director-events'],
  wait: ['settlement-turns'],
};

export const TECHNOLOGIES: TechnologyDefinition[] = [
  { id: 'iron-working', name: 'Iron working', requiredFeatures: ['manufacturing'], era: 1, cost: 144, requires: ['bronze-working'], capability: 'Prepare Apprenticeship and local manufacturing supported by worked land. Military units remain planned.' },
  { id: 'apprenticeship', name: 'Apprenticeship', requiredFeatures: ['manufacturing'], era: 1, cost: 204, requires: ['currency', 'iron-working'], capability: 'Build an exact Industrial zone near completed Mines and operate its own Guild workshop.' },
  { id: 'bronze-working', name: 'Bronze working', requiredFeatures: ['finite-metals'], era: 1, cost: 108, requires: ['mining'], capability: 'Reveal finite iron at existing hills and extract it with a staffed Mine for useful exchange.' },
  { id: 'currency', name: 'Currency', requiredFeatures: ['learning-commerce'], era: 1, cost: 126, requires: ['writing'], capability: 'Build a Commercial hub and Market, and propose iron for food when finite metal exchange is released.' },
  { id: 'mathematics', name: 'Mathematics', requiredFeatures: ['learning-commerce'], era: 1, cost: 132, requires: ['writing', 'currency'], capability: 'Prepare Education and its useful local University.' },
  { id: 'education', name: 'Education', requiredFeatures: ['learning-commerce'], era: 1, cost: 216, requires: ['mathematics', 'writing'], capability: 'Support a University in a completed local Campus for productive science.' },
  { id: 'banking', name: 'Banking', requiredFeatures: ['learning-commerce'], era: 2, cost: 360, requires: ['currency', 'education'], capability: 'Support a Bank in a local Commercial hub for credits. Loans remain planned.' },
  { id: 'mining', name: 'Mining', requiredFeatures: ['mining', 'worked-land'], era: 0, cost: 20, requires: ['kiln-firing'], capability: 'Commit useful owned hills to Mines, then assign local residents to make building materials.' },
  { id: 'writing', name: 'Writing', requiredFeatures: ['writing', 'district-planning'], era: 0, cost: 24, requires: ['agriculture'], capability: 'Choose an exact owned Campus site, then support its Library with credits for more productive research.' },
  { id: 'agriculture', name: 'Cultivation', requiredFeatures: ['settlement-research'], era: 0, cost: 10, requires: [], capability: 'Cultivation supports farms, workshops and more reliable settlements.' },
  { id: 'water-management', name: 'Water management', requiredFeatures: ['settlement-crafts'], era: 0, cost: 16, requires: ['agriculture'], capability: 'Irrigation uses materials to supply more food.' },
  { id: 'kiln-firing', name: 'Kiln firing', requiredFeatures: ['settlement-crafts'], era: 0, cost: 16, requires: ['agriculture'], capability: 'Kilns use energy to supply more building materials.' },
  { id: 'civic-institutions', name: 'Civic institutions', requiredFeatures: ['statecraft'], era: 1, cost: 24, requires: ['agriculture'], capability: 'Public institutions connect learning, belonging and durable cooperation.' },
  { id: 'fuel-management', name: 'Fuel management', requiredFeatures: ['statecraft', 'settlement-crafts'], era: 1, cost: 28, requires: ['civic-institutions', 'kiln-firing'], capability: 'Fuel yards use materials to supply energy for production, trade and repairs.' },
  { id: 'navigation', name: 'Navigation', requiredFeatures: ['navigation'], era: 2, cost: 42, requires: ['civic-institutions'], capability: 'A completed coastal Boat yard can send existing residents to a new shore beyond the ordinary frontier.' },
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

export const IMPROVEMENTS: ImprovementDefinition[] = [
  { id: 'mine', name: 'Mine', description: 'Work an owned hill with one local resident to make materials. Pausing releases that resident on the next economy beat.', requiredFeatures: ['worked-land', 'mining', 'resident-capacity', 'recurring-decisions'], requires: ['mining'], minEra: 0, cost: { materials: 6, credits: 3 }, requiredWork: 4, siteRange: 3, siteRequirement: 'hill', residentsRequired: 1, production: { materials: 2 } },
];

export const BUILDINGS: BuildingDefinition[] = [
  { id: 'industrial-zone', name: 'Industrial zone', requiredFeatures: ['district-planning', 'manufacturing'], minEra: 1, cost: { materials: 24, credits: 12 }, requires: ['apprenticeship'], effects: [], production: { materials: 2 }, district: { range: 3, adjacency: { improvement: 'mine', resource: 'materials', amount: 1, maximum: 3 } }, description: 'Commit an exact owned site to local manufacturing. Completed adjacent Mines add up to 3 base materials, even while paused; unfinished orders do not count. Quarry and great-person systems remain planned.' },
  { id: 'guild-workshop', name: 'Guild workshop', requiredFeatures: ['manufacturing', 'building-operations', 'resident-capacity'], minEra: 1, cost: { materials: 26, credits: 12 }, requires: ['apprenticeship'], requiresBuildings: ['industrial-zone'], effects: [], operatingInputs: { energy: 2 }, production: { materials: 6 }, description: 'Use two energy and three local residents to operate a workshop in this town’s completed Industrial zone. First output follows completion on a later season.' },
  { id: 'commercial-hub', name: 'Commercial hub', requiredFeatures: ['district-planning', 'learning-commerce'], minEra: 1, cost: { materials: 20, credits: 10 }, requires: ['currency'], effects: [], production: { credits: 2 }, district: { range: 3 }, description: 'Reserve an exact owned site for local commerce. River and Harbor adjacency await those actual systems.' },
  { id: 'market', name: 'Market', requiredFeatures: ['learning-commerce', 'building-operations', 'resident-capacity'], minEra: 1, cost: { materials: 18, credits: 10 }, requires: ['currency'], requiresBuildings: ['commercial-hub'], effects: [], operatingInputs: { credits: 1 }, production: { credits: 4 }, description: 'Use credits and three local residents to operate this town’s Market. Extra trade capacity and great-person effects remain planned.' },
  { id: 'university', name: 'University', requiredFeatures: ['learning-commerce', 'building-operations', 'resident-capacity'], minEra: 1, cost: { materials: 28, credits: 14 }, requires: ['education'], requiresBuildings: ['campus'], effects: [], operatingInputs: { credits: 2 }, production: { science: 5 }, description: 'Use credits and three local residents to support advanced local learning. Specialists and knowledge-point effects remain planned.' },
  { id: 'bank', name: 'Bank', requiredFeatures: ['learning-commerce', 'building-operations', 'resident-capacity'], minEra: 2, cost: { materials: 30, credits: 18 }, requires: ['banking'], requiresBuildings: ['commercial-hub'], effects: [], operatingInputs: { credits: 1 }, production: { credits: 7 }, description: 'Use credits and three local residents to operate this town’s Bank. Loan agreements remain planned.' },
  { id: 'campus', name: 'Campus', requiredFeatures: ['district-planning', 'writing'], minEra: 0, cost: { materials: 16, credits: 8 }, requires: ['writing'], effects: [], production: { science: 1 }, district: { range: 3, adjacency: { terrain: 'mountain', resource: 'science', amount: 1, maximum: 3 } }, description: 'Commit an owned site near this town to learning. Nearby mountains add up to 3 base science; output begins after completion.' },
  { id: 'library', name: 'Library', requiredFeatures: ['district-planning', 'writing', 'building-operations'], minEra: 0, cost: { materials: 16, credits: 8 }, requires: ['writing'], requiresBuildings: ['campus'], effects: [], production: { science: 3 }, operatingInputs: { credits: 1 }, description: 'Support the Library in this town’s completed Campus with credits and residents to produce science. Specialist and great-person effects remain planned.' },
  { id: 'boat-yard', name: 'Boat yard', requiredFeatures: ['coastal-founding'], minEra: 0, cost: { materials: 14, credits: 10 }, requires: ['water-management'], effects: [], production: {}, capabilities: ['coastal-departure'], siteRequirement: 'coastal', description: 'Prepare boats at an ocean-adjacent town. With Navigation, transfer existing residents to a new coastal settlement.' },
  { id: 'farm', name: 'Terraced fields', requiredFeatures: ['settlement-production'], minEra: 0, cost: { materials: 8, credits: 4 }, requires: ['agriculture'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }, { kind: 'city', field: 'wellbeing', amount: 4 }], production: { food: 4 }, description: 'Reliable harvests sustain people and leave a surplus for future growth.' },
  { id: 'workshop', name: 'Artisan quarter', requiredFeatures: ['settlement-production'], minEra: 0, cost: { materials: 12, credits: 8 }, requires: ['agriculture'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }], production: { materials: 3, energy: 1 }, description: 'Specialized work supplies the materials other projects need.' },
  { id: 'irrigation', name: 'Irrigation works', requiredFeatures: ['settlement-crafts', 'building-operations'], minEra: 0, cost: { materials: 12, credits: 8 }, requires: ['water-management'], effects: [], operatingInputs: { materials: 1 }, production: { food: 5 }, description: 'Use one material each economy beat to supply food. Operation can be paused.' },
  { id: 'kiln', name: 'Kiln', requiredFeatures: ['settlement-crafts', 'building-operations'], minEra: 0, cost: { materials: 10, credits: 8 }, requires: ['kiln-firing'], effects: [], operatingInputs: { energy: 2 }, production: { materials: 4 }, description: 'Use two energy each economy beat to make materials. Operation can be paused.' },
  { id: 'academy', name: 'House of learning', requiredFeatures: ['statecraft', 'building-operations'], minEra: 1, cost: { materials: 16, credits: 10 }, requires: ['civic-institutions'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }], operatingInputs: { culture: 2, credits: 1 }, production: { science: 3 }, description: 'Use culture and credits each economy beat to support learning. Operation can be paused.' },
  { id: 'monument', name: 'Civic gathering place', requiredFeatures: ['statecraft'], minEra: 1, cost: { materials: 12, credits: 8 }, requires: ['civic-institutions'], effects: [{ kind: 'city', field: 'infrastructure', amount: 1 }, { kind: 'civilization', field: 'legitimacy', amount: 4 }], production: { culture: 4 }, description: 'A public place makes collective identity and political commitments visible.' },
  { id: 'fuel-yard', name: 'Fuel yard', requiredFeatures: ['statecraft', 'settlement-crafts', 'building-operations'], minEra: 1, cost: { materials: 14, credits: 8 }, requires: ['fuel-management'], effects: [], operatingInputs: { materials: 2 }, production: { energy: 3 }, description: 'Use materials each economy beat to supply energy. Operation can be paused.' },
  { id: 'launchpad', name: 'Orbital gateway', requiredFeatures: ['interplanetary-logistics'], minEra: 5, cost: { materials: 40, energy: 24, credits: 30 }, requires: ['spaceflight'], effects: [{ kind: 'city', field: 'infrastructure', amount: 2 }], production: {}, description: 'Launch infrastructure connects Earth’s industry to an off-world supply line.' },
];

export const DIRECTOR_EVENTS: DirectorEventDefinition[] = [
  { id: 'drought', name: 'The rains fail', requiredFeatures: ['director-events'], minEra: 0, description: 'A dry season threatens a civilization’s food reserves.', consequence: 'Food scarcity tests growth choices and the wellbeing of settlements.', effects: [{ kind: 'resource', resource: 'food', amount: -12 }, { kind: 'city', field: 'wellbeing', amount: -10 }], cooldown: 2 },
  { id: 'earthquake', name: 'The earth moves', requiredFeatures: ['director-events', 'disaster-recovery'], minEra: 0, description: 'A fault ruptures beneath settled land.', consequence: 'Damaged buildings and routes create a need for reconstruction and relief.', effects: [{ kind: 'city', field: 'damage', amount: 35 }, { kind: 'city', field: 'infrastructure', amount: -1 }, { kind: 'route', field: 'damage', amount: 25 }], releasedEffects: { requiredFeatures: ['city-repair'], effects: [{ kind: 'city', field: 'damage', amount: 35 }, { kind: 'route', field: 'damage', amount: 25 }] }, cooldown: 3 },
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
  settle: { cost: { food: 10, materials: 12, credits: 8 }, population: 3, minimumSourcePopulation: 3 },
  trade: { cost: { materials: 6, credits: 8 }, ownerCargo: { food: 2 }, partnerCargo: { materials: 2 }, commerceYield: { credits: 2 }, upkeep: { energy: 1 }, damageDisableAt: 50 },
  repair: { cost: { materials: 5, energy: 2 }, damageReduction: 25 },
  expedition: { cost: { food: 5, materials: 8, energy: 8, credits: 6 }, progress: 25, population: 1 },
};

export const SETTLEMENT_SITE_OUTPUTS: Readonly<Partial<Record<Terrain, Partial<Resources>>>> = { grassland: { food: 2 }, forest: { materials: 2 } };

export const LAND_TRANSPORT_RULES = { ruleVersion: 1 as const, edgesPerBeat: 2, passable: { grassland: true, forest: true, desert: true, tundra: true, mountain: false, ocean: false } satisfies Record<Terrain, boolean> };
export const TRADE_RULES = { offerExpiryRounds: 8, maxPendingPerPair: 1, maxActivePerPair: 1 };

export const TRADE_RECIPES: TradeRecipe[] = [
  { id: 'iron-for-food', version: 1, name: 'Iron for food', description: 'Exchange extracted iron for a partner’s food. Both sides fund transport before any cargo or commerce changes.', requiredFeatures: ['trade-routes', 'finite-metals', 'learning-commerce'], requiredTechnology: 'currency', terms: { recipeId: 'iron-for-food', recipeVersion: 1, constructionCost: { materials: 6, credits: 8 }, proposerCargo: {}, recipientCargo: { food: 5 }, strategicCargo: { proposer: { iron: 2 }, recipient: {} }, proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 1 }, proposerYield: { credits: 2 }, recipientYield: { credits: 2 }, cadenceRounds: 4, damageDisableAt: 50 } },
  { id: 'harvest-for-materials', version: 1, name: 'Harvest for materials', description: 'A food surplus supports a partner while materials return to build the next settlement project.', requiredFeatures: ['trade-routes'], terms: { recipeId: 'harvest-for-materials', recipeVersion: 1, constructionCost: { materials: 6, credits: 8 }, proposerCargo: { food: 4 }, recipientCargo: { materials: 3 }, proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 1 }, proposerYield: { credits: 2 }, recipientYield: { credits: 2 }, cadenceRounds: 4, damageDisableAt: 50 } },
  { id: 'energy-for-materials', version: 1, name: 'Energy for materials', description: 'Send energy for a partner’s later work and receive materials. Each partner also pays transport energy before receiving cargo.', requiredFeatures: ['trade-routes', 'operating-resource-exchange'], terms: { recipeId: 'energy-for-materials', recipeVersion: 1, constructionCost: { materials: 6, credits: 8 }, proposerCargo: { energy: 4 }, recipientCargo: { materials: 3 }, proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 1 }, proposerYield: { credits: 2 }, recipientYield: { credits: 2 }, cadenceRounds: 4, damageDisableAt: 50 } },
];

export const PUBLIC_PROJECT_RULES = { maxActivePerPair: 1, maxActiveTotal: CIV_COUNT * (CIV_COUNT - 1) / 2 };

export const PUBLIC_PROJECT_RECIPES: PublicProjectRecipe[] = [
  { id: 'joint-road-repair', version: 1, name: 'Joint road repair', description: 'Both route partners promise supplies for a later shared repair. Either may cancel before completion.', requiredFeatures: ['public-projects', 'statecraft', 'trade-routes'], requiredTechnology: 'civic-institutions', requiredBuilding: 'monument', terms: { recipeId: 'joint-road-repair', recipeVersion: 1, proposerContribution: { materials: 2, energy: 1 }, recipientContribution: { materials: 2, energy: 1 }, damageReduction: 25, pendingLifetimeRounds: 4, completionDelayRounds: 2 } },
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
  { id: 'connected-world', name: 'A connected world', requiredFeatures: ['navigation'], requiresMilestones: ['rise-of-states'], conditions: [{ kind: 'technology', technology: 'navigation', civilizations: 1 }, { kind: 'active-routes', minimum: 3 }, { kind: 'recorded-event-count', eventType: 'coastal-founded', minimum: 1 }], year: -500, era: 2, explanation: 'Navigation has founded an actual coastal settlement while a working exchange network connects peoples.' },
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
  improvements: ImprovementDefinition[];
  improvementRules: typeof IMPROVEMENT_RULES;
  events: DirectorEventDefinition[];
  milestones: HistoricalMilestone[];
  actionFeatures: Record<GameAction['type'], readonly string[]>;
  victoryRules: typeof VICTORY_RULES;
  tradeRecipes: TradeRecipe[];
  tradeRules: typeof TRADE_RULES;
  landTransportRules: typeof LAND_TRANSPORT_RULES;
  publicProjectRecipes: PublicProjectRecipe[];
  publicProjectRules: typeof PUBLIC_PROJECT_RULES;
  siteOutputs: typeof SETTLEMENT_SITE_OUTPUTS;
  residentCapacityRules: typeof RESIDENT_CAPACITY_RULES;
  metalRules: typeof METAL_RULES;
}

export const CONTENT: ContentCatalog = {
  civilizations: CIVILIZATIONS, features: FEATURES, technologies: TECHNOLOGIES, eras: ERAS,
  buildings: BUILDINGS, improvements: IMPROVEMENTS, improvementRules: IMPROVEMENT_RULES, events: DIRECTOR_EVENTS, milestones: HISTORICAL_MILESTONES,
  actionFeatures: ACTION_FEATURES, victoryRules: VICTORY_RULES, residentCapacityRules: RESIDENT_CAPACITY_RULES, metalRules: METAL_RULES,
  tradeRecipes: TRADE_RECIPES, tradeRules: TRADE_RULES, landTransportRules: LAND_TRANSPORT_RULES, publicProjectRecipes: PUBLIC_PROJECT_RECIPES, publicProjectRules: PUBLIC_PROJECT_RULES, siteOutputs: SETTLEMENT_SITE_OUTPUTS,
};

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateContent(catalog: ContentCatalog = CONTENT): string[] {
  const errors: string[] = [];
  if (catalog.residentCapacityRules.ruleVersion !== 1 || !Number.isSafeInteger(catalog.residentCapacityRules.communityReserve) || catalog.residentCapacityRules.communityReserve < 0 || !Number.isSafeInteger(catalog.residentCapacityRules.perPaidRecipe) || catalog.residentCapacityRules.perPaidRecipe < 1) errors.push('resident capacity: invalid version or support requirement');
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
  for (const [terrain, outputs] of Object.entries(catalog.siteOutputs)) {
    if (!['grassland', 'forest', 'desert', 'tundra'].includes(terrain)) errors.push(`site output ${terrain}: unsupported productive terrain`);
    resources(`site output ${terrain}`, outputs);
  }
  const features = new Set(catalog.features.map(feature => feature.id));
  const requireFeatures = (label: string, required: readonly string[]) => {
    if (required.length === 0) errors.push(`${label}: missing release feature gate`);
    for (const id of required) if (!features.has(id)) errors.push(`${label}: unknown feature ${id}`);
  };
  if (catalog.landTransportRules.ruleVersion !== 1 || !Number.isSafeInteger(catalog.landTransportRules.edgesPerBeat) || catalog.landTransportRules.edgesPerBeat < 1) errors.push('land transport: invalid version or pace');
  if (Object.keys(catalog.landTransportRules.passable).length !== 6 || ['grassland', 'forest', 'desert', 'tundra', 'mountain', 'ocean'].some(terrain => typeof Reflect.get(catalog.landTransportRules.passable, terrain) !== 'boolean')) errors.push('land transport: invalid terrain passability');
  const metal = catalog.metalRules;
  if (metal.ruleVersion !== 1 || !features.has(metal.featureId) || metal.resource !== 'iron' || !catalog.technologies.some(technology => technology.id === metal.revealTechnology)) errors.push('metals: invalid feature, resource or reveal technology');
  if (![metal.capacityPerCity, metal.extractionPerBeat, metal.initialReserve, metal.placement.maximumDeposits, metal.placement.frontierMinimumDistance, metal.placement.ownedSiteRange].every(value => Number.isSafeInteger(value) && value > 0)) errors.push('metals: invalid positive integer quantity');
  if (metal.placement.id !== 'iron-placement-1' || metal.placement.hillOnly !== true || metal.placement.seedMultiplier !== 0x9e3779b1 || metal.placement.mixMultipliers[0] !== 0x7feb352d || metal.placement.mixMultipliers[1] !== 0x846ca68b) errors.push('metals: invalid versioned placement');
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
    if (recipe.requiredTechnology !== undefined && !catalog.technologies.some(technology => technology.id === recipe.requiredTechnology)) errors.push(`${label}: unknown proposer technology`);
    if (terms.strategicCargo && !recipe.requiredFeatures.includes('finite-metals')) errors.push(`${label}: strategic cargo requires finite-metals`);
    for (const cargo of [terms.strategicCargo?.proposer, terms.strategicCargo?.recipient]) {
      if (cargo && Object.entries(cargo).some(([resource, amount]) => resource !== 'iron' || !Number.isSafeInteger(amount) || amount < 0)) errors.push(`${label}: invalid strategic cargo`);
    }
    if (![[terms.proposerCargo, terms.strategicCargo?.proposer], [terms.recipientCargo, terms.strategicCargo?.recipient]].every(vectors => vectors.some(cargo => Object.values(cargo ?? {}).some(positive)))) errors.push(`${label}: both partners require meaningful cargo`);
  }
  const technologies = new Map(catalog.technologies.map(technology => [technology.id, technology]));
  const buildings = new Map(catalog.buildings.map(building => [building.id, building]));
  const improvementRules = catalog.improvementRules;
  if (improvementRules.ruleVersion !== 1 || !features.has(improvementRules.featureId) || improvementRules.allocationPriority !== 'paid-buildings-then-numeric-tile' || !Number.isFinite(improvementRules.hillElevation.minimum) || !Number.isFinite(improvementRules.hillElevation.maximum) || improvementRules.hillElevation.minimum < 0 || improvementRules.hillElevation.maximum > 100 || improvementRules.hillElevation.minimum > improvementRules.hillElevation.maximum) errors.push('improvements: invalid site or allocation rules');
  unique('improvements', catalog.improvements.map(improvement => improvement.id));
  for (const improvement of catalog.improvements) {
    const label = `improvement ${improvement.id}`;
    requireFeatures(label, improvement.requiredFeatures);
    if (!improvement.requiredFeatures.includes(improvementRules.featureId) || !improvement.requiredFeatures.includes('resident-capacity') || !improvement.requiredFeatures.includes('recurring-decisions')) errors.push(`${label}: missing operation or construction gate`);
    if (!eraValid(improvement.minEra) || !Number.isSafeInteger(improvement.requiredWork) || improvement.requiredWork < 1 || !Number.isSafeInteger(improvement.siteRange) || improvement.siteRange < 1 || !Number.isSafeInteger(improvement.residentsRequired) || improvement.residentsRequired < 1 || improvement.siteRequirement !== 'hill') errors.push(`${label}: invalid work, site or resident requirement`);
    resources(`${label} cost`, improvement.cost);
    resources(`${label} production`, improvement.production);
    if (!Object.values(improvement.cost).some(positive) || !Object.values(improvement.production).some(positive)) errors.push(`${label}: requires meaningful construction cost and production`);
    if (new Set(improvement.requires).size !== improvement.requires.length) errors.push(`${label}: duplicate prerequisites`);
    for (const required of improvement.requires) {
      const technology = technologies.get(required);
      if (!technology) errors.push(`${label}: missing prerequisite ${required}`);
      else if (technology.era > improvement.minEra) errors.push(`${label}: future prerequisite ${required}`);
    }
  }
  const milestones = new Map(catalog.milestones.map(milestone => [milestone.id, milestone]));
  unique('public project recipes', catalog.publicProjectRecipes.map(recipe => recipe.id));
  for (const [name, value] of Object.entries(catalog.publicProjectRules)) {
    if (!Number.isSafeInteger(value) || value < 1) errors.push(`public project rules: invalid ${name}`);
  }
  for (const recipe of catalog.publicProjectRecipes) {
    const label = `public project ${recipe.id}`;
    const terms = recipe.terms;
    requireFeatures(label, recipe.requiredFeatures);
    if (!technologies.has(recipe.requiredTechnology) || !buildings.has(recipe.requiredBuilding)) errors.push(`${label}: unknown civic prerequisite`);
    if (!Number.isSafeInteger(recipe.version) || recipe.version < 1 || terms.recipeId !== recipe.id || terms.recipeVersion !== recipe.version) errors.push(`${label}: inconsistent recipe identity`);
    if (!positive(terms.damageReduction) || terms.damageReduction > 100 || !Number.isSafeInteger(terms.pendingLifetimeRounds) || terms.pendingLifetimeRounds < 1 || !Number.isSafeInteger(terms.completionDelayRounds) || terms.completionDelayRounds < 1) errors.push(`${label}: invalid repair or timing`);
    for (const [side, contribution] of Object.entries({ proposer: terms.proposerContribution, recipient: terms.recipientContribution })) {
      resources(`${label} ${side}`, contribution);
      if (!Object.values(contribution).some(positive)) errors.push(`${label}: missing ${side} contribution`);
    }
  }

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
    resources(`${building.id} operating inputs`, building.operatingInputs ?? {});
    if (Object.values(building.operatingInputs ?? {}).some(positive) && !building.requiredFeatures.includes('building-operations')) errors.push(`building ${building.id}: operating inputs require the building-operations feature`);
    const capabilities = building.capabilities ?? [];
    for (const capability of capabilities) if (!Object.hasOwn(BUILDING_CAPABILITY_ACTIONS, capability)) errors.push(`building ${building.id}: unknown capability ${capability}`);
    if (new Set(capabilities).size !== capabilities.length) errors.push(`building ${building.id}: duplicate capabilities`);
    if (building.siteRequirement !== undefined && building.siteRequirement !== 'coastal') errors.push(`building ${building.id}: unknown site requirement`);
    if (building.district) {
      const { range, adjacency } = building.district;
      if (!building.requiredFeatures.includes('district-planning')) errors.push(`building ${building.id}: district requires district-planning feature`);
      if (!Number.isSafeInteger(range) || range < 1) errors.push(`building ${building.id}: invalid district range`);
      if (adjacency && ((adjacency.terrain !== undefined) === (adjacency.improvement !== undefined))) errors.push(`building ${building.id}: district adjacency requires exactly one selector`);
      if (adjacency?.terrain !== undefined && !['grassland', 'forest', 'desert', 'tundra', 'mountain', 'ocean'].includes(adjacency.terrain)) errors.push(`building ${building.id}: invalid district terrain`);
      if (adjacency?.improvement !== undefined && !catalog.improvements.some(improvement => improvement.id === adjacency.improvement)) errors.push(`building ${building.id}: invalid district improvement`);
      if (adjacency && !RESOURCE_IDS.includes(adjacency.resource)) errors.push(`building ${building.id}: invalid district resource`);
      if (adjacency && (!positive(adjacency.amount) || !Number.isFinite(adjacency.maximum) || adjacency.maximum < 0)) errors.push(`building ${building.id}: invalid district adjacency`);
    }
    const requiredBuildings = building.requiresBuildings ?? [];
    if (new Set(requiredBuildings).size !== requiredBuildings.length) errors.push(`building ${building.id}: duplicate building prerequisite`);
    for (const id of requiredBuildings) {
      const prerequisite = buildings.get(id);
      if (!prerequisite) errors.push(`building ${building.id}: missing building prerequisite ${id}`);
      else if (prerequisite.minEra > building.minEra) errors.push(`building ${building.id}: future building prerequisite ${id}`);
    }
    if (capabilities.includes('coastal-departure') && (building.siteRequirement !== 'coastal' || !building.requiredFeatures.includes('coastal-founding'))) errors.push(`building ${building.id}: coastal departure requires coastal site and feature`);
    if (building.effects.length === 0 && !Object.values(building.production).some(positive) && !capabilities.some(capability => Object.hasOwn(BUILDING_CAPABILITY_ACTIONS, capability))) errors.push(`building ${building.id}: no production or world effect`);
    effects(building.id, building.effects);
    for (const required of building.requires) {
      const technology = technologies.get(required);
      if (!technology) errors.push(`building ${building.id}: missing prerequisite ${required}`);
      else if (technology.era > building.minEra) errors.push(`building ${building.id}: future prerequisite ${required}`);
    }
  }
  const checkedBuildings = new Set<string>();
  for (const id of buildings.keys()) visit(id, new Set(), checkedBuildings, key => buildings.get(key)?.requiresBuildings ?? []);
  for (const event of catalog.events) {
    requireFeatures(event.id, event.requiredFeatures);
    if (!eraValid(event.minEra) || !Number.isInteger(event.cooldown) || event.cooldown < 0) errors.push(`event ${event.id}: invalid era or cooldown`);
    if (event.id !== 'calm' && event.effects.length === 0) errors.push(`event ${event.id}: no world effect`);
    effects(event.id, event.effects);
    if (event.releasedEffects) {
      requireFeatures(`${event.id} released effects`, event.releasedEffects.requiredFeatures);
      if (event.releasedEffects.effects.length === 0) errors.push(`${event.id}: empty released effects`);
      effects(`${event.id} released effects`, event.releasedEffects.effects);
    }
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
