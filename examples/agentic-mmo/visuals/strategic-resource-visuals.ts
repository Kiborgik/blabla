import { observedStrategicResources } from '../core/simulation/metals.ts';
import { STRATEGIC_RESOURCE_IDS } from '../core/content.ts';
import type { StrategicDeposit, StrategicExtractionResult, StrategicResource, StrategicResources, WorldState } from '../core/types.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';
import { mapTileHeight } from './route-paths.ts';

export interface StrategicAmount { resource: StrategicResource; label: string; amount: number }

export function strategicResourceLabel(resource: StrategicResource): string { return resource === 'coal' ? 'Coal' : 'Iron'; }

export function strategicResourceAmounts(values: StrategicResources | undefined): StrategicAmount[] {
  return STRATEGIC_RESOURCE_IDS.flatMap(resource => values?.[resource] === undefined ? [] : [{ resource, label: strategicResourceLabel(resource), amount: values[resource] }]);
}

export interface DepositView extends StrategicDeposit {
  id: string;
  q: number;
  r: number;
  height: number;
  revealedTo: Array<{ id: number; name: string }>;
}

export const SITE_MARK_PATHS = {
  mine: 'M5 20L16 5M4 8Q12 1 21 8L19 11Q12 6 5 11Z',
  campus: 'M3 6L12 3L21 6L12 9ZM5 10V19H19V10M9 12V19M15 12V19',
  commerce: 'M3 10L5 4H19L21 10M4 10V20H20V10M3 10Q6 14 9 10Q12 14 15 10Q18 14 21 10',
  industry: 'M3 20V10L9 6V11L15 7V12H20V4H23V20ZM7 15V17M12 15V17M17 15V17',
  culture: 'M3 5H21V13M3 5L8 9V13M21 5L16 9V13M6 16H18M3 20H21M8 16V20M16 16V20',
  iron: 'M3 16L8 7L14 4L21 12L18 20H7ZM8 7L11 14L18 20M11 14L21 12',
} as const;

export function projectRevealedDeposits(state: WorldState): DepositView[] {
  const revealed = new Map<number, DepositView>();
  for (const civilization of state.civilizations) {
    for (const deposit of observedStrategicResources(state, civilization.id).revealedDeposits ?? []) {
      const tile = state.tiles.find(candidate => candidate.id === deposit.tileId);
      if (!tile || tile.terrain === 'ocean') continue;
      const view = revealed.get(tile.id) ?? { ...structuredClone(deposit), id: `deposit:${deposit.resource}:${tile.id}`, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation), revealedTo: [] };
      view.revealedTo.push({ id: civilization.id, name: civilization.name });
      revealed.set(tile.id, view);
    }
  }
  return [...revealed.values()].toSorted((a, b) => a.tileId - b.tileId);
}

export function depositLabel(deposit: StrategicDeposit): string {
  return `${strategicResourceLabel(deposit.resource)} · Tile ${deposit.tileId} · ${deposit.remaining} / ${deposit.initialReserve} left`;
}

export function extractionFacts(result: StrategicExtractionResult): string[] {
  const label = strategicResourceLabel(result.resource);
  if (result.status === 'unrevealed') return [`Round ${result.round} · No ${label} extracted · Discovery required`];
  const state = result.status === 'extracted' ? `Extracted ${result.quantity} ${label}`
    : result.status === 'storage-full' ? `No ${label} extracted · Storage full`
      : result.status === 'exhausted' ? `No ${label} extracted · Deposit exhausted` : `No ${label} extracted · Discovery required`;
  return [`Round ${result.round} · ${state}`, `Deposit at Tile ${result.tileId}: ${result.reserveBefore} → ${result.reserveAfter} left`,
    `Stored ${label} then: ${result.stockBefore} → ${result.stockAfter} / ${result.capacity} capacity`,
    'Historical extraction. Ordinary materials and later trade are separate.'];
}

export function depositParts(deposit: DepositView, detail: DetailLevel): VisualPart[] {
  const count = detail === 'far' ? 2 : detail === 'mid' ? 3 : 4;
  return Array.from({ length: count }, (_, index) => ({ id: `${deposit.id}:rock-${index}`, shape: 'cone', material: deposit.remaining ? 'metal' : 'rock',
    position: [(index % 2 - .5) * .45, .24, (Math.floor(index / 2) - .5) * .4], scale: [.5, .48 + index * .06, .48], rotation: index * .7 }));
}

export function placeSiteMarks(anchors: readonly { id: string; cityId: string; family?: string; x: number; y: number }[], blocked: readonly { x: number; y: number; width: number; height: number }[], width: number, height: number, selected: string): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const occupied = blocked.map(box => ({ left: box.x - box.width / 2, right: box.x + box.width / 2, top: box.y, bottom: box.y + box.height }));
  const marks: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  const families = new Set<string>();
  const ordered = anchors.map(anchor => {
    const first = anchor.cityId === selected && anchor.family !== undefined && !families.has(anchor.family);
    if (anchor.cityId === selected && anchor.family) families.add(anchor.family);
    return { anchor, priority: anchor.cityId !== selected ? 2 : first ? 0 : 1 };
  }).toSorted((a, b) => a.priority - b.priority);
  for (const { anchor } of ordered) {
    if (marks.length >= 12) break;
    const offsets = [[0, 0], [0, -48], [48, 0], [-48, 0], [0, 48], [48, -48], [-48, -48], [48, 48], [-48, 48], [0, -60], [60, 0], [-60, 0]];
    if (anchor.cityId === selected && anchor.family) {
      const expanded: number[][] = [];
      for (let dx = -120; dx <= 120; dx += 24) for (let dy = -120; dy <= 120; dy += 24) expanded.push([dx, dy]);
      offsets.push(...expanded.toSorted((a, b) => Math.hypot(a[0] ?? 0, a[1] ?? 0) - Math.hypot(b[0] ?? 0, b[1] ?? 0)));
    }
    for (const [dx, dy] of offsets) {
      const x = anchor.x + (dx ?? 0); const y = anchor.y + (dy ?? 0);
      if (x < 22 || y < 22 || x > width - 22 || y > height - 22) continue;
      if (occupied.some(box => x + 22 > box.left && x - 22 < box.right && y + 22 > box.top && y - 22 < box.bottom)) continue;
      marks.push({ id: anchor.id, x, y, width: 44, height: 44 });
      occupied.push({ left: x - 22, right: x + 22, top: y - 22, bottom: y + 22 });
      break;
    }
  }
  return marks;
}
