import type { Focus, Resource } from './types.ts';

export const LEGACY_BEHAVIOR_POLICY_VERSION = 'weighted-civilizations-v1';
export const BEHAVIOR_POLICY_VERSION = 'weighted-civilizations-v2';

export type BehaviorPhase = 'survival' | 'recovery' | 'development' | 'expansion' | 'trade' | 'consolidation' | 'director';
export type BehaviorPriority = 'research' | 'construction' | 'civic' | 'expansion' | 'trade' | 'recovery';

export interface BehaviorProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly preferredFocus: Focus;
  readonly resources: Readonly<Record<Resource, number>>;
  readonly priorities: Readonly<Record<BehaviorPriority, number>>;
  readonly commitmentRounds: number;
  readonly settlementGoal: number;
}

export const BEHAVIOR_PROFILES: readonly BehaviorProfile[] = [
  {
    id: 'aster-scholars', name: 'Aster scholars',
    description: 'Favor discoveries and learning, while keeping towns supplied.',
    preferredFocus: 'research',
    resources: { food: 1, materials: 1, energy: 1, credits: 1, science: 2.4, culture: 1 },
    priorities: { research: 1.8, construction: 1, civic: 1, expansion: 0.8, trade: 1, recovery: 1.1 },
    commitmentRounds: 6, settlementGoal: 3,
  },
  {
    id: 'verdant-stewards', name: 'Verdant stewards',
    description: 'Favor food, healthy towns and careful settlement growth.',
    preferredFocus: 'growth',
    resources: { food: 2.1, materials: 1, energy: 0.9, credits: 1, science: 1, culture: 1.2 },
    priorities: { research: 1, construction: 1.2, civic: 1.1, expansion: 1.5, trade: 1, recovery: 1.5 },
    commitmentRounds: 6, settlementGoal: 4,
  },
  {
    id: 'ember-builders', name: 'Ember builders',
    description: 'Favor useful production and the supplies that keep it working.',
    preferredFocus: 'industry',
    resources: { food: 1, materials: 2.2, energy: 1.7, credits: 1.1, science: 1.2, culture: 0.9 },
    priorities: { research: 1.1, construction: 1.8, civic: 1.1, expansion: 1.1, trade: 1.1, recovery: 1.3 },
    commitmentRounds: 5, settlementGoal: 3,
  },
  {
    id: 'pelagos-traders', name: 'Pelagos traders',
    description: 'Favor supplied exchanges and new connections between towns.',
    preferredFocus: 'diplomacy',
    resources: { food: 1, materials: 1, energy: 1.2, credits: 2, science: 1, culture: 1.1 },
    priorities: { research: 1, construction: 1, civic: 1.2, expansion: 1.2, trade: 2.3, recovery: 1.1 },
    commitmentRounds: 5, settlementGoal: 4,
  },
  {
    id: 'vesper-custodians', name: 'Vesper custodians',
    description: 'Favor culture, civic institutions and lasting shared places.',
    preferredFocus: 'culture',
    resources: { food: 1.1, materials: 1, energy: 0.9, credits: 1, science: 1.1, culture: 2.4 },
    priorities: { research: 1, construction: 1.2, civic: 1.9, expansion: 0.9, trade: 1.1, recovery: 1.2 },
    commitmentRounds: 7, settlementGoal: 3,
  },
];

export function behaviorSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function civilizationBehaviorProfile(seed: number, seat: number): BehaviorProfile {
  const authored = BEHAVIOR_PROFILES[seat];
  if (!Number.isSafeInteger(seed) || !Number.isInteger(seat) || !authored)
    throw new RangeError('A behavior profile requires a valid world seed and civilization seat');
  const variation = (key: string): number => 0.9 + (behaviorSeed(`${seed >>> 0}:${seat}:${key}`) % 201) / 1000;
  const resources = { ...authored.resources };
  const priorities = { ...authored.priorities };
  for (const key of Object.keys(resources) as Resource[]) resources[key] *= variation(key);
  for (const key of Object.keys(priorities) as BehaviorPriority[]) priorities[key] *= variation(key);
  return { ...authored, resources, priorities };
}
