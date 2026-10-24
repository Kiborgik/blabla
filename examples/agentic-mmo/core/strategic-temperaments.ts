import { normalizeSeed, randomStep } from './simulation/random.ts';
import type { BehaviorPhase, BehaviorProfile } from './behavior-profiles.ts';
import type { GameAction } from './types.ts';

export const STRATEGIC_TEMPERAMENT_VERSION = 'strategic-temperaments-v1';
export const TEMPERAMENT_BEHAVIOR_POLICY_VERSION = 'weighted-civilizations-v4-temperaments';
export const STRATEGIC_ARCHETYPES = ['scholars', 'stewards', 'builders', 'traders', 'custodians'] as const;
export type StrategicArchetype = typeof STRATEGIC_ARCHETYPES[number];
export type StrategicPosture = 'compact' | 'measured' | 'outward';

export function behaviorSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function strategicTemperament(seed: number, seat: number): { archetypeId: StrategicArchetype; templateIndex: number; posture: StrategicPosture; profileId: string } {
  const normalized = normalizeSeed(seed);
  if (!Number.isInteger(seat) || seat < 0 || seat >= STRATEGIC_ARCHETYPES.length)
    throw new RangeError('A strategic temperament requires a valid civilization seat');
  const allocation = STRATEGIC_ARCHETYPES.map((_, index) => index);
  let cursor = behaviorSeed(`${STRATEGIC_TEMPERAMENT_VERSION}/archetype-allocation/${normalized}`);
  for (let index = allocation.length - 1; index > 0; index--) {
    const step = randomStep(cursor); cursor = step.seed;
    const other = Math.floor(step.value * (index + 1));
    const current = allocation[index]!; allocation[index] = allocation[other]!; allocation[other] = current;
  }
  const templateIndex = allocation[seat]!;
  const archetypeId = STRATEGIC_ARCHETYPES[templateIndex]!;
  const postures: readonly StrategicPosture[] = ['compact', 'measured', 'outward'];
  const posture = postures[Math.floor(randomStep(behaviorSeed(`${STRATEGIC_TEMPERAMENT_VERSION}/posture/${normalized}/${seat}`)).value * postures.length)]!;
  return { archetypeId, templateIndex, posture, profileId: `${STRATEGIC_TEMPERAMENT_VERSION}/${archetypeId}/${posture}` };
}

export function applyStrategicPosture(profile: BehaviorProfile, posture: StrategicPosture): BehaviorProfile {
  const transfer = posture === 'compact' ? 0.15 : posture === 'outward' ? -0.15 : 0;
  const priorities = { ...profile.priorities };
  priorities.construction += transfer; priorities.expansion -= transfer;
  priorities.civic += transfer; priorities.trade -= transfer;
  return { ...profile, resources: { ...profile.resources }, priorities,
    commitmentRounds: posture === 'compact' ? 7 : posture === 'outward' ? 5 : profile.commitmentRounds,
    settlementGoal: posture === 'compact' ? 3 : posture === 'outward' ? 4 : profile.settlementGoal };
}

export function isStrategicExchange(action: GameAction): boolean {
  return action.type === 'propose-trade' || action.type === 'respond-trade' && action.accept;
}

export function isStrategicDevelopment(action: GameAction): boolean {
  return ['research', 'apply-research-boost', 'build', 'improve', 'build-wonder', 'choose-civic', 'adopt-government'].includes(action.type);
}

export function ordinaryPhaseWeight(action: GameAction, weight: number, phase: BehaviorPhase): number {
  if (weight <= 0) return weight;
  const founding = action.type === 'settle' || action.type === 'settle-coast';
  if (phase === 'trade') return weight * (isStrategicExchange(action) ? 1.15 : founding ? 0.85 : 1);
  if (phase === 'development') return weight * (isStrategicDevelopment(action) ? 1.15 : founding || isStrategicExchange(action) ? 0.85 : 1);
  if (phase === 'consolidation') return weight * (['repair', 'repair-city', 'focus', 'set-building-operation', 'set-improvement-operation'].includes(action.type) ? 1.15 : founding ? 0.85 : 1);
  return weight;
}
