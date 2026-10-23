import { GAME_VERSION, SCHEMA_VERSION } from './types.ts';
import type { RegisteredRulesDefinition } from './types.ts';

const settlementFeatures = ['settlement-turns', 'settlement-production', 'settlement-research', 'director-events'];
const civicFeatures = [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization', 'city-repair', 'disaster-recovery', 'statecraft'];
const charterFeatures = [...civicFeatures, 'public-projects'];
const historicalReleases: readonly RegisteredRulesDefinition[] = [
  { id: 'settlement-foundations-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: settlementFeatures },
  { id: 'settlement-foundations-2', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement'] },
  { id: 'settlement-trade-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes'] },
  { id: 'settlement-independent-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions'] },
  { id: 'settlement-plans-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans'] },
  { id: 'settlement-production-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts'] },
  { id: 'settlement-frontiers-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production'] },
  { id: 'settlement-specialization-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization'] },
  { id: 'settlement-recovery-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...settlementFeatures, 'history-advancement', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization', 'city-repair', 'disaster-recovery'] },
  { id: 'settlement-civics-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: civicFeatures },
  { id: 'settlement-charters-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: charterFeatures },
  { id: 'settlement-endpoints-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints'] },
  { id: 'settlement-land-transport-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport'] },
  { id: 'settlement-operating-exchange-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange'] },
  { id: 'settlement-decisions-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions'] },
  { id: 'settlement-residents-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity'] },
  { id: 'settlement-coastal-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding'] },
  { id: 'settlement-research-rate-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research'] },
  { id: 'settlement-writing-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing'] },
  { id: 'settlement-mining-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining'] },
  { id: 'settlement-metal-learning-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce'] },
  { id: 'settlement-manufacturing-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing'] },
  { id: 'settlement-wonders-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders'] },
  { id: 'settlement-growth-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth'] },
  { id: 'settlement-water-land-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land'] },
  { id: 'settlement-forest-production-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production'] },
  { id: 'settlement-world-expansion-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion'] },
  { id: 'settlement-territory-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory'] },
  { id: 'settlement-culture-production-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production'] },
  { id: 'settlement-foundry-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production'] },
  { id: 'settlement-observatory-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning'] },
  { id: 'settlement-civic-bootstrap-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning', 'civic-bootstrap'] },
  { id: 'settlement-industrial-steam-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning', 'civic-bootstrap', 'industrial-steam', 'industrialization'] },
  { id: 'settlement-local-power-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning', 'civic-bootstrap', 'industrial-steam', 'industrialization', 'local-power'] },
  { id: 'settlement-second-government-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning', 'civic-bootstrap', 'industrial-steam', 'industrialization', 'local-power', 'second-government'] },
  { id: 'settlement-powered-science-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research', 'district-planning', 'writing', 'worked-land', 'mining', 'finite-metals', 'learning-commerce', 'manufacturing', 'unique-wonders', 'local-growth', 'water-land', 'forest-production', 'world-expansion', 'owned-territory', 'culture-production', 'foundry-production', 'observatory-learning', 'civic-bootstrap', 'industrial-steam', 'industrialization', 'local-power', 'second-government', 'powered-science'] },
];
const previousRelease = historicalReleases.at(-1);
if (!previousRelease) throw new Error('Historical releases must precede interplanetary logistics');
const interplanetaryRelease: RegisteredRulesDefinition = {
  id: 'settlement-interplanetary-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...previousRelease.featureIds, 'planetary-networks', 'interplanetary-logistics', 'earned-history'],
};
const partnershipRelease: RegisteredRulesDefinition = {
  id: 'settlement-living-partnerships-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...interplanetaryRelease.featureIds, 'partnership-stewardship', 'historical-pressures'],
};
const reliefRelease: RegisteredRulesDefinition = {
  id: 'settlement-relief-charters-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...partnershipRelease.featureIds, 'consented-relief'],
};
const regionalRelease: RegisteredRulesDefinition = {
  id: 'settlement-regional-targets-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...reliefRelease.featureIds, 'procedural-regional-targets'],
};
const foodRelease: RegisteredRulesDefinition = {
  id: 'settlement-food-budget-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...regionalRelease.featureIds, 'food-budget'],
};
const shoreRelease: RegisteredRulesDefinition = {
  id: 'settlement-shore-fisheries-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...foodRelease.featureIds, 'shore-fisheries'],
};
const knowledgeRelease: RegisteredRulesDefinition = {
  id: 'settlement-knowledge-compacts-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...shoreRelease.featureIds, 'knowledge-compacts'],
};
const hillsideRelease: RegisteredRulesDefinition = {
  id: 'settlement-hillside-commonworks-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...knowledgeRelease.featureIds, 'hillside-commonworks'],
};
const studiesRelease: RegisteredRulesDefinition = {
  id: 'settlement-supported-studies-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION,
  featureIds: [...hillsideRelease.featureIds],
};
export const RELEASES: readonly RegisteredRulesDefinition[] = [...historicalReleases, interplanetaryRelease, partnershipRelease, reliefRelease, regionalRelease, foodRelease, shoreRelease, knowledgeRelease, hillsideRelease, studiesRelease];

function currentRelease(): RegisteredRulesDefinition {
  const release = RELEASES.find((candidate) => candidate.id === 'settlement-foundations-1');
  if (!release) throw new Error('The current release must be registered');
  return release;
}
export const CURRENT_RELEASE = currentRelease();
