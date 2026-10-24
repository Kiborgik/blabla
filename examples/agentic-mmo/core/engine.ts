import { borderFieldPopulation, createBorderState } from './simulation/border-incidents.ts';
import { observedRail } from './simulation/rail.ts';
import { observedGovernment } from './simulation/government.ts';
import { observedTerritory } from './simulation/territory.ts';
import { cityGrowthFacts, initializeCityHousing } from './simulation/growth.ts';
import { observedWonders } from './simulation/wonders.ts';
import type { TradePresentation } from './simulation/trade.ts';
import { observedRecipes, observedResidentCapacity } from './simulation/operations.ts';
import { createCoalDeposits, createStrategicDeposits, observedStrategicResources } from './simulation/metals.ts';
import { createPastoralSites, observedPastoralSites } from './simulation/pastoral.ts';
import { CIVIC_RULES, CIVILIZATIONS, ECONOMY_RULES, INDUSTRIAL_RULES, LOCAL_GROWTH_RULES, METAL_RULES, PASTORAL_RULES, TERRITORY_RULES, WONDER_RULES, WORLD_EXPANSION_RULES, validateContent } from './content.ts';
import { CURRENT_RELEASE, RELEASES } from './release.ts';
import { initializeSpaceflight } from './simulation/spaceflight.ts';
import { createReliefState } from './simulation/relief-charters.ts';
import { createKnowledgeState } from './simulation/knowledge-compacts.ts';
import { completeAttachedPlan, observeActionPlan, validateAttachedPlan } from './planning.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type GameAction,
  type ActionOption,
  type Command,
  type GameEvent,
  type Observation,
  type TransitionResult,
  type WorldState,
} from './types.ts';
import { availableActions, sameAction } from './simulation/choices.ts';
import { executeAction } from './simulation/commands.ts';
import { decisionActionBlock, decisionHoldFacts, decisionObligations } from './simulation/decisions.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import { commitEvents } from './simulation/events.ts';
import { createMap, hexDistance } from './simulation/geography.ts';
import { hasFeatures, resolveHistory } from './simulation/history.ts';
import { normalizeSeed } from './simulation/random.ts';
import { citiesOf, totalPopulation } from './simulation/world.ts';
import {
  admissionError,
  createIndependentTurns,
  finishAction,
  turnAdmission,
  usesIndependentTurns,
} from './simulation/turns.ts';

export { applyDirectorTick, catchUpClock } from './simulation/clock.ts';
export { applyHistoryAdvance } from './simulation/evolution.ts';
export { catchUpStrategy } from './simulation/turns.ts';

