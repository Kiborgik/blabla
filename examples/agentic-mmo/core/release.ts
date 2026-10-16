import { GAME_VERSION } from './types.ts';
import type { ReleaseDefinition } from './types.ts';

export const CURRENT_RELEASE: ReleaseDefinition = {
  id: 'settlement-foundations-1',
  gameVersion: GAME_VERSION,
  featureIds: ['settlement-turns', 'settlement-production', 'settlement-research', 'director-events'],
};
