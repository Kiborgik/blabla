import { createGovernmentCashflowPolicy } from './behavior-government-cashflow.ts';
import type { GovernmentCashflowAssessment } from './behavior-government-cashflow.ts';
import type { BehaviorProfile } from './behavior-profiles.ts';
import type { Resources, WorldState } from './types.ts';

export type PatronageAssessment = GovernmentCashflowAssessment;

export function createPatronagePolicy(state: WorldState, civId: number, weights: Readonly<Resources>, priorities: BehaviorProfile['priorities']) {
  return createGovernmentCashflowPolicy(state, civId, weights, priorities);
}
