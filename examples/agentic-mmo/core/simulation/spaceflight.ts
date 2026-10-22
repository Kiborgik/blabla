import { BUILDINGS, RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../content.ts';
import type { Civilization, GameAction, GameEvent, MarsArrivalReceipt, MarsCivilizationState, MarsHabitatReceipt, MarsMission, MarsMissionKind, MarsMissionQuote, MarsUpkeepReceipt, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { canAfford, transferCost } from './world.ts';

type Expedition = Extract<GameAction, { type: 'expedition' }>;

function emptyResources(): Resources {
  return { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
}

function resourceAmounts(resources: Partial<Resources>): string {
  return RESOURCE_IDS.filter(resource => (resources[resource] ?? 0) > 0).map(resource => `${resources[resource]} ${resource}`).join(', ') || 'none';
}

function missionQuote(state: WorldState, civId: number, cityId: string, mission: MarsMissionKind): MarsMissionQuote | null {
  const civilization = state.civilizations.find(candidate => candidate.id === civId);
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === civId);
  if (!civilization || !city || (mission !== 'settle' && mission !== 'resupply')) return null;
  const recipe = SPACEFLIGHT_RULES[mission];
  const settlers = mission === 'settle' ? SPACEFLIGHT_RULES.settlers : Math.max(0, VICTORY_RULES.mars.population - civilization.marsPopulation);
  const totalCost: Partial<Resources> = {};
  for (const resource of RESOURCE_IDS) {
    const amount = (Reflect.get(recipe.launchCost, resource) ?? 0) + (Reflect.get(recipe.cargo, resource) ?? 0);
    if (amount > 0) totalCost[resource] = amount;
  }
  return {
    ruleVersion: SPACEFLIGHT_RULES.ruleVersion, civId, mission, sourceCityId: cityId,
    departureRound: state.round, arrivalRound: state.round + SPACEFLIGHT_RULES.flightRounds, settlers,
    launchCost: { ...recipe.launchCost }, cargo: { ...recipe.cargo }, totalCost,
    sourcePopulationBefore: city.population, sourcePopulationAfter: city.population - settlers,
  };
}

export function initializeSpaceflight(state: WorldState): void {
  if (!state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId) || state.spaceflight) return;
  state.spaceflight = {
    ruleVersion: SPACEFLIGHT_RULES.ruleVersion,
    civilizations: Array.from({ length: state.civilizations.length }, () => ({
      missionsLaunched: 0, activeMission: null, colony: null, lastDeparture: null, lastArrival: null, lastUpkeep: null, lastHabitatWork: null,
    })),
  };
}

export function spaceflightActionBlock(state: WorldState, civId: number, action: Expedition): string | null {
  if (!state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId)) return 'Interplanetary missions are not released';
  if (state.outcome) return 'A completed world admits no new mission';
  if (!action || action.type !== 'expedition' || (action.mission !== 'settle' && action.mission !== 'resupply')) return 'Choose a settlement or resupply mission from an exact source town';
  const civilization = state.civilizations.find(candidate => candidate.id === civId);
  const ledger = state.spaceflight?.civilizations[civId];
  if (!civilization || !Number.isSafeInteger(civId) || !ledger || state.spaceflight?.ruleVersion !== SPACEFLIGHT_RULES.ruleVersion) return 'The civilization has no initialized spaceflight ledger';
  if (civilization.era < VICTORY_RULES.mars.minEra || !civilization.technologies.includes(VICTORY_RULES.mars.requiredTechnology)) return 'Missions require earned interplanetary ground preparation and Spaceflight research';
  if (ledger.activeMission) return 'This civilization already has a mission in transit';
  if ((action.mission === 'settle') === (ledger.colony !== null)) return action.mission === 'settle' ? 'An established colony needs resupply, not another founding mission' : 'Resupply requires an established colony';
  const city = state.cities.find(candidate => candidate.id === action.cityId && candidate.civId === civId);
  if (!city?.buildings.includes(VICTORY_RULES.mars.requiredBuilding)) return 'The exact owned source town needs a completed Launch complex';
  const definition = BUILDINGS.find(building => building.id === VICTORY_RULES.mars.requiredBuilding);
  const requiredPower = definition?.localPowerInput ?? 0;
  const operation = city.buildingOperations?.[VICTORY_RULES.mars.requiredBuilding];
  const powered = city.localPower?.lastBeat;
  const receipt = powered?.operations.find(candidate => candidate.buildingId === VICTORY_RULES.mars.requiredBuilding);
  if (!operation?.enabled || operation.lastResult?.status !== 'operated' || operation.lastResult.round !== state.round
    || requiredPower <= 0 || (operation.lastResult.localPower?.consumed ?? 0) < requiredPower
    || powered?.round !== state.round || receipt?.result.status !== 'operated'
    || receipt.result.operationEventId !== operation.lastResult.operationEventId
    || receipt.result.localPower.consumed < requiredPower)
    return 'The exact Launch complex must operate with local Power in the current strategic round';
  const quote = missionQuote(state, civId, action.cityId, action.mission);
  if (!quote || !Number.isSafeInteger(state.round) || state.round < 0 || !Number.isSafeInteger(quote.arrivalRound)
    || !Number.isSafeInteger(ledger.missionsLaunched + 1)) return 'The mission would exceed safe round or mission accounting';
  if (quote.sourcePopulationAfter < SPACEFLIGHT_RULES.minimumSourcePopulation) return `The source town must retain at least ${SPACEFLIGHT_RULES.minimumSourcePopulation} residents after sending ${quote.settlers} settlers`;
  if (!RESOURCE_IDS.every(resource => Number.isFinite(civilization.resources[resource]) && civilization.resources[resource] >= (quote.totalCost[resource] ?? 0)))
    return `The full launch and cargo must be funded together: ${resourceAmounts(quote.totalCost)}`;
  return null;
}

