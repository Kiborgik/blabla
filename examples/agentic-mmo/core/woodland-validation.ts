import { RESIDENT_CAPACITY_RULES } from './content.ts';
import type { City, CityImprovement, GameEvent, ImprovementOperationResult, ResidentAllocationResult, WorldState } from './types.ts';
import type { WoodlandBeatEntry, WoodlandImprovementId, WoodlandOperationReceipt, WoodlandState } from './woodland-types.ts';

export type WoodlandValidationContext = Pick<WorldState, 'unlockedFeatures' | 'round' | 'revision' | 'tiles' | 'cities' | 'civilizations' | 'events'>;

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function amount(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function dense(value: unknown, maximum: number): value is unknown[] { return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)); }
function exactAmounts(value: unknown, expected: Record<string, number>): boolean { return record(value) && keys(value, Object.keys(expected)) && Object.entries(expected).every(([key, quantity]) => value[key] === quantity); }
function woodlandId(value: unknown): value is WoodlandImprovementId { return value === 'lumber-mill' || value === 'charcoal-clearing'; }
function profile(value: Record<string, unknown>): boolean { return value.ruleVersion === 1 && value.profileId === 'worked-woodlands-1'; }

function residents(value: unknown, required: number): value is ResidentAllocationResult {
  return record(value) && keys(value, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'])
    && value.ruleVersion === RESIDENT_CAPACITY_RULES.ruleVersion && integer(value.openingPopulation, 1)
    && value.communityReserve === RESIDENT_CAPACITY_RULES.communityReserve && value.required === required
    && integer(value.available, 0, Math.max(0, value.openingPopulation - RESIDENT_CAPACITY_RULES.communityReserve)) && integer(value.allocated, 0, required);
}

function balance(value: Record<string, unknown>): boolean {
  return integer(value.opening, 0, 8) && integer(value.closing, 0, 8) && (value.harvested === 0 || value.harvested === 1)
    && value.harvested <= value.opening && value.recovered === (value.harvested === 0 ? Math.min(1, 8 - value.opening) : 0)
    && value.closing === value.opening - value.harvested + value.recovered;
}

function receipt(value: unknown): value is WoodlandOperationReceipt {
  return record(value) && keys(value, ['ruleVersion', 'profileId', 'tileId', 'required', 'opening', 'harvested', 'recovered', 'closing'])
    && profile(value) && integer(value.tileId) && value.required === 1 && balance(value);
}

export function isWoodlandOperationResult(value: unknown, improvementId: unknown, completedRound: number, round: number): value is ImprovementOperationResult {
  if (!woodlandId(improvementId) || !integer(completedRound) || !integer(round, completedRound + 1) || !record(value)
    || !keys(value, ['round', 'status', 'paid', 'produced', 'residents', 'blockedReason', 'woodland', ...(improvementId === 'charcoal-clearing' ? ['inputs', 'shortages'] : [])])
    || !integer(value.round, completedRound + 1, round) || !record(value.paid) || !record(value.produced) || !residents(value.residents, 1) || !receipt(value.woodland)) return false;
  let funded = true;
  if (improvementId === 'charcoal-clearing') {
    if (!dense(value.inputs, 1) || value.inputs.length !== 1 || !dense(value.shortages, 1)) return false;
    const input = value.inputs[0];
    if (!record(input) || !keys(input, ['resource', 'required', 'available']) || input.resource !== 'materials' || input.required !== 1 || !amount(input.available)) return false;
    funded = input.available >= 1;
    const shortage = !funded && value.status !== 'paused' && value.blockedReason !== 'site-ineligible';
    if (value.shortages.length !== (shortage ? 1 : 0)) return false;
    if (shortage) {
      const missing = value.shortages[0];
      if (!record(missing) || !keys(missing, ['resource', 'required', 'available']) || missing.resource !== 'materials' || missing.required !== 1 || missing.available !== input.available) return false;
    }
  }
  if (value.status === 'operated') return value.blockedReason === null && value.woodland.harvested === 1 && funded
    && value.residents.available >= 1 && value.residents.allocated === 1 && exactAmounts(value.paid, improvementId === 'charcoal-clearing' ? { materials: 1 } : {})
    && Object.entries(value.produced).every(([resource, quantity]) => resource === (improvementId === 'charcoal-clearing' ? 'energy' : 'materials') && amount(quantity) && quantity > 0 && Math.round(quantity * 100) / 100 === quantity);
  if (value.woodland.harvested !== 0 || Object.keys(value.paid).length || Object.keys(value.produced).length || value.residents.allocated !== 0) return false;
  if (value.status === 'paused') return value.blockedReason === null;
  if (value.status !== 'blocked') return false;
  if (value.blockedReason === 'site-ineligible') return true;
  if (value.blockedReason === 'input-shortage') return !funded;
  if (!funded) return false;
  if (value.blockedReason === 'resident-shortage') return value.residents.available < 1;
  return value.blockedReason === 'woodland-shortage' && value.residents.available >= 1 && value.woodland.opening === 0;
}

function position(value: unknown, revision: number): readonly [number, number] | null {
  if (typeof value !== 'string' || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return null;
  const [first, second] = value.split(':').map(Number);
  return integer(first, 1, revision) && integer(second) ? [first, second] : null;
}
function before(left: readonly [number, number], right: readonly [number, number]): boolean { return left[0] < right[0] || left[0] === right[0] && left[1] < right[1]; }

function retainedEvent(state: WoodlandValidationContext, id: unknown, matches: (event: GameEvent) => boolean): boolean {
  const location = position(id, state.revision);
  if (!location) return false;
  const found = state.events.filter(event => event.id === id);
  if (found.length) return found.length === 1 && matches(found[0]!);
  return state.events.length > 0 && state.events.every(event => { const other = position(event.id, state.revision); return other !== null && before(location, other); });
}

function completion(state: WoodlandValidationContext, city: City, improvement: CityImprovement): boolean {
  const value: unknown = improvement.completion;
  if (!woodlandId(improvement.improvementId) || !record(value) || !keys(value, ['kind', 'orderId', 'cityId', 'improvementId', 'tileId', 'startedRound', 'completedRound', 'paid', 'workRequired', 'eventId'])
    || value.kind !== 'improvement' || value.cityId !== city.id || value.improvementId !== improvement.improvementId || value.tileId !== improvement.tileId
    || typeof value.orderId !== 'string' || !integer(value.startedRound, 0, state.round) || !integer(value.completedRound, value.startedRound + 1, state.round)) return false;
  const orderRevision = /^construction-([1-9]\d*)$/.exec(value.orderId)?.[1];
  const eventPosition = position(value.eventId, state.revision);
  if (orderRevision === undefined || !integer(Number(orderRevision), 1, state.revision) || !eventPosition || Number(orderRevision) >= eventPosition[0]
    || value.workRequired !== (improvement.improvementId === 'charcoal-clearing' ? 4 : 6)
    || !exactAmounts(value.paid, improvement.improvementId === 'charcoal-clearing' ? { materials: 8, credits: 4 } : { materials: 10, credits: 5 })) return false;
  return retainedEvent(state, value.eventId, event => event.type === 'improvement-completed' && event.round === value.completedRound
    && event.actor === city.civId && event.target === city.civId && event.tileId === improvement.tileId && event.detail === `${city.id}/${improvement.tileId}/${improvement.improvementId}`);
}

function residentBudget(city: City, improvement: CityImprovement, result: ImprovementOperationResult): boolean {
  const prior = [...Object.values(city.buildingOperations ?? {}).map(operation => operation.lastResult), ...Object.values(city.improvements ?? {}).filter(other => other.tileId < improvement.tileId && other.improvementId !== 'river-intake').map(other => other.operation.lastResult)].filter(other => other?.round === result.round);
  let allocated = 0;
  for (const other of prior) {
    const allocation = other?.residents;
    if (!allocation || !integer(allocation.required, 1) || !residents(allocation, allocation.required) || allocation.openingPopulation !== result.residents.openingPopulation
      || allocation.allocated !== (other.status === 'operated' ? allocation.required : 0)) return false;
    allocated += allocation.allocated;
  }
  if (city.lastFoodSupply?.round === result.round && city.lastFoodSupply.population !== result.residents.openingPopulation) return false;
  return result.residents.available === Math.max(0, result.residents.openingPopulation - RESIDENT_CAPACITY_RULES.communityReserve) - allocated;
}

function matchingReceipt(result: ImprovementOperationResult, entry: WoodlandBeatEntry): boolean {
  const value = result.woodland;
  return !!value && value.tileId === entry.tileId && value.opening === entry.opening && value.harvested === entry.harvested && value.recovered === entry.recovered && value.closing === entry.closing;
}

export function isWoodlandState(value: unknown, state: WoodlandValidationContext): value is WoodlandState {
  if (!['renewing-worked-woodlands', 'worked-land', 'forest-production', 'charcoal-clearing', 'resident-capacity', 'building-operations', 'recurring-decisions'].every(feature => state.unlockedFeatures.includes(feature))
    || !integer(state.round) || !integer(state.revision, state.round) || !record(value) || !keys(value, ['ruleVersion', 'profileId', 'stands', 'lastBeat']) || !profile(value) || !record(value.stands)) return false;
  const forest = state.tiles.filter(tile => tile.terrain === 'forest').toSorted((a, b) => a.id - b.id);
  if (new Set(forest.map(tile => tile.id)).size !== forest.length || !keys(value.stands, forest.map(tile => String(tile.id)))) return false;
  for (const stand of Object.values(value.stands)) {
    if (!record(stand) || !keys(stand, ['stock', 'lastHarvestRound']) || !integer(stand.stock, 0, 8)
      || stand.lastHarvestRound !== null && !integer(stand.lastHarvestRound, 1, state.round)) return false;
    if (stand.lastHarvestRound === null && stand.stock !== 8) return false;
  }
  const installed = new Map<number, { city: City; improvement: CityImprovement }>();
  const orders = new Set<string>();
  const completionEvents = new Set<string>();
  for (const city of state.cities) {
    for (const operation of Object.values(city.buildingOperations ?? {})) if (record(operation.lastResult) && Object.hasOwn(operation.lastResult, 'woodland')) return false;
    for (const [key, improvement] of Object.entries(city.improvements ?? {})) {
      if (!record(improvement) || !record(improvement.operation)) return false;
      if (!woodlandId(improvement.improvementId)) {
        if (record(improvement.operation.lastResult) && Object.hasOwn(improvement.operation.lastResult, 'woodland')) return false;
        continue;
      }
      if (!keys(improvement, ['improvementId', 'tileId', 'completion', 'operation']) || !integer(improvement.tileId) || key !== String(improvement.tileId)
        || !Object.hasOwn(value.stands, key) || installed.has(improvement.tileId) || !keys(improvement.operation, ['enabled', 'lastResult']) || typeof improvement.operation.enabled !== 'boolean'
        || !completion(state, city, improvement) || orders.has(improvement.completion.orderId) || completionEvents.has(improvement.completion.eventId)
        || !state.civilizations.some(actor => actor.id === city.civId)) return false;
      const tile = forest.find(site => site.id === improvement.tileId), center = state.tiles.find(site => site.id === city.tileId);
      if (!tile || !center || Math.max(Math.abs(tile.q - center.q), Math.abs(tile.r - center.r), Math.abs(tile.q - center.q + tile.r - center.r)) > 3
        || state.cities.some(other => other.tileId === tile.id || Object.values(other.districtSites ?? {}).includes(tile.id))) return false;
      installed.set(improvement.tileId, { city, improvement }); orders.add(improvement.completion.orderId); completionEvents.add(improvement.completion.eventId);
    }
  }
  if (value.lastBeat === null) return state.round === 0 && installed.size === 0 && Object.values(value.stands).every(stand => record(stand) && stand.stock === 8 && stand.lastHarvestRound === null) && !state.events.some(event => event.type === 'woodland-beat');
  const beat = value.lastBeat;
  if (!record(beat) || !keys(beat, ['ruleVersion', 'profileId', 'round', 'eventId', 'entries']) || !profile(beat) || !integer(beat.round, 1) || beat.round !== state.round
    || !dense(beat.entries, forest.length) || beat.entries.length !== forest.length || typeof beat.eventId !== 'string') return false;
  const beatPosition = position(beat.eventId, state.revision);
  if (!beatPosition) return false;
  let harvested = 0, recovered = 0;
  const entries = new Map<number, WoodlandBeatEntry>();
  for (const [index, entry] of beat.entries.entries()) {
    if (!record(entry) || !keys(entry, ['tileId', 'opening', 'harvested', 'recovered', 'closing', 'harvester']) || entry.tileId !== forest[index]!.id || !balance(entry)) return false;
    const tileId = forest[index]!.id;
    const stand = value.stands[String(tileId)];
    if (!record(stand) || stand.stock !== entry.closing || !integer(entry.opening, Math.max(0, 8 - (state.round - 1)), 8)) return false;
    if (entry.harvested === 1) {
      const identity = entry.harvester;
      const match = installed.get(tileId);
      if (!record(identity) || !keys(identity, ['cityId', 'civId', 'improvementId', 'orderId']) || !match || stand.lastHarvestRound !== state.round
        || identity.cityId !== match.city.id || identity.civId !== match.city.civId || identity.improvementId !== match.improvement.improvementId || identity.orderId !== match.improvement.completion.orderId) return false;
    } else {
      if (entry.harvester !== null || stand.lastHarvestRound === state.round) return false;
      if (stand.lastHarvestRound === null) { if (entry.opening !== 8) return false; }
      else {
        if (!integer(stand.lastHarvestRound, 1, state.round - 1)) return false;
        const resting = state.round - 1 - stand.lastHarvestRound;
        const minimum = Math.min(8, Math.max(0, 8 - stand.lastHarvestRound) + resting);
        const maximum = Math.min(8, 7 + resting);
        if (!integer(entry.opening, minimum, maximum)) return false;
      }
    }
    harvested += entry.harvested as number; recovered += entry.recovered as number;
    entries.set(tileId, entry as unknown as WoodlandBeatEntry);
  }
  if (!retainedEvent(state, beat.eventId, event => event.type === 'woodland-beat' && event.round === beat.round && event.actor === null && event.target === null && event.tileId === null
    && event.detail === `worked-woodlands-1 at strategic round ${state.round}` && event.importance === (harvested > 0 ? 2 : 1)
    && dense(event.effects, 3) && event.effects.length === 3 && event.effects[0] === `Harvested work-lots ${harvested}` && event.effects[1] === `Recovered work-lots ${recovered}` && event.effects[2] === 'Recovery is not operation output; forest terrain is unchanged')
    || state.events.some(event => event.type === 'woodland-beat' && event.round >= state.round && event.id !== beat.eventId)) return false;
  for (const [tileId, { city, improvement }] of installed) {
    const entry = entries.get(tileId)!;
    const result = improvement.operation.lastResult;
    const completedAt = position(improvement.completion.eventId, state.revision)!;
    if (improvement.completion.completedRound === state.round) {
      if (result !== null || entry.harvested !== 0 || !before(beatPosition, completedAt)) return false;
      continue;
    }
    if (!before(completedAt, beatPosition) || !isWoodlandOperationResult(result, improvement.improvementId, improvement.completion.completedRound, state.round)
      || result.round !== state.round || !matchingReceipt(result, entry) || !residentBudget(city, improvement, result)
      || (result.status === 'operated') !== (entry.harvester !== null)) return false;
  }
  return true;
}
