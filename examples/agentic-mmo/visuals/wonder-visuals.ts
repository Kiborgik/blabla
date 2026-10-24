import { WONDERS } from '../core/content.ts';
import type { CityGrowthFacts, PopulationGrowthReceipt, WonderLossReceipt, WonderObservation, WorldState } from '../core/types.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { hasFeatures } from '../core/simulation/history.ts';
import { observedWonders } from '../core/simulation/wonders.ts';
import { mapTileHeight } from './route-paths.ts';
import { greatLibraryVisual, type WonderLandmarkRecord } from './wonder-landmark.ts';

export interface WonderSiteView {
  id: string; workId: string; wonderId: string; name: string; cityId: string; townName: string; civId: number; tileId: number;
  q: number; r: number; height: number; color: string; status: 'building' | 'built'; record: WonderLandmarkRecord;
}
export interface TownDevelopmentFacts {
  growth: CityGrowthFacts | null;
  lastGrowth: PopulationGrowthReceipt | null;
  wonders: WonderObservation[];
}
export type WonderWorkRow =
  | { kind: 'building'; key: string; name: string; facts: WonderObservation; order: WonderObservation['contenders'][number] }
  | { kind: 'completed'; key: string; name: string; facts: WonderObservation; completed: NonNullable<WonderObservation['completed']> }
  | { kind: 'lost'; key: string; name: string; facts: WonderObservation; receipt: WonderLossReceipt };

export function wonderWorkId(wonderId: string, orderId: string): string { return `wonder:${wonderId}:${orderId}`; }

export function wonderWorkRows(facts: readonly WonderObservation[], cityId: string): WonderWorkRow[] {
  return facts.flatMap(wonder => {
    const name = WONDERS.find(definition => definition.id === wonder.wonderId)?.name ?? 'Wonder';
    const rows: WonderWorkRow[] = wonder.contenders.filter(order => order.cityId === cityId).map(order => ({ kind: 'building', key: wonderWorkId(wonder.wonderId, order.id), name, facts: wonder, order }));
    if (wonder.completed?.completion.cityId === cityId) rows.push({ kind: 'completed', key: wonderWorkId(wonder.wonderId, wonder.completed.completion.orderId), name, facts: wonder, completed: wonder.completed });
    for (const receipt of wonder.completed?.losses ?? []) if (receipt.cityId === cityId) rows.push({ kind: 'lost', key: wonderWorkId(wonder.wonderId, receipt.orderId), name, facts: wonder, receipt });
    return rows;
  });
}

export function townDevelopmentFacts(state: WorldState, cityId: string): TownDevelopmentFacts {
  const city = state.cities.find(candidate => candidate.id === cityId);
  if (!city) return { growth: null, lastGrowth: null, wonders: [] };
  const growth = hasFeatures(state, ['local-growth']) ? cityGrowthFacts(state, city) : null;
  const lastGrowth = state.events.findLast(event => event.populationGrowth?.cityId === city.id && event.populationGrowth.civId === city.civId && event.populationGrowth.eventId === event.id)?.populationGrowth ?? null;
  return { growth: growth ? structuredClone(growth) : null, lastGrowth: lastGrowth ? structuredClone(lastGrowth) : null, wonders: observedWonders(state, city.civId) };
}

export function projectWonderSites(state: WorldState): WonderSiteView[] {
  const records: Array<{ wonderId: string; record: WonderLandmarkRecord }> = [];
  for (const city of state.cities) {
    const order = city.construction?.active;
    if (order && 'kind' in order && order.kind === 'wonder' && order.cityId === city.id) records.push({ wonderId: order.wonderId, record: { status: 'building', orderId: order.id, cityId: city.id, civId: city.civId, tileId: order.tileId, workDone: order.workDone, workRequired: order.workRequired } });
  }
  for (const completed of Object.values(state.wonders ?? {})) {
    const record = completed.completion;
    records.push({ wonderId: record.wonderId, record: { status: 'completed', orderId: record.orderId, cityId: record.cityId, civId: record.civId, tileId: record.tileId, completionEventId: record.eventId, completedRound: record.completedRound } });
  }
  return records.flatMap(({ wonderId, record }) => {
    const city = state.cities.find(candidate => candidate.id === record.cityId && candidate.civId === record.civId);
    const tile = state.tiles.find(candidate => candidate.id === record.tileId);
    const civilization = state.civilizations.find(candidate => candidate.id === record.civId);
    const definition = WONDERS.find(candidate => candidate.id === wonderId);
    if (!city || !tile || tile.terrain === 'ocean' || !definition || wonderId !== 'great-library') return [];
    const visual = greatLibraryVisual(record, 'far');
    if (visual.stage === 'unavailable' || visual.stage === 'ended') return [];
    return [{ id: wonderWorkId(wonderId, record.orderId), workId: wonderWorkId(wonderId, record.orderId), wonderId, name: definition.name, cityId: city.id, townName: city.name, civId: city.civId, tileId: tile.id,
      q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation), color: civilization && /^#[0-9a-f]{6}$/i.test(civilization.color) ? civilization.color : '#c8a962', status: record.status === 'completed' ? 'built' as const : 'building' as const, record }];
  }).toSorted((a, b) => a.tileId - b.tileId || a.id.localeCompare(b.id));
}

export function wonderSiteLabel(site: WonderSiteView): string {
  return `${site.name} · ${site.status === 'built' ? 'World wonder' : 'Under construction'}`;
}
