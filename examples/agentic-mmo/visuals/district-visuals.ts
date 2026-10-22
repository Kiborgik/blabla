import type { DistrictAdjacencyFacts } from '../core/simulation/districts.ts';
import { METRIC_LABELS, civilizationIdentity } from './visual-language.ts';
import { currentBuildingOperation } from './settlement-development.ts';
import type { OperationContext } from './settlement-development.ts';
import type { ConstructionOrder, Resources } from '../core/types.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface DistrictView extends OperationContext {
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

export function districtLandmarks(district: DistrictView, detail: DetailLevel): string[] {
  if (district.status !== 'built') return [];
  const installed = new Set((district.attachments ?? []).filter(item => item.status === 'built').map(item => item.buildingId));
  if (district.library === 'built') installed.add('library');
  const priority = district.buildingId === 'industrial-zone' ? ['factory', 'coal-plant', 'foundry', 'guild-workshop']
    : district.buildingId === 'commercial-hub' ? ['bank', 'market']
    : district.buildingId === 'theater-square' ? ['printing-house'] : ['observatory', 'research-lab', 'university', 'library'];
  const maximum = detail === 'close' ? 4 : detail === 'mid' || district.buildingId === 'industrial-zone' ? 2 : 1;
  return priority.filter(id => installed.has(id)).slice(0, maximum);
}

