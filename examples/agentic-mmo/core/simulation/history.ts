import type { ConnectionWitness, LandIntegrationWitness } from '../land-integration-types.ts';
import { selectLandIntegration } from './land-integration.ts';
import { borderFieldPopulation } from './border-incidents.ts';
import { industrialEvidenceComplete } from './industrial-evidence.ts';
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
  landIntegration?: LandIntegrationWitness,
): boolean {
  switch (condition.kind) {
    case 'earned-land-integration':
      return landIntegration !== undefined;
    case 'industrial-evidence':
      return industrialEvidenceComplete(state);
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
      return state.cities.reduce((total, city) => total + city.population, 0) + state.civilizations.reduce((total, actor) => total + borderFieldPopulation(state, actor.id), 0) >= condition.minimum;
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

interface MilestoneSelection {
  requiredFeatures: readonly string[];
  connection?: ConnectionWitness;
}

function selectMilestoneEvidence(
  state: WorldState,
  events: readonly GameEvent[],
  milestone: HistoricalMilestone,
): MilestoneSelection | null {
  if (state.calendarMilestones.includes(milestone.id)
    || !milestone.requiresMilestones.every(id => state.calendarMilestones.includes(id))) return null;
  if (hasFeatures(state, milestone.requiredFeatures) && milestone.conditions.length > 0
    && milestone.conditions.every(condition => conditionMet(state, events, condition))) {
    return { requiredFeatures: milestone.requiredFeatures,
      ...(milestone.id === 'connected-world' && hasFeatures(state, ['earned-land-integration']) ? { connection: { kind: 'coastal' as const } } : {}),
    };
  }
  const alternative = milestone.alternative;
  if (!alternative || !hasFeatures(state, alternative.requiredFeatures) || alternative.conditions.length === 0) return null;
  const landIntegration = selectLandIntegration(state, events);
  if (!landIntegration || !alternative.conditions.every(condition => conditionMet(state, events, condition, landIntegration))) return null;
  return { requiredFeatures: alternative.requiredFeatures, connection: landIntegration };
}

export function milestoneEligible(
  state: WorldState,
  events: readonly GameEvent[],
  milestone: HistoricalMilestone,
): boolean {
  return selectMilestoneEvidence(state, events, milestone) !== null;
}

function landIntegrationExplanation(state: WorldState, witness: LandIntegrationWitness): string {
  const town = (id: string): string => {
    const city = state.cities.find(candidate => candidate.id === id);
    return city ? `${city.name} (${city.id})` : id;
  };
  const { founding, delivery } = witness;
  return `${town(founding.foundedCityId)} was ordinarily founded from ${town(founding.sourceCityId)} with ${founding.population} transferred people and paid founding supplies. Its actual paid land exchange connected ${town(delivery.fromCityId)} and ${town(delivery.toCityId)} on ${delivery.routeId}, delivery ${delivery.eventId}.`;
}

export function resolveHistory(state: WorldState, events: GameEvent[]): void {
  for (const milestone of HISTORICAL_MILESTONES) {
    const selected = selectMilestoneEvidence(state, events, milestone);
    if (!selected) continue;
    const landIntegration = selected.connection?.kind === 'land' ? selected.connection : null;
    for (const civilization of state.civilizations)
      civilization.era = Math.max(civilization.era, milestone.era);
    state.calendarMilestones.push(milestone.id);
    const event = emitEvent(state, events, {
      type: 'history-milestone',
      ...(landIntegration ? { landIntegration: structuredClone(landIntegration) } : {}),
      title: milestone.name,
      detail: landIntegration ? landIntegrationExplanation(state, landIntegration) : milestone.explanation,
      actor: null,
      target: null,
      tileId: landIntegration?.founding.destinationTileId ?? null,
      cause: landIntegration
        ? `Ordinary founding ${landIntegration.founding.eventId} and successful paid land delivery ${landIntegration.delivery.eventId} satisfied ${milestone.id}`
        : `Released features ${selected.requiredFeatures.join(', ')} and observed world conditions satisfied ${milestone.id}`,
      effects: [
        `Capability stage ${milestone.era} attained in year ${state.year}`,
        `Historical milestone ${milestone.id} recorded`,
        ...(landIntegration ? [`Founding ${landIntegration.founding.sourceCityId} → ${landIntegration.founding.foundedCityId}; paid exchange ${landIntegration.delivery.fromCityId} ↔ ${landIntegration.delivery.toCityId}`, 'The calendar changes only through its separate earned history advance'] : []),
      ],
      importance: 5,
    });
    if (hasFeatures(state, ['earned-history'])) {
      state.milestoneProofs ??= {};
      state.milestoneProofs[milestone.id] = { ruleVersion: 1, milestoneId: milestone.id, round: state.round, revision: state.revision, eventId: event.id, year: state.year, targetYear: milestone.year, era: milestone.era,
        ...(selected.connection ? { connection: structuredClone(selected.connection) } : {}),
      };
    }
  }
}

export function nextEarnedHistoryAdvance(state: WorldState, timestamp: string): import('../types.ts').HistoryAdvanceCommand | null {
  if (state.outcome || !hasFeatures(state, ['earned-history'])) return null;
  const proof = Object.values(state.milestoneProofs ?? {}).filter(proof => !state.historyAdvances?.[`milestone:${proof.milestoneId}`] && state.calendarMilestones.includes(proof.milestoneId)).toSorted((left, right) => right.targetYear - left.targetYear || (left.milestoneId < right.milestoneId ? -1 : left.milestoneId > right.milestoneId ? 1 : 0))[0];
  if (!proof) return null;
  return { expectedRevision: state.revision, cause: { kind: 'milestone', id: proof.milestoneId }, reason: `Actual earned ${proof.milestoneId} advances the calendar to its authored historical threshold`, deltaYears: Math.max(0, proof.targetYear - state.year), timestamp };
}
