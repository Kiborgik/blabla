import type { ConstructionOrder, Resources } from '../core/types.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface DistrictView {
  id: string;
  cityId: string;
  townName: string;
  civId: number;
  tileId: number;
  q: number;
  r: number;
  height: number;
  color: string;
  status: 'building' | 'built';
  buildingId?: string;
  name?: string;
  attachments?: Array<{ buildingId: string; name: string; status: 'building' | 'built' }>;
  library: 'absent' | 'building' | 'built';
  construction: ConstructionOrder | null;
  baseProduction: Partial<Resources>;
}

export const DISTRICT_PART_BUDGETS = { far: 12, mid: 18, close: 24 } as const;

export function districtCaptionPlacement(anchor: { x: number; y: number }, occupied: readonly { x: number; y: number; width: number; height: number }[], width: number, height: number, labelWidth: number, labelHeight = 16): { x: number; y: number; width: number; height: number } | null {
  for (const [dx, dy] of [[0, -36], [-76, -16], [76, -16], [0, 40], [-76, 40], [76, 40], [0, -60], [0, 60], [0, -76], [0, 76]]) {
    const x = anchor.x + (dx ?? 0);
    const y = anchor.y + (dy ?? 0);
    const box = { x, y, width: labelWidth, height: labelHeight };
    if (x - labelWidth / 2 < 8 || x + labelWidth / 2 > width - 8 || y < 8 || y + labelHeight > height - 8) continue;
    if (occupied.some(other => Math.abs(x - other.x) < (labelWidth + other.width) / 2 + 6 && y < other.y + other.height + 6 && y + labelHeight + 6 > other.y)) continue;
    return box;
  }
  return null;
}

export function districtLabel(district: DistrictView): string {
  const name = district.name ?? 'Campus';
  if (district.status === 'building') return `${name} · Building`;
  const attachments = (district.attachments ?? []).filter(item => item.buildingId !== 'library');
  if (district.library !== 'absent') attachments.unshift({ buildingId: 'library', name: 'Library', status: district.library });
  return name + attachments.map(item => item.status === 'built' ? ` + ${item.name}` : ` · ${item.name} building`).join('');
}

export function districtParts(district: DistrictView, detail: DetailLevel): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => {
    parts.push({ id: `${district.id}:${id}`, shape, material, position, scale, rotation: 0 });
  };
  add('site', 'box', district.status === 'building' ? 'soil' : 'plaster', [0, .045, 0], [1.55, .09, 1.35]);
  add('identity', 'box', 'identity', [0, .1, .68], [1.55, .06, .08]);
  if (district.status === 'building') {
    for (const x of [-.55, .55]) add(`foundation-${x}`, 'box', 'timber', [x, .16, -.12], [.12, .2, .9]);
    add('foundation-back', 'box', 'timber', [0, .16, -.55], [1.1, .2, .12]);
    if (detail !== 'far') for (const x of [-.55, .55]) add(`frame-${x}`, 'box', 'timber', [x, .42, -.48], [.09, .72, .09]);
    if (detail === 'close') add('supplies', 'box', 'stone', [0, .2, .25], [.48, .22, .35]);
  } else if (district.buildingId === 'commercial-hub') {
    add('commerce-court', 'box', 'grain', [0, .12, 0], [1.3, .06, 1.1]);
    for (const x of [-.48, .48]) {
      add(`stall-${x}`, 'box', 'timber', [x, .25, -.3], [.38, .3, .5]);
      add(`awning-${x}`, 'gable', 'roof', [x, .5, -.3], [.52, .18, .62]);
    }
    for (const annex of district.attachments ?? []) {
      if (annex.status === 'building') add(`${annex.buildingId}-foundation`, 'box', 'timber', [0, .14, .4], [1.1, .12, .4]);
      else if (annex.buildingId === 'market') {
        add('market-counter', 'box', 'timber', [-.32, .25, .42], [.57, .28, .38]);
        add('market-awning', 'gable', 'grain', [-.32, .53, .42], [.7, .2, .5]);
      } else if (annex.buildingId === 'bank') {
        add('bank-vault', 'box', 'plaster', [.36, .38, .4], [.52, .55, .5]);
        add('bank-roof', 'gable', 'metal', [.36, .76, .4], [.64, .23, .6]);
      }
    }
    if (detail !== 'far') add('commerce-sign', 'box', 'metal', [0, .3, -.4], [.18, .35, .08]);
  } else {
    for (const x of [-.43, .43]) {
      add(`hall-wall-${x}`, 'box', 'stone', [x, .25, -.23], [.48, .4, .66]);
      add(`hall-roof-${x}`, 'gable', 'plaster', [x, .57, -.23], [.58, .28, .76]);
    }
    add('courtyard', 'box', 'grain', [0, .11, .18], [.24, .04, .6]);
    if (district.library === 'built') {
      add('library-wall', 'box', 'plaster', [0, .28, .43], [.95, .34, .36]);
      add('library-roof', 'gable', 'metal', [0, .56, .43], [1.06, .25, .46]);
    } else if (district.library === 'building') add('library-foundation', 'box', 'timber', [0, .14, .44], [1, .12, .39]);
    const university = district.attachments?.find(item => item.buildingId === 'university');
    if (university?.status === 'building') add('university-foundation', 'box', 'timber', [0, .14, -.58], [.75, .12, .35]);
    else if (university) {
      add('university-tower', 'box', 'plaster', [0, .5, -.5], [.46, .78, .46]);
      add('university-roof', 'cone', 'metal', [0, 1.02, -.5], [.62, .32, .62]);
    }
    if (detail !== 'far') {
      for (const x of [-.43, .43]) add(`door-${x}`, 'box', 'timber', [x, .23, .11], [.13, .27, .04]);
      if (district.library === 'built') add('library-book', 'gable', 'grain', [0, .37, .63], [.24, .1, .04]);
    }
    if (detail === 'close') for (const x of [-.68, .68]) add(`garden-${x}`, 'box', 'canopy', [x, .15, .3], [.11, .12, .4]);
  }
  return parts.slice(0, DISTRICT_PART_BUDGETS[detail]);
}