export function districtParts(district: DistrictView, detail: DetailLevel): VisualPart[] {
  const landmarks = new Set(districtLandmarks(district, detail));
  const identity = civilizationIdentity(district.civId);
  district = { ...district, library: district.library === 'building' || landmarks.has('library') ? district.library : 'absent',
    attachments: (district.attachments ?? []).filter(item => item.status === 'building' || landmarks.has(item.buildingId)).toSorted((left, right) => left.buildingId.localeCompare(right.buildingId)),
  };
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => {
    parts.push({ id: `${district.id}:${id}`, shape, material, position, scale, rotation: 0 });
  };
  if (district.status === 'building' || detail === 'close') add('site', 'cylinder', district.status === 'building' ? 'soil' : 'stone', [0, .035, 0], [1.5, .07, 1.25]);
  add('identity', 'box', 'identity', [0, .055, .64], [.75, .07, .09]);
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
    const factory = district.attachments?.find(item => item.buildingId === 'factory');
    const coal = district.attachments?.find(item => item.buildingId === 'coal-plant');
    const guild = district.attachments?.find(item => item.buildingId === 'guild-workshop');
    const foundry = district.attachments?.find(item => item.buildingId === 'foundry');
    if (detail !== 'far') add('industrial-yard', 'box', 'stone', [0, .08, 0], [1.15, .06, .9]);
    if (factory?.status !== 'built') {
      add('industrial-wall', 'box', 'stone', [-.3, .28, -.25], [.76, .42, .42]);
      for (const x of [-.5, -.1]) add(`industrial-roof-${x}`, 'gable', 'metal', [x, .59, -.25], [.43, .24, .53]);
    }
    if (!coal) add('industrial-chimney', 'box', 'stone', [.53, .6, -.36], [.2, 1.02, .22]);
    if (guild?.status === 'building') add('guild-foundation', 'box', 'timber', [-.46, .14, .47], [.48, .12, .37]);
    else if (guild) {
      add('guild-wall', 'box', 'timber', [-.46, .28, .47], [.48, .28, .37]);
      add('guild-roof', 'gable', 'roof', [-.46, .51, .47], [.58, .18, .45]);
    }
    if (foundry?.status === 'building') add('foundry-foundation', 'box', 'timber', [.54, .14, .4], [.37, .12, .42]);
    else if (foundry) {
      add('foundry-body', 'cylinder', 'stone', [.54, .36, .4], [.37, .48, .42]);
      add('foundry-cap', 'cone', 'metal', [.54, .73, .4], [.45, .26, .5]);
      add('foundry-stack', 'box', 'stone', [.67, .65, .19], [.12, 1.05, .13]);
    }
    if (factory?.status === 'building') {
      add('factory-foundation', 'box', 'soil', [-.17, .13, .08], [.94, .12, .5]);
      add('factory-frame', 'box', 'timber', [-.55, .36, -.08], [.08, .58, .08]);
      if (detail !== 'far') add('factory-frame-beam', 'box', 'timber', [-.17, .63, -.08], [.86, .07, .08]);
    } else if (factory) {
      add('factory-hall', 'box', 'stone', [-.17, .4, .08], [.94, .58, .5]);
      add('factory-roof', 'gable', 'metal', [-.4, .82, .08], [.49, .26, .59]);
      add('factory-roof-east', 'gable', 'metal', [.07, .82, .08], [.49, .26, .59]);
      if (detail !== 'far') add('factory-windows', 'box', 'water', [-.17, .46, .34], [.75, .14, .025]);
      if (detail !== 'far' && currentBuildingOperation(district, 'factory')?.localPower?.consumed) add('operation:factory:power', 'box', 'grain', [-.17, .46, .36], [.59, .07, .03]);
    }
    if (coal?.status === 'building') {
      add('coal-plant-foundation', 'box', 'soil', [.47, .13, -.41], [.45, .12, .49]);
      add('coal-plant-frame', 'box', 'timber', [.66, .49, -.56], [.08, .82, .08]);
      if (detail !== 'far') add('coal-plant-frame-beam', 'box', 'timber', [.47, .87, -.56], [.45, .07, .08]);
    } else if (coal) {
      add('coal-plant-boiler', 'cylinder', 'metal', [.42, .43, -.4], [.45, .66, .48]);
      add('coal-plant-stack', 'cylinder', 'stone', [.62, .88, -.54], [.2, 1.7, .2]);
      if (detail !== 'far') add('coal-plant-stack-cap', 'cylinder', 'water', [.62, 1.74, -.54], [.25, .08, .25]);
      if (detail !== 'far' && (currentBuildingOperation(district, 'coal-plant')?.localPower?.generated ?? 0) > 0) add('operation:coal-plant:smoke', 'canopy', 'rockLight', [.65, 1.99, -.54], [.3, .4, .3]);
    }
    if (detail !== 'far' && foundry?.status === 'built' && currentBuildingOperation(district, 'foundry')) add('operation:foundry:smoke', 'canopy', 'rockLight', [.67, 1.35, .19], [.2, .28, .2]);
    if (detail === 'close' && guild?.status === 'built') add('guild-sign', 'box', 'grain', [-.46, .32, .67], [.2, .12, .03]);
  } else if (district.buildingId === 'commercial-hub') {
    if (detail !== 'far') add('commerce-court', 'box', 'soil', [0, .05, 0], [1.12, .04, .94]);
    for (const x of [-.48, .48]) {
      add(`stall-${x}`, 'box', 'timber', [x, .25, -.3], [.38, .3, .5]);
      add(`awning-${x}`, 'gable', identity.roof, [x, .5, -.3], [.52, .18, .62]);
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
      add(`hall-roof-${x}`, 'gable', x < 0 ? identity.roof : 'plaster', [x, .57, -.23], [.58, .28, .76]);
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
    const lab = district.attachments?.find(item => item.buildingId === 'research-lab');
    if (lab?.status === 'building') {
      add('research-lab-foundation', 'box', 'soil', [.56, .14, .34], [.47, .12, .55]);
      add('research-lab-frame', 'box', 'timber', [.73, .41, .13], [.07, .66, .07]);
      if (detail !== 'far') add('research-lab-frame-beam', 'box', 'timber', [.56, .71, .13], [.47, .07, .07]);
    } else if (lab) {
      add('research-lab-block', 'box', 'plaster', [.56, .61, .34], [.47, 1.06, .55]);
      add('research-lab-roof', 'box', 'metal', [.56, 1.19, .34], [.57, .1, .65]);
      if (detail !== 'far') add('research-lab-windows', 'box', 'water', [.56, .75, .63], [.34, .2, .025]);
      if (detail !== 'far' && (currentBuildingOperation(district, 'research-lab')?.localPower?.consumed ?? 0) > 0) add('operation:research-lab:power', 'box', 'grain', [.56, .75, .65], [.29, .08, .03]);
    }
    add('courtyard', 'box', 'stone', [0, .05, .18], [.2, .04, .5]);
    if (detail !== 'far') {
      for (const x of [-.43, .43]) add(`door-${x}`, 'box', 'timber', [x, .23, .11], [.13, .27, .04]);
      if (district.library === 'built') add('library-book', 'gable', 'grain', [0, .37, .63], [.24, .1, .04]);
    }
    if (detail === 'close') for (const x of [-.68, .68]) add(`garden-${x}`, 'box', 'canopy', [x, .15, .3], [.11, .12, .4]);
  }
  const priority = (part: VisualPart): number => {
    const id = part.id.slice(district.id.length + 1);
    if (id.endsWith('-foundation') || id.endsWith('-frame') || /^(coal-plant-stack|factory-roof|research-lab-block)$/.test(id)) return 0;
    if (/^(hall-roof-|industrial-roof-|awning-)/.test(id) || /^(guild-roof|foundry-body|foundry-cap|library-roof|university-tower|university-roof|observatory-body|observatory-crown|coal-plant-boiler|factory-hall|factory-roof-east|research-lab-roof|theater-stage|theater-backdrop)$/.test(id) || id.startsWith('operation:')) return 1;
    return id === 'site' || id === 'identity' ? 2 : 3;
  };
  const selected = new Set(parts.toSorted((left, right) => priority(left) - priority(right)).slice(0, DISTRICT_PART_BUDGETS[detail]).map(part => part.id));
  return parts.filter(part => selected.has(part.id)).map(part => ({ ...part,
    position: [part.position[0] * .72, part.position[1], part.position[2] * .72],
    scale: [part.scale[0] * .72, part.scale[1], part.scale[2] * .72],
  }));
}
