import { ECONOMY_RULES } from '../content.ts';
import type { DirectorEventDefinition, EffectDefinition, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';
import { citiesOf, civilizationById, clamp } from './world.ts';

export function directorEffects(state: WorldState, definition: DirectorEventDefinition): readonly EffectDefinition[] {
  const released = definition.releasedEffects;
  return released && hasFeatures(state, released.requiredFeatures) ? released.effects : definition.effects;
}

export function applyEffects(
  state: WorldState,
  target: number,
  effects: readonly EffectDefinition[],
  cityId?: string,
): string[] {
  const civilization = civilizationById(state, target);
  const changes: string[] = [];
  for (const effect of effects) {
    switch (effect.kind) {
      case 'resource': {
        const before = civilization.resources[effect.resource];
        civilization.resources[effect.resource] = clamp(before + effect.amount, 0);
        changes.push(
          `${civilization.name} ${effect.resource} ${before} → ${civilization.resources[effect.resource]}`,
        );
        break;
      }
      case 'civilization': {
        const before = civilization[effect.field];
        civilization[effect.field] = clamp(
          before + effect.amount,
          0,
          effect.field === 'legitimacy' ? 100 : Number.MAX_SAFE_INTEGER,
        );
        changes.push(
          `${civilization.name} ${effect.field} ${before} → ${civilization[effect.field]}`,
        );
        break;
      }
      case 'city': {
        for (const city of citiesOf(state, target).filter(
          (candidate) => !cityId || candidate.id === cityId,
        )) {
          const before = city[effect.field];
          const minimum = effect.field === 'population' ? 1 : 0;
          const maximum =
            effect.field === 'wellbeing' || effect.field === 'damage'
              ? 100
              : Number.MAX_SAFE_INTEGER;
          city[effect.field] = clamp(before + effect.amount, minimum, maximum);
          changes.push(`${city.name} ${effect.field} ${before} → ${city[effect.field]}`);
        }
        break;
      }
      case 'route': {
        for (const route of state.routes.filter(
          (candidate) => candidate.owner === target || candidate.partner === target,
        )) {
          const before = route.damage;
          route.damage = clamp(before + effect.amount, 0, 100);
          if (route.damage >= ECONOMY_RULES.trade.damageDisableAt) route.active = false;
          changes.push(`Route ${route.id} damage ${before} → ${route.damage}`);
        }
        break;
      }
    }
  }
  return changes;
}
