import type { GameEvent, WorldState } from '../types.ts';

export function emitEvent(
  state: WorldState,
  events: GameEvent[],
  description: Omit<GameEvent, 'id' | 'round'>,
): GameEvent {
  const event: GameEvent = {
    ...description,
    id: `${state.revision}:${events.length}`,
    round: state.round,
  };
  events.push(event);
  return event;
}

export function commitEvents(state: WorldState, events: GameEvent[]): void {
  for (const event of events)
    state.eventCounts[event.type] = (state.eventCounts[event.type] ?? 0) + 1;
  state.events = [...state.events, ...events].slice(-96);
}
