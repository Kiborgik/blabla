import { DISTRICT_RULES, IMPROVEMENT_RULES, FEATURES, METAL_RULES, RESEARCH_INVESTMENT_RULES } from '../content.ts';
import { createStrategicDeposits } from './metals.ts';
import { RELEASES } from '../release.ts';
import {
  DIRECTOR_SEAT,
  type GameEvent,
  type HistoryAdvanceCommand,
  type ReleaseApplyCommand,
  type TransitionResult,
  type WorldState,
} from '../types.ts';
import { parseUtcTimestamp } from './clock.ts';
import { commitEvents, emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { createIndependentTurns, strategyTimingError } from './turns.ts';

function rejected(state: WorldState, error: string): TransitionResult {
  return { ok: false, state, events: [], error };
}

function validRevision(state: WorldState, revision: number): boolean {
  return (
    !state.outcome &&
    Number.isSafeInteger(revision) &&
    revision === state.revision &&
    Number.isSafeInteger(revision + 1)
  );
}

export function applyHistoryAdvance(
  state: WorldState,
  command: HistoryAdvanceCommand,
): TransitionResult {
  if (
    typeof command !== 'object' ||
    command === null ||
    !validRevision(state, command.expectedRevision) ||
    !hasFeatures(state, ['history-advancement']) ||
    typeof command.cause !== 'object' ||
    command.cause === null ||
    !['feature', 'event'].includes(command.cause.kind) ||
    typeof command.cause.id !== 'string' ||
    command.cause.id.trim().length === 0 ||
    command.cause.id.length > 128 ||
    typeof command.reason !== 'string' ||
    command.reason.trim().length === 0 ||
    command.reason.length > 1000 ||
    !Number.isSafeInteger(command.deltaYears) ||
    command.deltaYears < 0 ||
    !Number.isSafeInteger(state.year) ||
    !Number.isSafeInteger(state.year + command.deltaYears) ||
    parseUtcTimestamp(command.timestamp) === null
  ) {
    return rejected(
      state,
      'History advancement requires a released capability and valid explicit intent',
    );
  }
  const key = `${command.cause.kind}:${command.cause.id}`;
  if (state.historyAdvances && Object.hasOwn(state.historyAdvances, key))
    return rejected(state, 'This historical cause was already committed');
  const evidence: string[] = [];
  if (command.cause.kind === 'feature') {
    const feature = FEATURES.find((candidate) => candidate.id === command.cause.id);
    if (!feature || !hasFeatures(state, [feature.id]))
      return rejected(state, 'History advancement references no released feature');
    evidence.push(
      `Released feature ${feature.id}: ${feature.name}`,
      `World release ${state.releaseId}`,
    );
  } else {
    const event = state.events.find((candidate) => candidate.id === command.cause.id);
    if (!event) return rejected(state, 'History advancement references no recorded event');
    evidence.push(
      `Event ${event.id}: ${event.type}: ${event.title}`,
      `Cause: ${event.cause}`,
      ...event.effects,
    );
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  next.year += command.deltaYears;
  next.historyAdvances ??= {};
  next.historyAdvances[key] = {
    cause: { ...command.cause },
    reason: command.reason,
    deltaYears: command.deltaYears,
    timestamp: command.timestamp,
    revision: next.revision,
    yearBefore: state.year,
    yearAfter: next.year,
    evidence,
  };
  emitEvent(next, events, {
    type: 'history-advanced',
    title: 'An intentional historical transition',
    detail: command.reason,
    actor: DIRECTOR_SEAT,
    target: null,
    tileId: null,
    cause: `${command.cause.kind} ${command.cause.id} justified an explicit advancement at ${command.timestamp}`,
    effects: [
      `Calendar ${state.year} → ${next.year}`,
      `Reason: ${command.reason}`,
      'Authoritative clock accounting and released capabilities remain unchanged',
    ],
    importance: 5,
  });
  commitEvents(next, events);
  return { ok: true, state: next, events };
}

export function applyRelease(state: WorldState, command: ReleaseApplyCommand): TransitionResult {
  if (
    typeof command !== 'object' ||
    command === null ||
    !validRevision(state, command.expectedRevision) ||
    command.expectedFromReleaseId !== state.releaseId
  ) {
    return rejected(state, 'Release application requires the current revision and source release');
  }
  const source = RELEASES.find((release) => release.id === state.releaseId);
  const target = RELEASES.find((release) => release.id === command.targetReleaseId);
  if (
    !source ||
    !target ||
    target.id === source.id ||
    !target.compatibleFrom.includes(source.id) ||
    source.schemaVersion !== state.schemaVersion ||
    target.schemaVersion !== state.schemaVersion ||
    source.gameVersion !== state.gameVersion ||
    target.gameVersion !== state.gameVersion ||
    state.unlockedFeatures.length !== source.featureIds.length ||
    new Set(state.unlockedFeatures).size !== state.unlockedFeatures.length ||
    !source.featureIds.every((feature) => state.unlockedFeatures.includes(feature)) ||
    !state.unlockedFeatures.every((feature) => target.featureIds.includes(feature))
  ) {
    return rejected(
      state,
      'Release target is unknown, incompatible, nonadditive or not a registered successor',
    );
  }
  const startsIndependent =
    target.featureIds.includes('independent-actions') &&
    !source.featureIds.includes('independent-actions');
  if (
    startsIndependent &&
    (command.timestamp === undefined || parseUtcTimestamp(command.timestamp) === null)
  )
    return rejected(state, 'Independent release activation requires an explicit UTC epoch');
  if (['resident-capacity', RESEARCH_INVESTMENT_RULES.featureId, DISTRICT_RULES.featureId, IMPROVEMENT_RULES.featureId, METAL_RULES.featureId].some(feature => target.featureIds.includes(feature) && !source.featureIds.includes(feature))) {
    const timingError = strategyTimingError(state, command.timestamp);
    if (timingError) return rejected(state, timingError);
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  next.releaseId = target.id;
  next.unlockedFeatures = [...target.featureIds];
  if (target.featureIds.includes(METAL_RULES.featureId) && !source.featureIds.includes(METAL_RULES.featureId)) {
    next.strategicDeposits = createStrategicDeposits(next);
    for (const civilization of next.civilizations) civilization.strategicResources = {};
  }
  if (startsIndependent && command.timestamp !== undefined)
    next.independentTurns = createIndependentTurns(command.timestamp);
  if (target.featureIds.includes('bounded-plans') && !source.featureIds.includes('bounded-plans'))
    next.actionPlans = Array.from({ length: DIRECTOR_SEAT + 1 }, () => null);
  if (target.featureIds.includes('public-projects') && !source.featureIds.includes('public-projects')) next.publicProjects = [];
  const added = target.featureIds.filter((feature) => !source.featureIds.includes(feature));
  emitEvent(next, events, {
    type: 'release-applied',
    title: 'The world gains released capabilities',
    detail: `${source.id} → ${target.id}`,
    actor: DIRECTOR_SEAT,
    target: null,
    tileId: null,
    cause: `Registered compatible successor ${target.id} explicitly applied to ${source.id}`,
    effects: [
      `Released capabilities added: ${added.join(', ')}`,
      'Existing world assets, history and clock accounting are preserved',
    ],
    importance: 5,
  });
  commitEvents(next, events);
  return { ok: true, state: next, events };
}
