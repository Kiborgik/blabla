import { INDUSTRIAL_RULES, LAND_TRANSPORT_RULES } from '../content.ts';
import type { ActionOption, City, ConstructionOrder, GameEvent, RailConstructionOrder, RailObservation, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { purchasedSiteBlock } from './site-binding.ts';
import { canAfford, civilizationById, transferCost } from './world.ts';

export function railEdgeId(first: number, second: number): string { return `${Math.min(first, second)}:${Math.max(first, second)}`; }
export function isRailOrder(order: ConstructionOrder): order is RailConstructionOrder { return 'kind' in order && order.kind === 'rail'; }

export function railSiteBlock(state: WorldState, city: City, fromTileId: number, toTileId: number, orderId?: string): string | null {
  const first = state.tiles.find(tile => tile.id === fromTileId); const second = state.tiles.find(tile => tile.id === toTileId);
  const center = state.tiles.find(tile => tile.id === city.tileId);
  if (!Number.isSafeInteger(fromTileId) || !Number.isSafeInteger(toTileId) || !first || !second || !center || hexDistance(first, second) !== 1) return 'Rail requires two exact adjacent endpoint tiles';
  if (![first, second].every(tile => LAND_TRANSPORT_RULES.passable[tile.terrain])) return 'Rail requires a passable land edge';
  if (![first, second].every(tile => tile.owner === city.civId)) return 'Both Rail endpoints must already belong to this civilization';
  if (![first, second].every(tile => hexDistance(center, tile) <= INDUSTRIAL_RULES.railRange)) return 'Both Rail endpoints must be within three hexes of the exact town';
  for (const tile of [first, second]) { const block = purchasedSiteBlock(state, city, tile.id); if (block) return block; }
  const id = railEdgeId(fromTileId, toTileId);
  if (state.railEdges?.[id]) return 'This canonical Rail edge is already complete';
  if (state.cities.some(candidate => { const order = candidate.construction?.active; return order && isRailOrder(order) && order.edgeId === id && order.id !== orderId; })) return 'This canonical Rail edge is already reserved';
  return null;
}

export function railTownBlock(state: WorldState, seat: number, cityId: string): string | null {
  if (!hasFeatures(state, [INDUSTRIAL_RULES.featureId])) return 'Owned Rail construction is not released';
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === seat);
  if (!city) return 'Rail requires an exact owned town';
  const civilization = civilizationById(state, seat);
  if (!civilization.technologies.includes(INDUSTRIAL_RULES.requiredTechnology)) return 'Rail requires completed Steam power';
  if (city.construction?.active) return 'The town already has an active construction commitment';
  if (!canAfford(civilization.resources, INDUSTRIAL_RULES.railCost)) return 'Rail requires four Materials and two Credits';
  if (Object.entries(INDUSTRIAL_RULES.railStrategicCost).some(([resource, amount]) => (civilization.strategicResources?.[resource as 'iron' | 'coal'] ?? 0) < amount)) return 'Rail requires one Iron and one Coal together';
  return null;
}

export function availableRailActions(state: WorldState, seat: number, cityId?: string): ActionOption[] {
  const result: ActionOption[] = [];
  for (const city of state.cities.filter(candidate => candidate.civId === seat && (cityId === undefined || candidate.id === cityId))) {
    if (railTownBlock(state, seat, city.id)) continue;
    const center = state.tiles.find(tile => tile.id === city.tileId); if (!center) continue;
    const local = state.tiles.filter(tile => tile.owner === seat && LAND_TRANSPORT_RULES.passable[tile.terrain] && hexDistance(center, tile) <= INDUSTRIAL_RULES.railRange).toSorted((left, right) => left.id - right.id);
    for (const first of local) for (const second of local) {
      if (first.id >= second.id || hexDistance(first, second) !== 1 || railSiteBlock(state, city, first.id, second.id)) continue;
      result.push({ action: { type: 'build-rail', cityId: city.id, fromTileId: first.id, toTileId: second.id }, label: `${city.name}: build Rail ${first.id} ↔ ${second.id}`, reason: 'Pay 4 Materials, 2 Credits, 1 Iron and 1 Coal once for 2 work in this town’s lane. The completed owned edge weighs 0.25 in new steam quotes; existing agreements do not change.' });
    }
  }
  return result;
}