export function createWorld(seed: number, clockEpoch?: string, registeredRulesId = CURRENT_RELEASE.id): WorldState {
  const errors = validateContent();
  if (errors.length) throw new Error(`Invalid content: ${errors.join('; ')}`);
  const normalized = normalizeSeed(seed);
  const rules = RELEASES.find(candidate => candidate.id === registeredRulesId);
  if (!rules) throw new RangeError('Fresh worlds require a registered rules ID');
  if (clockEpoch !== undefined && parseUtcTimestamp(clockEpoch) === null)
    throw new RangeError('Clock epoch must be an explicit UTC timestamp');
  if (rules.featureIds.includes('independent-actions') && clockEpoch === undefined)
    throw new RangeError('Independent worlds require an explicit epoch');
  const expanded = rules.featureIds.includes(WORLD_EXPANSION_RULES.featureId);
  const width = expanded ? WORLD_EXPANSION_RULES.width : WORLD_EXPANSION_RULES.fromWidth;
  const height = expanded ? WORLD_EXPANSION_RULES.height : WORLD_EXPANSION_RULES.fromHeight;
  const map = createMap(normalized, width, height);
  const state: WorldState = {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    releaseId: rules.id,
    unlockedFeatures: [...rules.featureIds],
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
  if (usesIndependentTurns(state) && clockEpoch !== undefined) {
    state.independentTurns = createIndependentTurns(clockEpoch);
  }
  if (hasFeatures(state, ['bounded-plans']))
    state.actionPlans = Array.from({ length: DIRECTOR_SEAT + 1 }, () => null);
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
  if (hasFeatures(state, [CIVIC_RULES.featureId])) {
    for (const civilization of state.civilizations) {
      civilization.civics = { ruleVersion: CIVIC_RULES.ruleVersion, completedCivicIds: [], active: null, lastCompleted: null, reformEntitlement: null };
      civilization.government = { ruleVersion: CIVIC_RULES.ruleVersion, lastSpentReformCompletionEventId: null, active: null, pending: null };
    }
  }
  if (hasFeatures(state, [TERRITORY_RULES.featureId])) state.tileAcquisitions = {};
  if (hasFeatures(state, [WONDER_RULES.featureId])) state.wonders = {};
  if (hasFeatures(state, [METAL_RULES.featureId])) {
    state.strategicDeposits = createStrategicDeposits(state);
    for (const civilization of state.civilizations) civilization.strategicResources = {};
  }
  if (hasFeatures(state, [PASTORAL_RULES.featureId])) state.pastoralSites = createPastoralSites(state);
  if (hasFeatures(state, [INDUSTRIAL_RULES.featureId])) {
    state.coalDeposits = createCoalDeposits(state);
    state.railEdges = {};
    state.industrialEvidence = { ruleVersion: INDUSTRIAL_RULES.ruleVersion, foundryOperations: [], steamDelivery: null };
  }
  for (const city of state.cities) initializeCityHousing(state, city, 'initial-capital');
  initializeSpaceflight(state);
  if (hasFeatures(state, ['earned-history'])) state.milestoneProofs = {};
  if (hasFeatures(state, ['public-projects'])) state.publicProjects = [];
  if (hasFeatures(state, ['consented-relief'])) state.relief = createReliefState(state);
  if (hasFeatures(state, ['knowledge-compacts'])) state.knowledge = createKnowledgeState(state);
  if (hasFeatures(state, ['supplied-borders'])) state.border = createBorderState(state);
  const event: GameEvent = {
    id: '0:foundation',
    round: 0,
    type: 'world-founded',
    title: 'Five hearths awaken',
    detail: 'Five independent civilizations begin in a shared settlement world',
    actor: null,
    target: null,
    tileId: null,
    cause: `Seed ${normalized} established geography under release ${rules.id}`,
    effects: [`${CIV_COUNT} civilizations and ${state.cities.length} working settlements created`],
    importance: 5,
  };
  state.events.push(event);
  state.eventCounts[event.type] = 1;
  return state;
}

export function legalActions(state: WorldState, seat: number, timestamp?: string, selectedEvent?: Extract<GameAction, { type: 'event' }>): ActionOption[] {
  return availableActions(state, seat, timestamp, 'full', selectedEvent);
}

export function observe(state: WorldState, seat: number, timestamp?: string, tradePresentation: TradePresentation = 'full'): Observation {
  const civilization = state.civilizations.find((candidate) => candidate.id === seat) ?? null;
  const director = seat === DIRECTOR_SEAT;
  const plan = state.actionPlans?.[seat] ?? null;
  return structuredClone({
    gameVersion: state.gameVersion,
    revision: state.revision,
    round: state.round,
    year: state.year,
    seat,
    activeSeat: usesIndependentTurns(state) ? null : state.phase,
    admission: turnAdmission(state, seat),
    ...(hasFeatures(state, ['bounded-plans'])
      ? { actionPlan: plan === null ? null : observeActionPlan(state, seat, plan, timestamp) }
      : {}),
    ...(!director && hasFeatures(state, ['recurring-decisions']) ? { decisions: decisionObligations(state, seat) } : {}),
    ...(hasFeatures(state, ['building-operations']) ? { buildingRecipes: observedRecipes(director ? state.cities : citiesOf(state, seat)) } : {}),
    ...(hasFeatures(state, ['resident-capacity']) ? { residentCapacity: observedResidentCapacity(director ? state.cities : citiesOf(state, seat)) } : {}),
    ...(hasFeatures(state, [LOCAL_GROWTH_RULES.featureId]) ? { growth: (director ? state.cities : citiesOf(state, seat)).map(city => cityGrowthFacts(state, city)) } : {}),
    civilization,
    ...(!director && civilization && hasFeatures(state, ['civic-bootstrap']) ? { governance: observedGovernment(state, seat) } : {}),
    ...(hasFeatures(state, ['industrial-steam']) ? { rail: observedRail(state, seat, null), industrialEvidence: state.industrialEvidence } : {}),
    ...observedStrategicResources(state, seat),
    ...observedPastoralSites(state, seat),
    ...(hasFeatures(state, ['owned-territory']) ? { territory: observedTerritory(state, seat) } : {}),
    ...(hasFeatures(state, ['unique-wonders']) ? { wonders: observedWonders(state, seat) } : {}),
    cities: director ? state.cities : citiesOf(state, seat),
    rivals: state.civilizations
      .filter((candidate) => candidate.id !== seat)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        era: candidate.era,
        population: totalPopulation(state, candidate.id) + borderFieldPopulation(state, candidate.id),
        objective: candidate.objective,
      })),
    routes: state.routes.filter(
      (route) =>
        (route.agreement?.enabled ?? true) &&
        (director || route.owner === seat || route.partner === seat),
    ),
    treaties: state.treaties.filter((treaty) => director || treaty.a === seat || treaty.b === seat),
    tradeOffers: (state.tradeOffers ?? []).filter(
      (offer) =>
        offer.status === 'pending' &&
        state.round < offer.expiresRound &&
        (director || offer.proposer === seat || offer.recipient === seat),
    ),
    ...(hasFeatures(state, ['consented-relief']) ? { relief: state.relief } : {}),
    ...(hasFeatures(state, ['supplied-borders']) ? { border: structuredClone(state.border) } : {}),
    ...(hasFeatures(state, ['knowledge-compacts']) ? { knowledge: structuredClone(state.knowledge) } : {}),
    ...(hasFeatures(state, ['public-projects']) ? { publicProjects: (state.publicProjects ?? []).filter((project) => director || project.proposer === seat || project.recipient === seat) } : {}),
    recentEvents: state.events.slice(-12),
    legalActions: availableActions(state, seat, timestamp, tradePresentation),
    outcome: state.outcome,
  });
}

