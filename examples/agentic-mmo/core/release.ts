import { GAME_VERSION, SCHEMA_VERSION } from './types.ts';
import type { CompatibleReleaseDefinition } from './types.ts';

const settlementFeatures = ['settlement-turns', 'settlement-production', 'settlement-research', 'director-events'];
const civicFeatures = [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization', 'city-repair', 'disaster-recovery', 'statecraft'];
const charterFeatures = [...civicFeatures, 'public-projects'];
export const RELEASES: readonly CompatibleReleaseDefinition[] = [
  { id: 'settlement-foundations-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: [], featureIds: settlementFeatures },
  { id: 'settlement-foundations-2', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution'] },
  { id: 'settlement-trade-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-2'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes'] },
  { id: 'settlement-independent-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-2', 'settlement-trade-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions'] },
  { id: 'settlement-plans-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-independent-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans'] },
  { id: 'settlement-production-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-independent-1', 'settlement-plans-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts'] },
  { id: 'settlement-frontiers-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-production-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production'] },
  { id: 'settlement-specialization-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-frontiers-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization'] },
  { id: 'settlement-recovery-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-specialization-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions', 'bounded-plans', 'building-operations', 'settlement-crafts', 'settlement-expansion', 'conserved-founding', 'terrain-production', 'city-specialization', 'city-repair', 'disaster-recovery'] },
  { id: 'settlement-civics-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-recovery-1'], featureIds: civicFeatures },
  { id: 'settlement-charters-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-civics-1'], featureIds: charterFeatures },
  { id: 'settlement-endpoints-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-charters-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints'] },
  { id: 'settlement-land-transport-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-endpoints-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport'] },
  { id: 'settlement-operating-exchange-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-land-transport-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange'] },
  { id: 'settlement-decisions-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-operating-exchange-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions'] },
  { id: 'settlement-residents-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-decisions-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity'] },
  { id: 'settlement-coastal-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-residents-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding'] },
  { id: 'settlement-research-rate-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-coastal-1'], featureIds: [...charterFeatures, 'exact-trade-endpoints', 'land-transport', 'operating-resource-exchange', 'recurring-decisions', 'resident-capacity', 'navigation', 'coastal-founding', 'productive-research'] },
];
function currentRelease(): CompatibleReleaseDefinition {
  const release = RELEASES.find((candidate) => candidate.id === 'settlement-foundations-1');
  if (!release) throw new Error('The current release must be registered');
  return release;
}
export const CURRENT_RELEASE = currentRelease();
