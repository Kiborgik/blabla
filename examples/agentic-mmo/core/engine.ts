import { CIVILIZATIONS, ECONOMY_RULES, validateContent } from './content.ts';
import { CURRENT_RELEASE } from './release.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type ActionOption,
  type Command,
  type GameEvent,
  type Observation,
  type TransitionResult,
  type WorldState,
} from './types.ts';
import { availableActions, sameAction } from './simulation/choices.ts';
import { executeAction } from './simulation/commands.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import { resolveEconomy } from './simulation/economy.ts';
import { commitEvents } from './simulation/events.ts';
import { createMap, hexDistance } from './simulation/geography.ts';
import { resolveHistory } from './simulation/history.ts';
import { normalizeSeed } from './simulation/random.ts';
import { citiesOf, totalPopulation } from './simulation/world.ts';

export { applyDirectorTick, catchUpClock } from './simulation/clock.ts';

export function createWorld(seed: number, clockEpoch?: string): WorldState {
  const errors = validateContent();
  if (errors.length) throw new Error(`Invalid content: ${errors.join('; ')}`);
  const normalized = normalizeSeed(seed);
  if (clockEpoch !== undefined && parseUtcTimestamp(clockEpoch) === null)
    throw new RangeError('Clock epoch must be an explicit UTC timestamp');
  const width = 18;
  const height = 12;
  const map = createMap(normalized, width, height);
  const state: WorldState = {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    releaseId: CURRENT_RELEASE.id,
    unlockedFeatures: [...CURRENT_RELEASE.featureIds],
    calendarMilestones: [],
    seed: normalized,
    rng: map.seed,
    revision: 0,
    round: 0,
    year: ECONOMY_RULES.initialYear,
    phase: 0,
    width,
    height,
    tiles: map.tiles,
    civilizations: [],
    cities: [],
    routes: [],
    treaties: [],
    events: [],
    eventCounts: {},
    directorIntervals: {},
    clockEpoch: clockEpoch ?? null,
    clockTicks: 0,
    outcome: null,
    climate: 0,
    directorCooldown: 0,
  };
  const anchors = [
    { q: 3, r: 3 },
    { q: 12, r: 2 },
    { q: 4, r: 8 },
    { q: 13, r: 8 },
    { q: 8, r: 5 },
  ];
  for (const [id, definition] of CIVILIZATIONS.entries()) {
    const anchor = anchors[id];
    if (!anchor) throw new RangeError('Starting geography has no civilization site');
    const tile = state.tiles.find(
      (candidate) => candidate.q === anchor.q && candidate.r === anchor.r,
    );
    if (!tile) throw new RangeError('Starting settlement site is missing');
    tile.terrain = 'grassland';
    tile.resource = 'food';
    for (const nearby of state.tiles) {
      if (nearby.owner === null && nearby.terrain !== 'ocean' && hexDistance(nearby, tile) <= 1)
        nearby.owner = id;
    }
    state.civilizations.push({
      id,
      name: definition.name,
      adjective: definition.adjective,
      color: definition.color,
      objective: definition.objective,
      era: 0,
      resources: { ...ECONOMY_RULES.initialResources },
      technologies: [],
      researchTarget: '',
      researchProgress: 0,
      influence: 0,
      legitimacy: ECONOMY_RULES.initialLegitimacy,
      marsProgress: 0,
      marsPopulation: 0,
      marsSupplyStreak: 0,
      federationStreak: 0,
      score: 0,
    });
    state.cities.push({
      id: `city-${id}`,
      name: definition.capital,
      civId: id,
      tileId: tile.id,
      ...ECONOMY_RULES.initialCity,
      focus: definition.focus,
      buildings: [],
    });
  }
  const event: GameEvent = {
    id: '0:foundation',
    round: 0,
    type: 'world-founded',
    title: 'Five hearths awaken',
    detail: 'Five independent civilizations begin in a shared settlement world',
    actor: null,
    target: null,
    tileId: null,
    cause: `Seed ${normalized} established geography under release ${CURRENT_RELEASE.id}`,
    effects: [`${CIV_COUNT} civilizations and ${state.cities.length} working settlements created`],
    importance: 5,
  };
  state.events.push(event);
  state.eventCounts[event.type] = 1;
  return state;
}

export function legalActions(state: WorldState, seat: number): ActionOption[] {
  return availableActions(state, seat);
}

export function observe(state: WorldState, seat: number): Observation {
  const civilization = state.civilizations.find((candidate) => candidate.id === seat) ?? null;
  const director = seat === DIRECTOR_SEAT;
  return structuredClone({
    gameVersion: state.gameVersion,
    revision: state.revision,
    round: state.round,
    year: state.year,
    seat,
    activeSeat: state.phase,
    civilization,
    cities: director ? state.cities : citiesOf(state, seat),
    rivals: state.civilizations
      .filter((candidate) => candidate.id !== seat)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        era: candidate.era,
        population: totalPopulation(state, candidate.id),
        objective: candidate.objective,
      })),
    routes: state.routes.filter(
      (route) => director || route.owner === seat || route.partner === seat,
    ),
    treaties: state.treaties.filter((treaty) => director || treaty.a === seat || treaty.b === seat),
    recentEvents: state.events.slice(-12),
    legalActions: legalActions(state, seat),
    outcome: state.outcome,
  });
}

export function applyCommand(state: WorldState, command: Command): TransitionResult {
  if (
    typeof command !== 'object' ||
    command === null ||
    !Number.isInteger(command.seat) ||
    command.seat < 0 ||
    command.seat > DIRECTOR_SEAT ||
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision !== state.revision ||
    state.outcome ||
    command.seat !== state.phase
  ) {
    return {
      ok: false,
      state,
      events: [],
      error: 'Command is terminal, out of turn, or has an invalid revision or seat',
    };
  }
  const available = legalActions(state, command.seat);
  if (!available.some((choice) => sameAction(choice.action, command.action))) {
    return {
      ok: false,
      state,
      events: [],
      error: 'Action is not legal in the current released world',
    };
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  executeAction(next, command.seat, command.action, events);
  next.phase = (next.phase + 1) % (DIRECTOR_SEAT + 1);
  if (next.phase === 0) {
    next.round += 1;
    if (next.directorCooldown > 0 && command.action.type !== 'event') next.directorCooldown -= 1;
    resolveEconomy(next, events);
  }
  resolveHistory(next, events);
  commitEvents(next, events);
  return { ok: true, state: next, events };
}