export function quoteMarsMission(state: WorldState, civId: number, cityId: string, mission: MarsMissionKind): MarsMissionQuote | null {
  const action: Expedition = { type: 'expedition', cityId, mission };
  return spaceflightActionBlock(state, civId, action) ? null : missionQuote(state, civId, cityId, mission);
}

export function availableSpaceMissions(state: WorldState, civId: number): MarsMissionQuote[] {
  if (!state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId)) return [];
  const mission = state.spaceflight?.civilizations[civId]?.colony ? 'resupply' : 'settle';
  return state.cities.filter(city => city.civId === civId).toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .flatMap(city => { const quote = quoteMarsMission(state, civId, city.id, mission); return quote ? [quote] : []; });
}

export function launchMarsMission(state: WorldState, civId: number, action: Expedition, events: GameEvent[]): void {
  const blocker = spaceflightActionBlock(state, civId, action);
  if (blocker) throw new RangeError(blocker);
  const quote = missionQuote(state, civId, action.cityId, action.mission);
  const civilization = state.civilizations.find(candidate => candidate.id === civId);
  const city = state.cities.find(candidate => candidate.id === action.cityId && candidate.civId === civId);
  const ledger = state.spaceflight?.civilizations[civId];
  if (!quote || !civilization || !city || !ledger) throw new RangeError('The validated mission lost its exact source or manifest');
  transferCost(civilization.resources, quote.totalCost);
  city.population = quote.sourcePopulationAfter;
  ledger.missionsLaunched += 1;
  const id = `mars-${civId}-${ledger.missionsLaunched}`;
  const event = emitEvent(state, events, {
    type: 'mars-departed', title: `${civilization.name} launches a Mars ${action.mission === 'settle' ? 'settlement' : 'resupply'} mission`, detail: id,
    actor: civId, target: civId, tileId: city.tileId,
    cause: `Completed research and the current powered Launch complex in ${city.id} enabled a fully prepaid manifest`,
    effects: [`Launch consumed ${resourceAmounts(quote.launchCost)}`, `Cargo reserved ${resourceAmounts(quote.cargo)}`, `${quote.settlers} residents departed ${city.name}; ${city.population} remain`, `Arrival due round ${quote.arrivalRound}`, 'No settlers, habitat or cargo arrive immediately'], importance: 4,
  });
  const manifest: MarsMission = { ...quote, id, eventId: event.id, paid: { ...quote.totalCost } };
  ledger.activeMission = structuredClone(manifest);
  ledger.lastDeparture = structuredClone(manifest);
  event.marsDeparture = structuredClone(manifest);
}

