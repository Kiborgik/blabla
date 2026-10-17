import type { GameEvent, TechnologyDefinition, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { citiesOf, civilizationById } from './world.ts';

export function completeResearch(state: WorldState, civilizationId: number, technology: TechnologyDefinition, events: GameEvent[], cause?: string): GameEvent {
  const civilization = civilizationById(state, civilizationId);
  civilization.technologies.push(technology.id);
  civilization.researchTarget = '';
  civilization.researchProgress = 0;
  const completed = emitEvent(state, events, {
    type: 'research-completed',
    title: `${civilization.name} discovers ${technology.name}`,
    detail: technology.capability,
    actor: civilizationId,
    target: civilizationId,
    tileId: citiesOf(state, civilizationId)[0]?.tileId ?? null,
    cause: cause ?? `Working settlements supplied ${technology.cost} science to the research program`,
    effects: [
      `Technology ${technology.id} unlocked`,
      'Capability stages require released milestones; the world clock is independent',
    ],
    importance: 4,
  });
  if (hasFeatures(state, ['recurring-decisions'])) civilization.lastResearchCompletion = { technologyId: technology.id, completedRound: state.round, eventId: completed.id };
  return completed;
}
