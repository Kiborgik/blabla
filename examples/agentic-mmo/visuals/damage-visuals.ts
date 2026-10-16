import type { VisualBadge, VisualPart } from './world-visuals.ts';

export interface DamageCondition extends VisualBadge { text: string }

export function damageCondition(damage: number): DamageCondition | null {
  return damage > 0 && Number.isFinite(damage) ? { icon: 'damage', label: 'Damage', value: damage, text: `${damage}% damage` } : null;
}

export function damageParts(damage: number): VisualPart[] {
  if (!damageCondition(damage)) return [];
  const length = .32 + damage * .0015;
  return [
    { id: 'damage-mark-base', shape: 'box', material: 'water', position: [0, .04, 1.2], scale: [.65, .04, .85], rotation: 0 },
    { id: 'damage-mark-left', shape: 'box', material: 'negative', position: [-.08, .09, 1.08], scale: [.14, .05, length], rotation: -.45 },
    { id: 'damage-mark-right', shape: 'box', material: 'negative', position: [.04, .09, 1.08 + length * .55], scale: [.14, .05, length], rotation: .45 },
  ];
}

export function damageMapLabel(cityName: string, damage: number): string {
  const condition = damageCondition(damage);
  return condition ? `${cityName} · ${condition.text}` : cityName;
}
