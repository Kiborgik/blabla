import { applyRelease } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { parseLocalSimulation, type LocalSimulation } from './local-simulation.ts';

export const SHORE_LOCAL_RELEASE_ID = 'settlement-shore-fisheries-1';
const FOOD_LOCAL_RELEASE_ID = 'settlement-food-budget-1';

export type LocalReleaseSource = 'active-local' | 'historical-local' | 'shared' | 'hosted' | 'native';
export type LocalReleaseTransitionResult =
  | { status: 'changed'; run: LocalSimulation }
  | { status: 'noop'; reason: 'terminal' | 'already-current'; run: LocalSimulation }
  | { status: 'refused'; reason: 'inactive-source' | 'unknown-target' | 'invalid-run' | 'incompatible-origin' | 'incompatible-release' | 'release-refused'; error?: string; run: LocalSimulation };

export function transitionLocalRelease(run: LocalSimulation, source: LocalReleaseSource, targetReleaseId: string = SHORE_LOCAL_RELEASE_ID): LocalReleaseTransitionResult {
  if (source !== 'active-local') return { status: 'refused', reason: 'inactive-source', run };
  if (targetReleaseId !== SHORE_LOCAL_RELEASE_ID) return { status: 'refused', reason: 'unknown-target', run };
  const checked = parseLocalSimulation(run);
  if (!checked) return { status: 'refused', reason: 'invalid-run', run };
  if (checked.state.origin?.initialReleaseId !== FOOD_LOCAL_RELEASE_ID)
    return { status: 'refused', reason: 'incompatible-origin', run };
  if (checked.state.releaseId !== FOOD_LOCAL_RELEASE_ID && checked.state.releaseId !== SHORE_LOCAL_RELEASE_ID)
    return { status: 'refused', reason: 'incompatible-release', run };
  const release = RELEASES.find(candidate => candidate.id === checked.state.releaseId);
  if (!release || release.schemaVersion !== checked.state.schemaVersion || release.gameVersion !== checked.state.gameVersion
    || checked.state.unlockedFeatures.length !== release.featureIds.length
    || new Set(checked.state.unlockedFeatures).size !== checked.state.unlockedFeatures.length
    || !release.featureIds.every(feature => checked.state.unlockedFeatures.includes(feature)))
    return { status: 'refused', reason: 'invalid-run', run };
  if (checked.state.outcome) return { status: 'noop', reason: 'terminal', run };
  if (checked.state.releaseId === SHORE_LOCAL_RELEASE_ID) return { status: 'noop', reason: 'already-current', run };
  const applied = applyRelease(checked.state, {
    expectedRevision: checked.state.revision,
    expectedFromReleaseId: FOOD_LOCAL_RELEASE_ID,
    targetReleaseId: SHORE_LOCAL_RELEASE_ID,
    timestamp: checked.timestamp,
  });
  if (!applied.ok) return { status: 'refused', reason: 'release-refused', error: applied.error ?? 'The compatible release was refused', run };
  const next = { ...checked, state: applied.state };
  if (!parseLocalSimulation(next)) return { status: 'refused', reason: 'release-refused', error: 'The compatible release did not produce a valid local run', run };
  return { status: 'changed', run: next };
}
