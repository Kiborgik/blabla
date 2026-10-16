import { GAME_VERSION, SCHEMA_VERSION } from './types.ts';
import type { CompatibleReleaseDefinition } from './types.ts';

const settlementFeatures = ['settlement-turns', 'settlement-production', 'settlement-research', 'director-events'];
export const RELEASES: readonly CompatibleReleaseDefinition[] = [
  { id: 'settlement-foundations-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: [], featureIds: settlementFeatures },
  { id: 'settlement-foundations-2', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution'] },
  { id: 'settlement-trade-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-2'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes'] },
  { id: 'settlement-independent-1', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, compatibleFrom: ['settlement-foundations-2', 'settlement-trade-1'], featureIds: [...settlementFeatures, 'history-advancement', 'release-evolution', 'trade-routes', 'independent-actions'] },
];
function currentRelease(): CompatibleReleaseDefinition {
  const release = RELEASES.find((candidate) => candidate.id === 'settlement-foundations-1');
  if (!release) throw new Error('The current release must be registered');
  return release;
}
export const CURRENT_RELEASE = currentRelease();
