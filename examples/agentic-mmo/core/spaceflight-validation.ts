import { CIV_COUNT, type MarsMission, type MarsArrivalReceipt, type MarsUpkeepReceipt, type MarsHabitatReceipt, type Resources, type WorldState } from './types.ts';
import { HISTORICAL_MILESTONES, RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from './content.ts';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function keys(value: RecordValue, names: string[]): boolean { return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function eventId(value: unknown): value is string { return text(value) && /^\d+:\d+$/.test(value) && value.split(':').every(part => integer(Number(part))); }
function resources(value: unknown, complete = false): value is Resources { return record(value) && (!complete || RESOURCE_IDS.every(key => Object.hasOwn(value, key))) && Object.entries(value).every(([key, amount]) => RESOURCE_IDS.some(resource => resource === key) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER); }
function equal(left: Partial<Resources>, right: Partial<Resources>): boolean { return RESOURCE_IDS.every(key => (left[key] ?? 0) === (right[key] ?? 0)); }
function delta(before: Resources, after: Resources, amounts: Partial<Resources>, sign: number): boolean { return RESOURCE_IDS.every(key => after[key] === before[key] + sign * (amounts[key] ?? 0)); }
function cargoAccounting(stock: Resources, arrivals: number): { upkeep: number; habitat: number } | null {
  if (!integer(arrivals)) return null;
  const cargo = Object.fromEntries(RESOURCE_IDS.map(key => [key, arrivals === 0 ? 0 : (Reflect.get(SPACEFLIGHT_RULES.settle.cargo, key) ?? 0) + (arrivals - 1) * (Reflect.get(SPACEFLIGHT_RULES.resupply.cargo, key) ?? 0)])) as Resources;
  if (!resources(cargo, true)) return null;
  const foodCost = VICTORY_RULES.mars.upkeep.food ?? 0;
  if (foodCost <= 0) return null;
  const upkeep = (cargo.food - stock.food) / foodCost;
  const habitat = (cargo.materials - stock.materials - upkeep * (VICTORY_RULES.mars.upkeep.materials ?? 0)) / SPACEFLIGHT_RULES.habitat.costPerBeat.materials;
  if (!integer(upkeep) || !integer(habitat, 0, SPACEFLIGHT_RULES.habitat.requiredWork / SPACEFLIGHT_RULES.habitat.workPerBeat) || upkeep < habitat) return null;
  return RESOURCE_IDS.every(key => stock[key] === cargo[key] - upkeep * (VICTORY_RULES.mars.upkeep[key] ?? 0) - habitat * (Reflect.get(SPACEFLIGHT_RULES.habitat.costPerBeat, key) ?? 0)) ? { upkeep, habitat } : null;
}
function index(id: unknown, civId: number): number | null { if (!text(id) || !new RegExp(`^mars-${civId}-[1-9]\\d*$`).test(id)) return null; const number = Number(id.split('-')[2]); return integer(number, 1) ? number : null; }
function receipt(value: RecordValue): boolean { return value.ruleVersion === 1 && integer(value.civId, 0, CIV_COUNT - 1) && integer(value.round) && eventId(value.eventId); }

export function isMarsMission(value: unknown): value is MarsMission {
  if (!record(value) || !keys(value, ['ruleVersion', 'civId', 'mission', 'sourceCityId', 'departureRound', 'arrivalRound', 'settlers', 'launchCost', 'cargo', 'totalCost', 'sourcePopulationBefore', 'sourcePopulationAfter', 'id', 'eventId', 'paid']) || value.ruleVersion !== 1 || !integer(value.civId, 0, CIV_COUNT - 1) || !['settle', 'resupply'].includes(String(value.mission)) || !text(value.sourceCityId) || !integer(value.departureRound) || !integer(value.arrivalRound) || value.arrivalRound !== value.departureRound + SPACEFLIGHT_RULES.flightRounds || !integer(value.settlers, 0, SPACEFLIGHT_RULES.settlers) || !integer(value.sourcePopulationBefore) || !integer(value.sourcePopulationAfter, SPACEFLIGHT_RULES.minimumSourcePopulation) || value.sourcePopulationBefore - value.settlers !== value.sourcePopulationAfter || !eventId(value.eventId) || !resources(value.launchCost) || !resources(value.cargo) || !resources(value.totalCost) || !resources(value.paid)) return false;
  const missionIndex = index(value.id, value.civId);
  if (!missionIndex || (missionIndex === 1) !== (value.mission === 'settle') || value.mission === 'settle' && value.settlers !== SPACEFLIGHT_RULES.settlers) return false;
  const recipe = SPACEFLIGHT_RULES[value.mission as 'settle' | 'resupply'];
  const totalCost = value.totalCost;
  return equal(value.launchCost, recipe.launchCost) && equal(value.cargo, recipe.cargo) && equal(value.paid, value.totalCost) && RESOURCE_IDS.every(key => totalCost[key] === undefined ? (Reflect.get(recipe.launchCost, key) ?? 0) + (Reflect.get(recipe.cargo, key) ?? 0) === 0 : totalCost[key] === (Reflect.get(recipe.launchCost, key) ?? 0) + (Reflect.get(recipe.cargo, key) ?? 0));
}

export function isMarsArrival(value: unknown): value is MarsArrivalReceipt {
  if (!record(value) || !keys(value, ['ruleVersion', 'missionId', 'civId', 'sourceCityId', 'round', 'eventId', 'settlers', 'cargo', 'populationBefore', 'populationAfter', 'stockBefore', 'stockAfter']) || !receipt(value) || !integer(value.civId) || !text(value.sourceCityId) || !integer(value.settlers, 0, SPACEFLIGHT_RULES.settlers) || !integer(value.populationBefore, 0, VICTORY_RULES.mars.population) || !integer(value.populationAfter, 0, VICTORY_RULES.mars.population) || value.populationAfter !== value.populationBefore + value.settlers || !resources(value.cargo) || !resources(value.stockBefore, true) || !resources(value.stockAfter, true)) return false;
  const number = index(value.missionId, value.civId);
  return number !== null && equal(value.cargo, number === 1 ? SPACEFLIGHT_RULES.settle.cargo : SPACEFLIGHT_RULES.resupply.cargo) && (number !== 1 || value.populationBefore === 0 && value.settlers === SPACEFLIGHT_RULES.settlers && equal(value.stockBefore, {})) && delta(value.stockBefore, value.stockAfter, value.cargo, 1);
}

export function isMarsUpkeep(value: unknown): value is MarsUpkeepReceipt {
  if (!record(value) || !keys(value, ['ruleVersion', 'civId', 'round', 'eventId', 'status', 'required', 'paid', 'missing', 'stockBefore', 'stockAfter', 'populationBefore', 'populationAfter', 'habitableBefore', 'supplyStreakBefore', 'supplyStreakAfter', 'shortageRoundsBefore', 'shortageRoundsAfter']) || !receipt(value) || typeof value.habitableBefore !== 'boolean' || !integer(value.populationBefore, 0, VICTORY_RULES.mars.population) || !integer(value.populationAfter, 0, VICTORY_RULES.mars.population) || !integer(value.supplyStreakBefore) || !integer(value.supplyStreakAfter) || !integer(value.shortageRoundsBefore) || !integer(value.shortageRoundsAfter) || !resources(value.required) || !resources(value.paid) || !resources(value.missing) || !resources(value.stockBefore, true) || !resources(value.stockAfter, true)) return false;
  if (value.supplyStreakBefore > 0 && value.shortageRoundsBefore > 0) return false;
  const required: Partial<Resources> = value.populationBefore > 0 ? VICTORY_RULES.mars.upkeep : {};
  const missing = value.missing; const stockBefore = value.stockBefore;
  if (!equal(value.required, required) || !RESOURCE_IDS.every(key => (missing[key] ?? 0) === Math.max(0, (required[key] ?? 0) - stockBefore[key]))) return false;
  const short = RESOURCE_IDS.some(key => (missing[key] ?? 0) > 0);
  const status = value.populationBefore === 0 ? 'uninhabited' : short ? 'shortage' : 'supplied';
  if (value.status !== status || !equal(value.paid, status === 'supplied' ? required : {}) || !delta(value.stockBefore, value.stockAfter, value.paid, -1)) return false;
  if (status === 'supplied') return value.populationAfter === value.populationBefore && value.shortageRoundsAfter === 0 && (value.habitableBefore ? value.supplyStreakAfter === value.supplyStreakBefore + 1 || value.supplyStreakAfter === 1 : value.supplyStreakAfter === 0);
  if (value.supplyStreakAfter !== 0) return false;
  if (status === 'uninhabited') return value.populationAfter === 0 && value.shortageRoundsAfter === 0;
  return (value.shortageRoundsAfter === value.shortageRoundsBefore + 1 || value.shortageRoundsAfter === 1) && value.populationAfter === Math.max(0, value.populationBefore - (value.shortageRoundsAfter % SPACEFLIGHT_RULES.shortage.populationLossEvery === 0 ? SPACEFLIGHT_RULES.shortage.populationLoss : 0));
}

export function isMarsHabitat(value: unknown): value is MarsHabitatReceipt {
  return record(value) && keys(value, ['ruleVersion', 'civId', 'round', 'eventId', 'paid', 'progressBefore', 'progressAfter']) && receipt(value) && resources(value.paid) && equal(value.paid, SPACEFLIGHT_RULES.habitat.costPerBeat) && integer(value.progressBefore, 0, SPACEFLIGHT_RULES.habitat.requiredWork - 1) && value.progressBefore % SPACEFLIGHT_RULES.habitat.workPerBeat === 0 && value.progressAfter === value.progressBefore + SPACEFLIGHT_RULES.habitat.workPerBeat;
}

export function validMarsEvent(value: RecordValue): boolean {
  const entries = [ ['marsDeparture', 'mars-departed', isMarsMission], ['marsArrival', 'mars-arrived', isMarsArrival], ['marsUpkeep', 'mars-upkeep', isMarsUpkeep], ['marsHabitat', 'mars-habitat-work', isMarsHabitat] ] as const;
  return entries.every(([field, type, validate]) => {
    if (!Object.hasOwn(value, field)) return value.type !== type;
    const payload = value[field];
    if (value.type !== type || !validate(payload) || !record(payload)) return false;
    return payload.eventId === value.id && payload.civId === value.actor && value.actor === value.target && (field === 'marsDeparture' ? payload.departureRound === value.round : payload.round === value.round);
  });
}

export function spaceflightRecords(world: WorldState): boolean {
  const has = world.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId);
  if (!has) return !Object.hasOwn(world, 'spaceflight') && !world.events.some(event => ['marsDeparture', 'marsArrival', 'marsUpkeep', 'marsHabitat'].some(field => Object.hasOwn(event, field)));
  const layer: unknown = world.spaceflight;
  if (!record(layer) || !keys(layer, ['ruleVersion', 'civilizations']) || layer.ruleVersion !== 1 || !Array.isArray(layer.civilizations) || layer.civilizations.length !== CIV_COUNT) return false;
  const eligible: number[] = [];
  for (let seat = 0; seat < CIV_COUNT; seat += 1) {
    const item: unknown = layer.civilizations[seat]; const civ = world.civilizations.find(candidate => candidate.id === seat);
    if (!civ || !record(item) || !keys(item, ['missionsLaunched', 'activeMission', 'colony', 'lastDeparture', 'lastArrival', 'lastUpkeep', 'lastHabitatWork']) || !integer(item.missionsLaunched)) return false;
    if (!integer(civ.marsPopulation, 0, VICTORY_RULES.mars.population) || !integer(civ.marsProgress, 0, SPACEFLIGHT_RULES.habitat.requiredWork) || civ.marsProgress % SPACEFLIGHT_RULES.habitat.workPerBeat !== 0) return false;
    const departure = item.lastDeparture; const flight = item.activeMission; const arrival = item.lastArrival; const upkeep = item.lastUpkeep; const work = item.lastHabitatWork; const colony = item.colony;
    if (item.missionsLaunched === 0) { if ([departure, flight, arrival, upkeep, work, colony].some(value => value !== null) || civ.marsPopulation || civ.marsProgress || civ.marsSupplyStreak) return false; continue; }
    if (!isMarsMission(departure) || departure.civId !== seat || index(departure.id, seat) !== item.missionsLaunched || departure.departureRound > world.round || Number(departure.eventId.split(':')[0]) > world.revision || !world.cities.some(city => city.id === departure.sourceCityId && city.civId === seat)) return false;
    if (world.events.some(event => event.id === departure.eventId && JSON.stringify(event.marsDeparture) !== JSON.stringify(departure))) return false;
    if (flight !== null && (!isMarsMission(flight) || JSON.stringify(flight) !== JSON.stringify(departure) || flight.arrivalRound <= world.round)) return false;
    if (colony === null) { if (item.missionsLaunched !== 1 || flight === null || arrival !== null || upkeep !== null || work !== null || civ.marsPopulation || civ.marsProgress || civ.marsSupplyStreak) return false; continue; }
    if (!record(colony) || !keys(colony, ['establishedRound', 'stock', 'shortageRounds']) || !integer(colony.establishedRound, 0, world.round) || !resources(colony.stock, true) || !integer(colony.shortageRounds) || !isMarsArrival(arrival) || arrival.civId !== seat || index(arrival.missionId, seat) !== item.missionsLaunched - (flight === null ? 0 : 1) || arrival.round < colony.establishedRound || arrival.round > world.round || !isMarsUpkeep(upkeep) || upkeep.civId !== seat || upkeep.round < arrival.round || upkeep.round > world.round || upkeep.populationAfter !== civ.marsPopulation || upkeep.supplyStreakAfter !== civ.marsSupplyStreak || upkeep.shortageRoundsAfter !== colony.shortageRounds) return false;
    const arrivals = item.missionsLaunched - (flight === null ? 0 : 1);
    const reserve = cargoAccounting(colony.stock, arrivals);
    const arrivalBefore = cargoAccounting(arrival.stockBefore, arrivals - 1);
    const arrivalAfter = cargoAccounting(arrival.stockAfter, arrivals);
    const upkeepBefore = cargoAccounting(upkeep.stockBefore, arrivals);
    const upkeepAfter = cargoAccounting(upkeep.stockAfter, arrivals);
    if (!reserve || !arrivalBefore || !arrivalAfter || !upkeepBefore || !upkeepAfter
      || reserve.habitat * SPACEFLIGHT_RULES.habitat.workPerBeat !== civ.marsProgress
      || reserve.upkeep > world.round - colony.establishedRound + 1 || upkeep.round !== world.round
      || arrivalBefore.upkeep !== arrivalAfter.upkeep || arrivalBefore.habitat !== arrivalAfter.habitat
      || arrivalAfter.upkeep > upkeepBefore.upkeep || arrivalAfter.habitat > upkeepBefore.habitat
      || upkeepAfter.upkeep !== upkeepBefore.upkeep + (upkeep.status === 'supplied' ? 1 : 0)
      || upkeepAfter.habitat !== upkeepBefore.habitat || reserve.upkeep !== upkeepAfter.upkeep
      || arrival.round === upkeep.round && (!equal(arrival.stockAfter, upkeep.stockBefore) || arrival.populationAfter !== upkeep.populationBefore)
      || arrivals === 1 && (colony.establishedRound !== arrival.round || upkeep.round === arrival.round && (upkeep.supplyStreakBefore !== 0 || upkeep.shortageRoundsBefore !== 0))) return false;
    if (flight !== null && flight.settlers + civ.marsPopulation > VICTORY_RULES.mars.population) return false;
    if (flight === null && (arrival.sourceCityId !== departure.sourceCityId || arrival.round !== departure.arrivalRound || arrival.settlers !== departure.settlers || !equal(arrival.cargo, departure.cargo))) return false;
    if (work !== null && (!isMarsHabitat(work) || work.civId !== seat || work.round < colony.establishedRound || work.round > upkeep.round || work.progressAfter !== civ.marsProgress)) return false;
    if (work !== null && isMarsHabitat(work) && work.progressAfter > (work.round - colony.establishedRound + 1) * SPACEFLIGHT_RULES.habitat.workPerBeat) return false;
    if (work === null && (civ.marsProgress !== 0 || civ.marsSupplyStreak !== 0)) return false;
    if (work !== null && isMarsHabitat(work) && upkeep.supplyStreakBefore > Math.max(0, upkeep.round - work.round - 1)) return false;
    if (work !== null && isMarsHabitat(work) && civ.marsSupplyStreak > Math.min(upkeep.round - work.round, reserve.upkeep - reserve.habitat)) return false;
    const currentWork = work !== null && isMarsHabitat(work) && work.round === upkeep.round ? work : null;
    if (currentWork && (upkeep.status !== 'supplied' || upkeep.populationAfter === 0)) return false;
    if (!delta(upkeep.stockAfter, colony.stock, currentWork?.paid ?? {}, -1) || upkeep.habitableBefore !== (civ.marsProgress >= SPACEFLIGHT_RULES.habitat.requiredWork && !currentWork)) return false;
    for (const retained of [arrival, upkeep, work]) if (retained !== null && record(retained) && (!eventId(retained.eventId) || Number(retained.eventId.split(':')[0]) > world.revision)) return false;
    if (world.events.some(event => event.id === departure.eventId && JSON.stringify(event.marsDeparture) !== JSON.stringify(departure) || event.id === arrival.eventId && JSON.stringify(event.marsArrival) !== JSON.stringify(arrival) || event.id === upkeep.eventId && JSON.stringify(event.marsUpkeep) !== JSON.stringify(upkeep) || work !== null && isMarsHabitat(work) && event.id === work.eventId && JSON.stringify(event.marsHabitat) !== JSON.stringify(work))) return false;
    if (upkeep.round === world.round && upkeep.status === 'supplied' && upkeep.habitableBefore && civ.marsProgress >= VICTORY_RULES.mars.progress && civ.marsPopulation >= VICTORY_RULES.mars.population && civ.marsSupplyStreak >= VICTORY_RULES.mars.suppliedRounds && civ.era >= VICTORY_RULES.mars.minEra && civ.technologies.includes(VICTORY_RULES.mars.requiredTechnology)) eligible.push(seat);
  }
  return eligible.length ? world.outcome?.kind === 'mars' && world.outcome.round === world.round && JSON.stringify(world.outcome.winners) === JSON.stringify(eligible) : world.outcome?.kind !== 'mars';
}

export function generatedHistoryRecords(world: WorldState): boolean {
  if (world.origin !== undefined) {
    const origin: unknown = world.origin;
    if (!record(origin) || !keys(origin, ['kind', 'generatorVersion', 'seed', 'clockEpoch', ...(Object.hasOwn(origin, 'initialReleaseId') ? ['initialReleaseId'] : [])])
      || origin.kind !== 'generated' || origin.generatorVersion !== 'coherent-geography-v1' || origin.seed !== world.seed || origin.clockEpoch !== world.clockEpoch
      || Object.hasOwn(origin, 'initialReleaseId') && (origin.initialReleaseId !== 'settlement-living-partnerships-1'
        || !world.unlockedFeatures.includes('partnership-stewardship') || !world.unlockedFeatures.includes('historical-pressures'))) return false;
  }
  if (!world.unlockedFeatures.includes('earned-history')) return !Object.hasOwn(world, 'milestoneProofs');
  const proofs: unknown = world.milestoneProofs;
  if (!record(proofs) || Object.keys(proofs).length > HISTORICAL_MILESTONES.length) return false;
  for (const [id, value] of Object.entries(proofs)) {
    const milestone = HISTORICAL_MILESTONES.find(candidate => candidate.id === id);
    if (!milestone || !world.calendarMilestones.includes(id) || !record(value) || !keys(value, ['ruleVersion', 'milestoneId', 'round', 'revision', 'eventId', 'year', 'targetYear', 'era']) || value.ruleVersion !== 1 || value.milestoneId !== id || !integer(value.round, 0, world.round) || !integer(value.revision, 0, world.revision) || !eventId(value.eventId) || Number(value.eventId.split(':')[0]) !== value.revision || !integer(value.year, -Number.MAX_SAFE_INTEGER, world.year) || value.targetYear !== milestone.year || value.era !== milestone.era) return false;
    const retained = world.events.find(event => event.id === value.eventId); if (retained && (retained.type !== 'history-milestone' || retained.round !== value.round)) return false;
  }
  for (const entry of Object.values(world.historyAdvances ?? {})) if (entry.cause.kind === 'milestone') { const proof = proofs[entry.cause.id]; if (!record(proof) || !integer(proof.targetYear, -Number.MAX_SAFE_INTEGER) || !integer(proof.revision) || entry.revision <= proof.revision || entry.deltaYears !== Math.max(0, proof.targetYear - entry.yearBefore)) return false; }
  return true;
}
