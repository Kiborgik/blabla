import { isCivicWorksReceipt } from '../core/civic-works-validation.ts';
import { CIVIC_WORKS_RULES } from '../core/civic-works-content.ts';
import type { CivicWorksCommission, CivicWorksReceipt, CivicWorksState } from '../core/civic-works-types.ts';
import type { BuildingOperation, City, ConstructionOrder, GameEvent } from '../core/types.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface CivicWorksView {
  active: CivicWorksCommission | null;
  last: CivicWorksReceipt | null;
}

export function civicWorksForCity(works: CivicWorksState | undefined, city: Pick<City, 'id' | 'civId'>): CivicWorksView | undefined {
  if (works?.ruleVersion !== CIVIC_WORKS_RULES.ruleVersion) return undefined;
  const active = works.active.find(entry => entry.cityId === city.id && entry.civId === city.civId) ?? null;
  const last = works.lastResults.find(entry => isCivicWorksReceipt(entry) && entry.cityId === city.id && entry.civId === city.civId) ?? null;
  return active || last ? structuredClone({ active, last }) : undefined;
}

export function paidCivicWorksReceipt(receipt: CivicWorksReceipt | null | undefined): receipt is CivicWorksReceipt {
  return isCivicWorksReceipt(receipt) && receipt.status === 'worked';
}

export function currentCivicWorksReceipt(site: {
  cityId: string; civId: number; tileId: number; round?: number; terminal?: boolean;
  order: ConstructionOrder | null | undefined; donor: BuildingOperation | undefined; works: CivicWorksView | undefined;
}): CivicWorksReceipt | null {
  const receipt = site.works?.last;
  const active = site.works?.active;
  const order = site.order;
  const donor = site.donor?.lastResult;
  if (site.terminal || !paidCivicWorksReceipt(receipt) || receipt.terminal !== null || receipt.round !== site.round
    || !active || active.id !== receipt.commissionId || active.cityId !== site.cityId || active.civId !== site.civId
    || active.orderId !== receipt.orderId || active.buildingId !== receipt.buildingId || active.targetTileId !== site.tileId
    || active.firstRound !== receipt.firstRound || active.expiresRound !== receipt.expiresRound || active.acceptedEventId !== receipt.acceptedEventId
    || receipt.round < active.firstRound || receipt.round > active.expiresRound
    || receipt.cityId !== site.cityId || receipt.civId !== site.civId || receipt.targetTileId !== site.tileId
    || !order || !('buildingId' in order) || 'kind' in order || order.id !== receipt.orderId || order.cityId !== site.cityId
    || order.buildingId !== receipt.buildingId || (order.tileId !== undefined && order.tileId !== site.tileId)
    || order.workRequired !== receipt.workRequired || Math.abs(order.workDone - Math.min(receipt.workRequired, receipt.workBefore + receipt.ordinaryWork + receipt.extraWork)) > .005
    || order.workDone >= order.workRequired || !Object.values(order.paid).some(amount => Number.isFinite(amount) && amount > 0)
    || !site.donor?.enabled || donor?.status !== 'civic-works' || donor.round !== receipt.round
    || donor.civicWorksCommissionId !== receipt.commissionId || donor.residents?.allocated !== 3 || donor.residents.required !== 3
    || (['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'] as const).some(key => donor.residents?.[key] !== receipt.residents?.[key])
    || Object.values(donor.paid).some(amount => amount !== 0) || Object.values(donor.produced).some(amount => amount !== 0)) return null;
  return receipt;
}

export function civicWorksCrewParts(receipt: CivicWorksReceipt | null, detail: DetailLevel, site: {
  x: number; z: number; width: number; depth: number; heightScale?: number; front?: boolean;
}): VisualPart[] {
  if (detail === 'far' || !paidCivicWorksReceipt(receipt)) return [];
  const height = site.heightScale ?? 1;
  const positions = [[site.x - site.width / 2 - .20, site.z - .20], [site.x + site.width / 2 + .20, site.z - .20], [site.x - .24, site.front ? site.z + site.depth / 2 + .3 : site.z - site.depth / 2 - .55]];
  return positions.flatMap(([x = 0, z = 0], index): VisualPart[] => {
    const id = `civic-works:${receipt.commissionId}:${receipt.orderId}:resident-${index}`;
    return [
      { id: `${id}:tunic`, shape: 'cone', material: 'roof', position: [x, .18 * height, z], scale: [.19, .27 * height, .17], rotation: 0 },
      { id: `${id}:head`, shape: 'cylinder', material: 'neutral', position: [x, .35 * height, z], scale: [.11, .11 * height, .11], rotation: 0 },
      ...(detail === 'close' ? [{ id: `${id}:feet`, shape: 'box' as const, material: 'timber' as const, position: [x, .035 * height, z] as const, scale: [.14, .06 * height, .11] as const, rotation: 0 }] : []),
    ];
  });
}

export function recordedCivicWorks(event: GameEvent): CivicWorksReceipt | null {
  const receipt = event.civicWorks;
  if (!isCivicWorksReceipt(receipt) || receipt.eventId !== event.id || receipt.round !== event.round || receipt.civId !== event.actor
    || event.detail !== receipt.commissionId
    || event.target !== receipt.civId || event.tileId !== receipt.targetTileId || event.type !== `civic-works-${receipt.status}`) return null;
  return receipt;
}