export function observedRail(state: WorldState, seat: number, cityId: string | null): RailObservation {
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === seat);
  const active = city?.construction?.active;
  const actions = city ? availableRailActions(state, seat, city.id) : [];
  return structuredClone({ cityId: city?.id ?? null, active: active && isRailOrder(active) ? active : null,
    completed: Object.values(state.railEdges ?? {}).filter(edge => edge.civId === seat && (cityId === null || edge.cityId === cityId)).toSorted((left, right) => left.tileId - right.tileId || left.toTileId - right.toTileId),
    available: actions.flatMap(option => option.action.type === 'build-rail' ? [{ edgeId: railEdgeId(option.action.fromTileId, option.action.toTileId), tileId: option.action.fromTileId, toTileId: option.action.toTileId, paid: { ...INDUSTRIAL_RULES.railCost }, strategicPaid: { ...INDUSTRIAL_RULES.railStrategicCost }, workRequired: INDUSTRIAL_RULES.railWork }] : []),
    blocker: city ? railTownBlock(state, seat, city.id) ?? (actions.length ? null : 'No eligible unbuilt owned local Rail edge') : 'Select an exact owned town',
  });
}

export function executeRailAction(state: WorldState, seat: number, cityId: string, fromTileId: number, toTileId: number, events: GameEvent[]): void {
  const townBlock = railTownBlock(state, seat, cityId); if (townBlock) throw new RangeError(townBlock);
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === seat); if (!city) throw new RangeError('Missing exact Rail town');
  const siteBlock = railSiteBlock(state, city, fromTileId, toTileId); if (siteBlock) throw new RangeError(siteBlock);
  const civilization = civilizationById(state, seat);
  transferCost(civilization.resources, INDUSTRIAL_RULES.railCost);
  civilization.strategicResources ??= {};
  for (const resource of ['iron', 'coal'] as const) civilization.strategicResources[resource] = (civilization.strategicResources[resource] ?? 0) - INDUSTRIAL_RULES.railStrategicCost[resource];
  city.construction ??= { active: null, lastCompleted: null };
  city.construction.active = { kind: 'rail', ruleVersion: 1, id: `construction-${state.revision}`, cityId, edgeId: railEdgeId(fromTileId, toTileId), tileId: Math.min(fromTileId, toTileId), toTileId: Math.max(fromTileId, toTileId), startedRound: state.round, paid: { ...INDUSTRIAL_RULES.railCost }, strategicPaid: { ...INDUSTRIAL_RULES.railStrategicCost }, workRequired: INDUSTRIAL_RULES.railWork, workDone: 0 };
  emitEvent(state, events, { type: 'construction-started', title: `${city.name} starts Rail`, detail: city.construction.active.id, actor: seat, target: seat, tileId: city.construction.active.tileId, cause: 'Both owned local endpoints commit one canonical edge to the exact town lane', effects: ['Paid 4 materials, 2 credits, 1 iron and 1 coal', 'Work 0/2', 'Existing trade terms and tile assets are unchanged'], importance: 3 });
}

export function installRail(state: WorldState, city: City, order: RailConstructionOrder, events: GameEvent[]): void {
  if (!state.railEdges || state.railEdges[order.edgeId] || !city.construction) throw new RangeError('Rail completion requires its uninstalled canonical edge and town lane');
  const event = emitEvent(state, events, { type: 'rail-completed', title: `${city.name} completes Rail`, detail: order.edgeId, actor: city.civId, target: city.civId, tileId: order.tileId, cause: 'The paid canonical owned edge completed its retained work on a later strategic beat', effects: [`Rail ${order.edgeId} weighs 0.25 in new steam quotes`, 'Existing agreements keep their accepted terms and cadence'], importance: 4 });
  const completion = { kind: 'rail' as const, ruleVersion: 1 as const, orderId: order.id, cityId: city.id, civId: city.civId, edgeId: order.edgeId, tileId: order.tileId, toTileId: order.toTileId, startedRound: order.startedRound, completedRound: state.round, paid: structuredClone(order.paid), strategicPaid: structuredClone(order.strategicPaid), workRequired: order.workRequired, eventId: event.id };
  state.railEdges[order.edgeId] = completion; city.construction.lastCompleted = structuredClone(completion); event.railCompletion = structuredClone(completion);
}