function arrive(state: WorldState, civilization: Civilization, ledger: MarsCivilizationState, events: GameEvent[]): void {
  const mission = ledger.activeMission;
  if (!mission || state.round < mission.arrivalRound) return;
  ledger.colony ??= { establishedRound: state.round, stock: emptyResources(), shortageRounds: 0 };
  const stockBefore = { ...ledger.colony.stock };
  const populationBefore = civilization.marsPopulation;
  for (const resource of RESOURCE_IDS) ledger.colony.stock[resource] += mission.cargo[resource] ?? 0;
  civilization.marsPopulation += mission.settlers;
  ledger.activeMission = null;
  const event = emitEvent(state, events, {
    type: 'mars-arrived', title: `${civilization.name}'s prepaid mission reaches Mars`, detail: mission.id,
    actor: civilization.id, target: civilization.id, tileId: null,
    cause: `Manifest ${mission.id} from ${mission.sourceCityId} completed its transit from round ${mission.departureRound}`,
    effects: [`${mission.settlers} existing settlers transferred from transit to Mars`, `Delivered ${resourceAmounts(mission.cargo)}`, `Mars population ${populationBefore} → ${civilization.marsPopulation}`, 'No Earth resources charged at arrival'], importance: 4,
  });
  const receipt: MarsArrivalReceipt = {
    ruleVersion: SPACEFLIGHT_RULES.ruleVersion, missionId: mission.id, civId: civilization.id, sourceCityId: mission.sourceCityId,
    round: state.round, eventId: event.id, settlers: mission.settlers, cargo: { ...mission.cargo },
    populationBefore, populationAfter: civilization.marsPopulation, stockBefore, stockAfter: { ...ledger.colony.stock },
  };
  ledger.lastArrival = structuredClone(receipt); event.marsArrival = structuredClone(receipt);
}

function supportColony(state: WorldState, civilization: Civilization, ledger: MarsCivilizationState, events: GameEvent[]): boolean {
  const colony = ledger.colony;
  if (!colony || (ledger.lastUpkeep && ledger.lastUpkeep.round >= state.round)) return false;
  const stockBefore = { ...colony.stock };
  const populationBefore = civilization.marsPopulation;
  const supplyStreakBefore = civilization.marsSupplyStreak;
  const shortageRoundsBefore = colony.shortageRounds;
  const habitableBefore = civilization.marsProgress >= SPACEFLIGHT_RULES.habitat.requiredWork;
  const continuous = ledger.lastUpkeep?.round === state.round - 1;
  const required = populationBefore > 0 ? { ...VICTORY_RULES.mars.upkeep } : {};
  const missing: Partial<Resources> = {};
  for (const resource of RESOURCE_IDS) {
    const deficit = (required[resource] ?? 0) - colony.stock[resource];
    if (deficit > 0) missing[resource] = deficit;
  }
  const status = populationBefore === 0 ? 'uninhabited' : Object.keys(missing).length ? 'shortage' : 'supplied';
  const paid = status === 'supplied' ? { ...required } : {};
  if (status === 'supplied') {
    transferCost(colony.stock, paid);
    colony.shortageRounds = 0;
    civilization.marsSupplyStreak = habitableBefore ? (continuous ? supplyStreakBefore : 0) + 1 : 0;
  } else {
    civilization.marsSupplyStreak = 0;
    colony.shortageRounds = status === 'shortage' ? (continuous ? shortageRoundsBefore : 0) + 1 : 0;
    if (status === 'shortage' && colony.shortageRounds % SPACEFLIGHT_RULES.shortage.populationLossEvery === 0)
      civilization.marsPopulation = Math.max(0, civilization.marsPopulation - SPACEFLIGHT_RULES.shortage.populationLoss);
  }
  const event = emitEvent(state, events, {
    type: 'mars-upkeep', title: `${civilization.name}'s Mars colony is ${status}`, detail: `Mars support at strategic round ${state.round}`,
    actor: civilization.id, target: civilization.id, tileId: null,
    cause: 'Only delivered off-world reserves can fund each complete colony upkeep recipe; Earth stock remains separate',
    effects: [`Required ${resourceAmounts(required)}`, `Paid ${resourceAmounts(paid)}`, `Missing ${resourceAmounts(missing)}`, `Mars population ${populationBefore} → ${civilization.marsPopulation}`, `Consecutive habitable supply ${supplyStreakBefore} → ${civilization.marsSupplyStreak}`], importance: status === 'shortage' ? 4 : 2,
  });
  const receipt: MarsUpkeepReceipt = {
    ruleVersion: SPACEFLIGHT_RULES.ruleVersion, civId: civilization.id, round: state.round, eventId: event.id,
    status, required, paid, missing, stockBefore, stockAfter: { ...colony.stock }, populationBefore, populationAfter: civilization.marsPopulation,
    habitableBefore, supplyStreakBefore, supplyStreakAfter: civilization.marsSupplyStreak, shortageRoundsBefore, shortageRoundsAfter: colony.shortageRounds,
  };
  ledger.lastUpkeep = structuredClone(receipt); event.marsUpkeep = structuredClone(receipt);
  return status === 'supplied';
}

