import { RESIDENT_CAPACITY_RULES } from './content.ts';
import { validateDrainage } from './drainage.ts';
import { RIVER_INTAKE_RULES } from './river-intake-content.ts';
import type { RiverFlowState, RiverIntakeFlowReceipt } from './river-intake-types.ts';
import type { City, CityImprovement, ImprovementOperationResult, WorldState } from './types.ts';

export type RiverFlowValidationContext = Pick<WorldState, 'unlockedFeatures' | 'round' | 'revision' | 'width' | 'height' | 'tiles' | 'drainage' | 'cities' | 'civilizations' | 'events'>;

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function amount(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function dense(value: unknown, maximum: number): value is unknown[] { return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)); }
function exactAmounts(value: unknown, expected: Record<string, number>): boolean { return record(value) && keys(value, Object.keys(expected)) && Object.entries(expected).every(([key, quantity]) => value[key] === quantity); }
function eventPosition(value: unknown, revision: number): [number, number] | null {
  if (typeof value !== 'string' || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return null;
  const [first, second] = value.split(':').map(Number);
  return integer(first, 1, revision) && integer(second) ? [first, second] : null;
}
function before(left: readonly number[], right: readonly number[]): boolean { return left[0]! < right[0]! || left[0] === right[0] && left[1]! < right[1]!; }

function riverReceipt(value: unknown, round: number): value is RiverIntakeFlowReceipt {
  return record(value) && keys(value, ['ruleVersion', 'ruleId', 'tileId', 'downstreamTileId', 'outletTileId', 'required', 'availableBefore', 'withdrawn', 'remainingAfter', 'supportBuildingId', 'supportAllocationRound'])
    && value.ruleVersion === RIVER_INTAKE_RULES.ruleVersion && value.ruleId === RIVER_INTAKE_RULES.ruleId
    && integer(value.tileId) && integer(value.downstreamTileId) && value.tileId !== value.downstreamTileId
    && integer(value.outletTileId) && value.tileId !== value.outletTileId && value.required === RIVER_INTAKE_RULES.flowPerOperation
    && integer(value.availableBefore) && (value.withdrawn === 0 || value.withdrawn === RIVER_INTAKE_RULES.flowPerOperation)
    && integer(value.remainingAfter) && value.remainingAfter === value.availableBefore - value.withdrawn
    && value.supportBuildingId === RIVER_INTAKE_RULES.supportBuildingId && (value.supportAllocationRound === null || value.supportAllocationRound === round);
}

export function isRiverIntakeOperationResult(value: unknown, completedRound: number, round: number): value is ImprovementOperationResult {
  if (!record(value) || !keys(value, ['round', 'status', 'paid', 'produced', 'residents', 'blockedReason', 'inputs', 'shortages', ...(Object.hasOwn(value, 'river') ? ['river'] : [])])
    || !integer(value.round, completedRound + 1, round) || !record(value.residents) || !record(value.paid) || !record(value.produced)
    || !dense(value.inputs, 1) || value.inputs.length !== 1 || !dense(value.shortages, 1)) return false;
  const residents = value.residents;
  if (!keys(residents, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'])
    || residents.ruleVersion !== RESIDENT_CAPACITY_RULES.ruleVersion || !integer(residents.openingPopulation, 1)
    || residents.communityReserve !== RESIDENT_CAPACITY_RULES.communityReserve || residents.required !== RIVER_INTAKE_RULES.residentsPerOperation
    || !integer(residents.available, 0, Math.max(0, residents.openingPopulation - residents.communityReserve)) || !integer(residents.allocated, 0, residents.required)) return false;
  const input = value.inputs[0];
  if (!record(input) || !keys(input, ['resource', 'required', 'available']) || input.resource !== 'materials' || input.required !== RIVER_INTAKE_RULES.materialsPerOperation || !amount(input.available)) return false;
  const hasRiver = Object.hasOwn(value, 'river');
  if (hasRiver && !riverReceipt(value.river, value.round)) return false;
  const river = hasRiver ? value.river as RiverIntakeFlowReceipt : null;
  const shortage = value.status === 'blocked' && value.blockedReason === 'input-shortage';
  if (value.shortages.length !== (shortage ? 1 : 0)) return false;
  if (shortage) {
    const missing = value.shortages[0];
    if (!record(missing) || !keys(missing, ['resource', 'required', 'available']) || missing.resource !== input.resource || missing.required !== input.required || missing.available !== input.available || input.available >= input.required) return false;
  }
  if (value.status === 'operated') return value.blockedReason === null && river !== null && river.withdrawn === river.required && river.supportAllocationRound === value.round
    && input.available >= input.required && residents.available >= residents.required && residents.allocated === residents.required
    && exactAmounts(value.paid, { materials: RIVER_INTAKE_RULES.materialsPerOperation })
    && Object.entries(value.produced).every(([resource, quantity]) => resource === 'food' && amount(quantity) && quantity > 0 && Math.round(quantity * 100) / 100 === quantity);
  if (Object.keys(value.paid).length || Object.keys(value.produced).length || residents.allocated !== 0 || river !== null && river.withdrawn !== 0) return false;
  if (value.status === 'paused') return value.blockedReason === null;
  if (value.status !== 'blocked') return false;
  if (value.blockedReason === 'site-ineligible') return true;
  if (!river) return false;
  if (value.blockedReason === 'support-unfunded') return river.supportAllocationRound === null;
  if (river.supportAllocationRound !== value.round) return false;
  if (value.blockedReason === 'input-shortage') return input.available < input.required;
  if (input.available < input.required) return false;
  if (value.blockedReason === 'resident-shortage') return residents.available < residents.required;
  return value.blockedReason === 'flow-shortage' && residents.available >= residents.required && river.availableBefore < river.required;
}

function rawGraph(state: RiverFlowValidationContext) {
  if (!validateDrainage(state.drainage, state.tiles, state.width, state.height)) return null;
  const links = state.drainage.downstreamTileIds;
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const ascending = [...tiles.values()].sort((a, b) => a.elevation - b.elevation || a.id - b.id);
  const order = [...tiles.values()].filter(tile => tile.terrain !== 'ocean').sort((a, b) => b.elevation - a.elevation || a.id - b.id);
  const outlets = new Map<number, number>();
  const areas = new Map(state.tiles.map(tile => [tile.id, tile.terrain === 'ocean' ? 0 : 1]));
  for (const tile of ascending) {
    const downstream = links[tile.id]!;
    if (downstream === null) outlets.set(tile.id, tile.id);
    else {
      const outlet = outlets.get(downstream);
      if (outlet === undefined) return null;
      outlets.set(tile.id, outlet);
    }
  }
  for (const tile of order) {
    const downstream = links[tile.id];
    if (downstream === null || downstream === undefined) return null;
    areas.set(downstream, areas.get(downstream)! + areas.get(tile.id)!);
  }
  return { tiles, links, order, outlets, areas, ocean: ascending.filter(tile => tile.terrain === 'ocean').sort((a, b) => a.id - b.id) };
}

function staticSite(state: RiverFlowValidationContext, graph: NonNullable<ReturnType<typeof rawGraph>>, city: City, tileId: number): boolean {
  const tile = graph.tiles.get(tileId), center = graph.tiles.get(city.tileId);
  if (!tile || !center || tile.terrain === 'ocean' || tile.terrain === 'mountain' || graph.links[tileId] === null
    || (graph.areas.get(tileId) ?? 0) < RIVER_INTAKE_RULES.minimumContributingLand
    || Math.max(Math.abs(tile.q - center.q), Math.abs(tile.r - center.r), Math.abs(tile.q - center.q + tile.r - center.r)) > RIVER_INTAKE_RULES.siteRange
    || state.cities.some(other => other.tileId === tileId || Object.values(other.districtSites ?? {}).includes(tileId))) return false;
  return true;
}

function completion(state: RiverFlowValidationContext, city: City, installed: CityImprovement): boolean {
  const value = installed.completion;
  const revision = /^construction-([1-9]\d*)$/.exec(value.orderId)?.[1];
  const event = eventPosition(value.eventId, state.revision);
  return value.kind === 'improvement' && value.cityId === city.id && value.improvementId === RIVER_INTAKE_RULES.improvementId && value.tileId === installed.tileId
    && revision !== undefined && integer(Number(revision), 1, state.revision) && event !== null && Number(revision) < event[0]
    && integer(value.startedRound, 0, state.round) && integer(value.completedRound, value.startedRound + 1, state.round)
    && value.workRequired === RIVER_INTAKE_RULES.constructionWork && exactAmounts(value.paid, RIVER_INTAKE_RULES.constructionCost);
}

function supportAndResidents(city: City, result: ImprovementOperationResult): boolean {
  const support = city.buildings.includes(RIVER_INTAKE_RULES.supportBuildingId) ? city.buildingOperations?.[RIVER_INTAKE_RULES.supportBuildingId]?.lastResult : null;
  const funded = support?.round === result.round && support.status === 'operated';
  if (result.river!.supportAllocationRound !== (funded ? result.round : null)) return false;
  if (funded && (!exactAmounts(support.paid, { materials: 1 }) || support.residents?.required !== RESIDENT_CAPACITY_RULES.perPaidRecipe || support.residents.allocated !== RESIDENT_CAPACITY_RULES.perPaidRecipe)) return false;
  const otherResults = [...Object.values(city.buildingOperations ?? {}).map(operation => operation.lastResult), ...Object.values(city.improvements ?? {}).filter(item => item.improvementId !== RIVER_INTAKE_RULES.improvementId).map(item => item.operation.lastResult)].filter(item => item?.round === result.round);
  let allocated = 0;
  for (const other of otherResults) {
    if (!other?.residents || other.residents.openingPopulation !== result.residents.openingPopulation) return false;
    allocated += other.residents.allocated;
  }
  return result.residents.available === Math.max(0, result.residents.openingPopulation - RESIDENT_CAPACITY_RULES.communityReserve) - allocated;
}

function ledgerEvent(state: RiverFlowValidationContext, id: string, round: number, effects: string[]): boolean {
  const position = eventPosition(id, state.revision);
  if (!position) return false;
  const matching = state.events.filter(event => event.id === id);
  if (matching.length > 1) return false;
  const event = matching[0];
  if (event && (event.type !== 'river-flow' || event.round !== round || event.actor !== null || event.target !== null || event.tileId !== null || event.detail !== `${RIVER_INTAKE_RULES.ruleId} at strategic round ${round}`
    || event.effects.length !== effects.length || event.effects.some((effect, index) => effect !== effects[index]))) return false;
  if (state.events.some(other => other.type === 'river-flow' && other.round >= round && other.id !== id)) return false;
  if (event) return true;
  if (!state.events.length) return false;
  return state.events.every(other => { const otherPosition = eventPosition(other.id, state.revision); return otherPosition !== null && before(position, otherPosition); });
}

export function isRiverFlowState(value: unknown, state: RiverFlowValidationContext): value is RiverFlowState {
  if (![RIVER_INTAKE_RULES.featureId, 'worked-land', 'resident-capacity', 'recurring-decisions', 'building-operations', 'food-budget', 'water-land'].every(feature => state.unlockedFeatures.includes(feature)) || !record(value) || !keys(value, ['ruleVersion', 'ruleId', 'lastBeat'])
    || value.ruleVersion !== RIVER_INTAKE_RULES.ruleVersion || value.ruleId !== RIVER_INTAKE_RULES.ruleId) return false;
  const installed: Array<{ city: City; intake: CityImprovement }> = [];
  let pending = 0;
  const graph = state.drainage === undefined ? null : rawGraph(state);
  if (state.drainage !== undefined && !graph) return false;
  const sites = new Set<number>(), orders = new Set<string>();
  for (const city of state.cities) {
    const intakes = Object.entries(city.improvements ?? {}).filter(([, item]) => item.improvementId === RIVER_INTAKE_RULES.improvementId);
    const active = city.construction?.active;
    const reserved = active && 'kind' in active && active.kind === 'improvement' && active.improvementId === RIVER_INTAKE_RULES.improvementId ? active : null;
    if (intakes.length + (reserved ? 1 : 0) > 1 || Object.values(city.improvements ?? {}).some(item => item.improvementId !== RIVER_INTAKE_RULES.improvementId && item.operation.lastResult?.river !== undefined)) return false;
    for (const [key, intake] of intakes) {
      if (!graph || String(intake.tileId) !== key || sites.has(intake.tileId) || orders.has(intake.completion.orderId)
        || !staticSite(state, graph, city, intake.tileId) || !completion(state, city, intake)
        || !state.civilizations.some(actor => actor.id === city.civId && actor.technologies.includes('water-management'))) return false;
      sites.add(intake.tileId); orders.add(intake.completion.orderId); installed.push({ city, intake });
    }
    if (reserved) {
      if (!graph || reserved.cityId !== city.id || !staticSite(state, graph, city, reserved.tileId)
        || !exactAmounts(reserved.paid, RIVER_INTAKE_RULES.constructionCost) || reserved.workRequired !== RIVER_INTAKE_RULES.constructionWork) return false;
      pending++;
    }
  }
  if (!graph) return value.lastBeat === null && installed.length === 0 && pending === 0 && !state.events.some(event => event.type === 'river-flow');
  if (value.lastBeat === null) return state.round === 0 && installed.length === 0 && !state.events.some(event => event.type === 'river-flow');
  const beat = value.lastBeat;
  if (!record(beat) || !keys(beat, ['ruleVersion', 'ruleId', 'round', 'sourceUnits', 'withdrawals', 'outlets', 'eventId'])
    || beat.ruleVersion !== RIVER_INTAKE_RULES.ruleVersion || beat.ruleId !== RIVER_INTAKE_RULES.ruleId || !integer(beat.round, 1) || beat.round !== state.round
    || beat.sourceUnits !== graph.order.length || !dense(beat.withdrawals, installed.length) || !dense(beat.outlets, graph.ocean.length)
    || typeof beat.eventId !== 'string') return false;
  const rank = new Map(graph.order.map((tile, index) => [tile.id, index]));
  const debits = new Map<number, number>();
  let previousRank = -1;
  const withdrawalEffects: string[] = [];
  for (const withdrawal of beat.withdrawals) {
    if (!record(withdrawal) || !keys(withdrawal, ['cityId', 'civId', 'tileId', 'orderId', 'quantity']) || !integer(withdrawal.tileId)
      || withdrawal.quantity !== RIVER_INTAKE_RULES.flowPerOperation || debits.has(withdrawal.tileId)) return false;
    const match = installed.find(({ city, intake }) => city.id === withdrawal.cityId && city.civId === withdrawal.civId && intake.tileId === withdrawal.tileId && intake.completion.orderId === withdrawal.orderId);
    const currentRank = rank.get(withdrawal.tileId);
    if (!match || currentRank === undefined || currentRank <= previousRank || match.intake.operation.lastResult?.status !== 'operated') return false;
    previousRank = currentRank; debits.set(withdrawal.tileId, withdrawal.quantity);
    withdrawalEffects.push(`${String(withdrawal.cityId)}/${withdrawal.tileId}/${String(withdrawal.orderId)}: withdrew ${withdrawal.quantity}`);
  }
  const available = new Map(state.tiles.map(tile => [tile.id, tile.terrain === 'ocean' ? 0 : RIVER_INTAKE_RULES.runoffPerLandTile]));
  for (const tile of graph.order) {
    const remaining = available.get(tile.id)! - (debits.get(tile.id) ?? 0);
    if (remaining < 0) return false;
    const downstream = graph.links[tile.id]!;
    if (downstream === null) return false;
    available.set(downstream, available.get(downstream)! + remaining);
  }
  if (beat.outlets.length !== graph.ocean.length || !beat.outlets.every((outlet, index) => record(outlet) && keys(outlet, ['tileId', 'quantity']) && outlet.tileId === graph.ocean[index]!.id && outlet.quantity === available.get(graph.ocean[index]!.id))) return false;
  const withdrawn = [...debits.values()].reduce((sum, quantity) => sum + quantity, 0);
  const residual = graph.ocean.reduce((sum, tile) => sum + available.get(tile.id)!, 0);
  if (!ledgerEvent(state, beat.eventId, beat.round, [`Land-source units ${beat.sourceUnits}`, `Withdrawn ${withdrawn}`, `Ocean outlet residual ${residual}`, ...withdrawalEffects])) return false;
  const materials = new Map<number, number>();
  for (const { city, intake } of installed.sort((a, b) => rank.get(a.intake.tileId)! - rank.get(b.intake.tileId)!)) {
    const result = intake.operation.lastResult;
    if (intake.completion.completedRound === beat.round) { if (result !== null || debits.has(intake.tileId)) return false; continue; }
    if (!isRiverIntakeOperationResult(result, intake.completion.completedRound, state.round) || result.round !== beat.round || !result.river) return false;
    const river = result.river;
    if (river.tileId !== intake.tileId || river.downstreamTileId !== graph.links[intake.tileId] || river.outletTileId !== graph.outlets.get(intake.tileId)
      || river.availableBefore !== available.get(intake.tileId) || river.withdrawn !== (debits.get(intake.tileId) ?? 0)
      || !supportAndResidents(city, result)) return false;
    const input = result.inputs![0]!.available;
    if (materials.has(city.civId) && input !== materials.get(city.civId)) return false;
    materials.set(city.civId, input - (result.paid.materials ?? 0));
  }
  return true;
}
