import type { RiverIntakeVisualFacts } from '../visuals/river-intake-visuals.ts';
import type { CityImprovement, ImprovementOperationResult } from '../core/types.ts';
import { exactNumber } from './number-format.ts';

export function riverIntakeFacts(result: ImprovementOperationResult): string[] {
  const river = result.river;
  if (!river) return [];
  const facts = [
    `Tile ${river.tileId} → Tile ${river.downstreamTileId} · Ocean outlet Tile ${river.outletTileId}`,
    `River flow needed ${exactNumber(river.required)} · Available before ${exactNumber(river.availableBefore)} · Withdrawn ${exactNumber(river.withdrawn)} · Continuing downstream ${exactNumber(river.remainingAfter)}`,
    river.supportAllocationRound === null ? 'No funded Irrigation support recorded for this attempt.' : `Irrigation support funded in recorded round ${river.supportAllocationRound}.`,
    'Renewable flow for that season, not a stored or tradable resource. Upstream withdrawals have physical priority; future availability may change.',
  ];
  if (result.blockedReason === 'support-unfunded') facts.push('Irrigation was not funded in that season; the intake paid and withdrew nothing.');
  if (result.blockedReason === 'flow-shortage') facts.push('Insufficient river flow in that season; the intake paid and withdrew nothing.');
  return facts;
}

export function riverIntakeReadiness(site: CityImprovement, facts?: Pick<RiverIntakeVisualFacts, 'eligible' | 'terminal'> | null): string[] {
  if (facts?.terminal) return ['Completed world: no future operating season.'];
  if (!site.operation.enabled) return ['Currently paused: no intake operation is scheduled.'];
  if (!facts) return ['Current site and support eligibility is unavailable in this view.'];
  return [facts.eligible ? 'Current site and Irrigation support are eligible.' : 'Current site or Irrigation support is unavailable.',
    'This is not an operating forecast. Opening Materials, a remaining resident and eight river-flow units must all be available in the next season.'];
}