function buildHabitat(state: WorldState, civilization: Civilization, ledger: MarsCivilizationState, events: GameEvent[]): void {
  const colony = ledger.colony; const rules = SPACEFLIGHT_RULES.habitat;
  if (!colony || civilization.marsPopulation <= 0 || civilization.marsProgress >= rules.requiredWork || !canAfford(colony.stock, rules.costPerBeat)) return;
  const progressBefore = civilization.marsProgress;
  transferCost(colony.stock, rules.costPerBeat);
  civilization.marsProgress = Math.min(rules.requiredWork, progressBefore + rules.workPerBeat);
  const event = emitEvent(state, events, {
    type: 'mars-habitat-work', title: `${civilization.name} constructs a supplied Mars habitat`, detail: `Mars habitat at strategic round ${state.round}`,
    actor: civilization.id, target: civilization.id, tileId: null,
    cause: 'Existing settlers paid delivered materials and energy only after full colony upkeep',
    effects: [`Paid ${resourceAmounts(rules.costPerBeat)}`, `Habitat work ${progressBefore} → ${civilization.marsProgress}/${rules.requiredWork}`, 'Completed habitat can begin its sustained supply streak next strategic round'], importance: 3,
  });
  const receipt: MarsHabitatReceipt = {
    ruleVersion: SPACEFLIGHT_RULES.ruleVersion, civId: civilization.id, round: state.round, eventId: event.id,
    paid: { ...rules.costPerBeat }, progressBefore, progressAfter: civilization.marsProgress,
  };
  ledger.lastHabitatWork = structuredClone(receipt); event.marsHabitat = structuredClone(receipt);
}

export function resolveSpaceflight(state: WorldState, events: GameEvent[]): void {
  if (!state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId) || !state.spaceflight || state.outcome) return;
  const civilizations = state.civilizations.toSorted((left, right) => left.id - right.id);
  for (const civilization of civilizations) {
    const ledger = state.spaceflight.civilizations[civilization.id];
    if (ledger) arrive(state, civilization, ledger, events);
  }
  for (const civilization of civilizations) {
    const ledger = state.spaceflight.civilizations[civilization.id];
    if (ledger && supportColony(state, civilization, ledger, events)) buildHabitat(state, civilization, ledger, events);
  }
  const winners = civilizations.filter(civilization => {
    const ledger = state.spaceflight!.civilizations[civilization.id];
    return ledger?.colony && ledger.lastArrival && ledger.lastHabitatWork?.progressAfter === SPACEFLIGHT_RULES.habitat.requiredWork
      && ledger.lastUpkeep?.round === state.round && ledger.lastUpkeep.status === 'supplied' && ledger.lastUpkeep.habitableBefore
      && civilization.era >= VICTORY_RULES.mars.minEra && civilization.technologies.includes(VICTORY_RULES.mars.requiredTechnology)
      && civilization.marsProgress >= VICTORY_RULES.mars.progress && civilization.marsPopulation >= VICTORY_RULES.mars.population
      && civilization.marsSupplyStreak >= VICTORY_RULES.mars.suppliedRounds;
  }).map(civilization => civilization.id);
  if (!winners.length) return;
  const reason = `Paid delivered cargo and conserved settlers supported completed Mars habitats for ${VICTORY_RULES.mars.suppliedRounds} consecutive strategic rounds`;
  state.outcome = { kind: 'mars', winners, round: state.round, reason };
  emitEvent(state, events, {
    type: 'mars-victory', title: 'A sustained human presence on Mars', detail: reason,
    actor: null, target: null, tileId: null, cause: 'All civilizations were evaluated after the same round of arrivals, colony upkeep and paid habitat work',
    effects: winners.map(id => `${state.civilizations.find(civilization => civilization.id === id)!.name}: inhabited, habitable and supplied`), importance: 5,
  });
}
