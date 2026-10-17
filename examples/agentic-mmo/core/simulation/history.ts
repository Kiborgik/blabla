import { HISTORICAL_MILESTONES } from '../content.ts';
import type { GameEvent, HistoricalMilestone, MilestoneCondition, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';

export function hasFeatures(state: WorldState, required: readonly string[]): boolean {
  return required.every((feature) => state.unlockedFeatures.includes(feature));
}

function conditionMet(
  state: WorldState,
  events: readonly GameEvent[],
  condition: MilestoneCondition,
): boolean {
  switch (condition.kind) {
    case 'city-count':
      return state.cities.length >= condition.minimum;
    case 'building-count':
      return (
        state.cities.reduce(
          (total, city) =>
            total + city.buildings.filter((building) => building === condition.building).length,
          0,
        ) >= condition.minimum
      );
    case 'recorded-event-count':
      return (
        (state.eventCounts[condition.eventType] ?? 0) +
          events.filter((event) => event.type === condition.eventType).length >=
        condition.minimum
      );
    case 'total-population':
      return state.cities.reduce((total, city) => total + city.population, 0) >= condition.minimum;
    case 'active-routes':
      return state.routes.filter((route) => route.active).length >= condition.minimum;
    case 'event':
      return (
        (state.eventCounts[condition.eventType] ?? 0) > 0 ||
        events.some((event) => event.type === condition.eventType)
      );
    case 'technology':
      return (
        state.civilizations.filter((civilization) =>
          civilization.technologies.includes(condition.technology),
        ).length >= condition.civilizations
      );
    default:
      return false;
  }
}

export function milestoneEligible(
  state: WorldState,
  events: readonly GameEvent[],
  milestone: HistoricalMilestone,
): boolean {
  return (
    !state.calendarMilestones.includes(milestone.id) &&
    hasFeatures(state, milestone.requiredFeatures) &&
    milestone.requiresMilestones.every((id) => state.calendarMilestones.includes(id)) &&
    milestone.conditions.length > 0 &&
    milestone.conditions.every((condition) => conditionMet(state, events, condition))
  );
}

export function resolveHistory(state: WorldState, events: GameEvent[]): void {
  for (const milestone of HISTORICAL_MILESTONES) {
    if (!milestoneEligible(state, events, milestone)) continue;
    for (const civilization of state.civilizations)
      civilization.era = Math.max(civilization.era, milestone.era);
    state.calendarMilestones.push(milestone.id);
    emitEvent(state, events, {
      type: 'history-milestone',
      title: milestone.name,
      detail: milestone.explanation,
      actor: null,
      target: null,
      tileId: null,
      cause: `Released features ${milestone.requiredFeatures.join(', ')} and observed world conditions satisfied ${milestone.id}`,
      effects: [
        `Capability stage ${milestone.era} attained in year ${state.year}`,
        `Historical milestone ${milestone.id} recorded`,
      ],
      importance: 5,
    });
  }
}