function refuseAction(
  state: WorldState,
  command: unknown,
  code: string,
  reason: string,
  status: 'failed' | 'blocked' = 'failed',
): TransitionResult {
  const attached = typeof command === 'object' && command !== null && 'plan' in command
    && command.plan !== undefined && (!Array.isArray(command.plan) || command.plan.length > 0);
  return {
    ok: false,
    state,
    events: [],
    error: reason,
    ...(hasFeatures(state, ['bounded-plans']) || attached
      ? { actionOutcome: { status, code, reason } }
      : {}),
  };
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
    !Number.isSafeInteger(state.revision + 1)
  ) {
    return refuseAction(state, command, 'invalid_command', 'Command is terminal, out of turn, or has an invalid revision or seat');
  }
  const planning = validateAttachedPlan(state, command, command.plan);
  if (!planning.ok) return refuseAction(state, command, planning.code, planning.error);
  const denied = admissionError(state, command.seat, command.timestamp);
  if (denied) return refuseAction(state, command,
    denied.startsWith('strategy_catchup_required:') ? 'strategy_catchup_required' : 'action_admission_blocked',
    denied, 'blocked');
  const decisionBlock = decisionActionBlock(state, command.seat, command.action);
  if (decisionBlock) return refuseAction(state, command, command.action.type === 'wait' ? 'required_decisions' : 'active_commitment', decisionBlock, 'blocked');
  const available = legalActions(state, command.seat, command.timestamp, command.action.type === 'event' ? command.action : undefined);
  if (!available.some((choice) => sameAction(choice.action, command.action))) {
    return refuseAction(state, command, 'illegal_action', 'Action is not legal in the current released world');
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  executeAction(next, command.seat, command.action, events);
  finishAction(next, command, events);
  resolveHistory(next, events);
  commitEvents(next, events);
  if (hasFeatures(next, ['bounded-plans'])) {
    next.actionPlans ??= Array.from({ length: DIRECTOR_SEAT + 1 }, () => null);
    next.actionPlans[command.seat] = completeAttachedPlan(planning.plan, command.observedRevision ?? command.expectedRevision, next.revision);
    return {
      ok: true,
      state: next,
      events,
      actionOutcome: { status: 'completed', code: 'action_completed', reason: `Action accepted at revision ${next.revision}${command.action.type === 'wait' && command.seat !== DIRECTOR_SEAT && hasFeatures(next, ['recurring-decisions']) ? `; ${decisionHoldFacts(next, command.seat).join('; ')}` : ''}` },
    };
  }
  return { ok: true, state: next, events };
}
