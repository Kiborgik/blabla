import type { DistrictAdjacencyFacts } from '../core/simulation/districts.ts';
import { METRIC_LABELS } from './visual-language.ts';
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
  adjacency?: DistrictAdjacencyFacts | null;
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

export function districtMark(district: DistrictView): 'culture' | 'industry' | 'commerce' | 'campus' {
  return district.buildingId === 'theater-square' ? 'culture' : district.buildingId === 'industrial-zone' ? 'industry' : district.buildingId === 'commercial-hub' ? 'commerce' : 'campus';
}

export function districtAdjacencySummary(facts: DistrictAdjacencyFacts): string {
  if (facts.source === 'wonder') return `Completed nearby wonders: ${facts.tileIds.length ? facts.tileIds.map(id => `Tile ${id}`).join(', ') : 'None'} · Wonder bonus: ${facts.bonus} ${METRIC_LABELS[facts.resource]} base (maximum ${facts.maximum}). Unfinished wonders do not count.`;
  if (facts.source === 'terrain') return `Nearby terrain: ${facts.tileIds.length ? facts.tileIds.map(id => `Tile ${id}`).join(', ') : 'None'} · Terrain bonus: ${facts.bonus} ${METRIC_LABELS[facts.resource]} base (maximum ${facts.maximum}).`;
  return `Completed nearby Mines: ${facts.tileIds.length ? facts.tileIds.map(id => `Tile ${id}`).join(', ') : 'None'} · Mine bonus: ${facts.bonus} ${METRIC_LABELS[facts.resource]} base (maximum ${facts.maximum}). Paused Mines still count; unfinished Mines do not.`;
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
  } else if (district.buildingId === 'theater-square') {
    add('theater-court', 'box', 'grain', [0, .11, 0], [.95, .04, .82]);
    add('theater-stage', 'box', 'timber', [0, .25, -.37], [1.15, .3, .42]);
    add('theater-backdrop', 'box', 'identity', [0, .51, -.58], [1.2, .7, .08]);
    add('theater-seats-back', 'box', 'stone', [0, .22, .39], [1.1, .24, .24]);
    for (const x of [-.56, .56]) add(`theater-seats-${x}`, 'box', 'stone', [x, .22, .08], [.23, .24, .48]);
    const printing = district.attachments?.find(item => item.buildingId === 'printing-house');
    if (printing?.status === 'building') add('printing-foundation', 'box', 'timber', [.53, .14, -.4], [.5, .12, .62]);
    else if (printing) {
      add('printing-wall', 'box', 'plaster', [.53, .35, -.4], [.49, .48, .65]);
      add('printing-roof', 'gable', 'roof', [.53, .77, -.4], [.62, .35, .77]);
    }
    if (detail !== 'far') {
      add('theater-step', 'box', 'timber', [0, .17, -.1], [.65, .12, .13]);
      for (const x of [-.55, .55]) add(`theater-post-${x}`, 'box', 'timber', [x, .51, -.58], [.08, .78, .1]);
    }
    if (detail === 'close' && printing?.status === 'built') add('printing-sign', 'box', 'grain', [.53, .4, -.05], [.25, .18, .04]);
  } else if (district.buildingId === 'industrial-zone') {
    add('industrial-yard', 'box', 'stone', [0, .12, 0], [1.35, .06, 1.12]);
    add('industrial-wall', 'box', 'stone', [-.16, .32, -.25], [.98, .42, .59]);
    for (const x of [-.4, .08]) add(`industrial-roof-${x}`, 'gable', 'metal', [x, .66, -.25], [.53, .28, .7]);
    add('industrial-chimney', 'box', 'stone', [.53, .6, -.36], [.2, 1.02, .22]);
    const guild = district.attachments?.find(item => item.buildingId === 'guild-workshop');
    if (guild?.status === 'building') add('guild-foundation', 'box', 'timber', [-.08, .14, .38], [1.08, .12, .41]);
    else if (guild) {
      add('guild-wall', 'box', 'timber', [-.08, .31, .38], [1.06, .4, .42]);
      add('guild-roof', 'gable', 'roof', [-.08, .64, .38], [1.2, .25, .53]);
    }
    const foundry = district.attachments?.find(item => item.buildingId === 'foundry');
    if (foundry?.status === 'building') add('foundry-foundation', 'box', 'timber', [.6, .14, .33], [.4, .12, .53]);
    else if (foundry) {
      add('foundry-body', 'cylinder', 'stone', [.6, .35, .33], [.4, .5, .53]);
      add('foundry-cap', 'cone', 'metal', [.6, .73, .33], [.49, .28, .61]);
      add('foundry-stack', 'box', 'stone', [.68, .65, .08], [.13, 1.05, .15]);
    }
    if (detail !== 'far') {
      add('industrial-door', 'box', 'timber', [-.16, .27, .06], [.23, .3, .04]);
      if (!foundry) add('industrial-stock', 'box', 'metal', [.54, .22, .36], [.25, .22, .36]);
    }
    if (detail === 'close' && guild?.status === 'built') add('guild-sign', 'box', 'grain', [-.08, .4, .62], [.22, .15, .04]);
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
    const observatory = district.attachments?.find(item => item.buildingId === 'observatory');
    if (observatory?.status === 'building') add('observatory-foundation', 'box', 'timber', [-.69, .14, .24], [.5, .12, .5]);
    else if (observatory) {
      add('observatory-body', 'cylinder', 'plaster', [-.69, .49, .24], [.47, .76, .47]);
      add('observatory-crown', 'canopy', 'metal', [-.69, .99, .24], [.62, .42, .62]);
    }
    add('courtyard', 'box', 'grain', [0, .11, .18], [.24, .04, .6]);
    if (detail !== 'far') {
      for (const x of [-.43, .43]) add(`door-${x}`, 'box', 'timber', [x, .23, .11], [.13, .27, .04]);
      if (district.library === 'built') add('library-book', 'gable', 'grain', [0, .37, .63], [.24, .1, .04]);
    }
    if (detail === 'close') for (const x of [-.68, .68]) add(`garden-${x}`, 'box', 'canopy', [x, .15, .3], [.11, .12, .4]);
  }
  return parts.slice(0, DISTRICT_PART_BUDGETS[detail]);
}
