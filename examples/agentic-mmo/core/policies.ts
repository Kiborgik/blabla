import { applyCommand, createWorld, legalActions } from './engine.ts';
import {
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type CampaignReplay,
  type GameAction,
  type WorldState,
} from './types.ts';

export function chooseAction(
  state: WorldState,
  seat: number,
  scenario: 'mars' | 'federation' | 'balanced' = 'balanced',
  timestamp?: string,
): GameAction {
  const choices = legalActions(state, seat, timestamp);
  const civilization = state.civilizations.find((candidate) => candidate.id === seat);
  if (seat === DIRECTOR_SEAT) {
    const event = choices.filter((choice) => choice.action.type === 'event');
    return (
      event[(state.round + state.seed) % Math.max(1, event.length)]?.action ?? { type: 'wait' }
    );
  }
  if (!civilization) return { type: 'wait' };
  const ownCities = state.cities.filter((city) => city.civId === seat);
  const population = ownCities.reduce((total, city) => total + city.population, 0);
  const foodRisk = civilization.resources.food < population * 2;
  const farm = choices.find(
    (choice) => choice.action.type === 'build' && choice.action.project === 'farm',
  );
  if (foodRisk && farm) return farm.action;
  const research = choices.find((choice) => choice.action.type === 'research');
  if (research) return research.action;
  const building = choices.find((choice) => choice.action.type === 'build');
  if (building) return building.action;
  const repair = choices.find((choice) => choice.action.type === 'repair');
  if (repair) return repair.action;
  const response = choices.find(
    (choice) => choice.action.type === 'respond-trade' && choice.action.accept,
  );
  if (response) return response.action;
  const trade = choices.find((choice) => choice.action.type === 'propose-trade');
  if (trade) return trade.action;
  const expansion = choices.find((choice) => choice.action.type === 'settle');
  if (expansion && !foodRisk) return expansion.action;
  const desired = foodRisk
    ? 'growth'
    : scenario === 'federation'
      ? 'diplomacy'
      : scenario === 'mars'
        ? 'research'
        : ['research', 'growth', 'industry', 'diplomacy', 'culture'][seat];
  const focus = choices.find(
    (choice) => choice.action.type === 'focus' && choice.action.focus === desired,
  );
  return focus?.action ?? { type: 'wait' };
}

export function simulate(
  seed: number,
  roundLimit: number,
  scenario: 'mars' | 'federation' | 'balanced' = 'balanced',
): CampaignReplay {
  if (!Number.isSafeInteger(roundLimit) || roundLimit < 0)
    throw new RangeError('Round budget must be a nonnegative safe integer');
  const initial = createWorld(seed);
  let state = initial;
  const replay: CampaignReplay = {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    seed: initial.seed,
    source: 'builtin-policies',
    title: 'The ongoing settlement world',
    initial,
    frames: [],
    commands: [],
  };
  while (state.round < roundLimit && !state.outcome) {
    const command = {
      seat: state.phase,
      expectedRevision: state.revision,
      action: chooseAction(state, state.phase, scenario),
    };
    const result = applyCommand(state, command);
    if (!result.ok)
      throw new Error(
        `Built-in policy emitted an illegal action: ${result.error ?? 'unknown error'}`,
      );
    replay.commands.push(command);
    replay.frames.push({ state: result.state, events: result.events });
    state = result.state;
  }
  return replay;
}
