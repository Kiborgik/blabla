import type { DetailLevel, VisualPart } from './world-visuals.ts';

interface LandmarkIdentity {
  orderId: string;
  cityId: string;
  civId: number;
  tileId: number;
}

export type WonderLandmarkRecord = LandmarkIdentity & (
  { status: 'building'; workDone: number; workRequired: number }
  | { status: 'completed'; completionEventId: string; completedRound: number }
  | { status: 'lost'; resolutionEventId: string }
);

export const WONDER_PART_BUDGETS = { far: 14, mid: 22, close: 30 } as const;
export const WONDER_MARK_PATH = 'M12 1L14 5L19 6L15 9L16 13L12 11L8 13L9 9L5 6L10 5ZM2 14Q7 12 12 16Q17 12 22 14V22Q17 20 12 23Q7 20 2 22ZM12 16V23';

export interface WonderLandmarkVisual extends LandmarkIdentity {
  stage: 'foundations' | 'walls' | 'finishing' | 'complete' | 'ended' | 'unavailable';
  label: string;
  parts: VisualPart[];
}

export function greatLibraryVisual(record: WonderLandmarkRecord, detail: DetailLevel): WonderLandmarkVisual {
  const identity = { orderId: record.orderId, cityId: record.cityId, civId: record.civId, tileId: record.tileId };
  if (record.status === 'lost') return { ...identity, stage: record.resolutionEventId ? 'ended' : 'unavailable', label: record.resolutionEventId ? 'Great library · Reservation ended · See recorded result' : 'Great library · Outcome unavailable', parts: [] };
  if (record.status === 'completed' && !record.completionEventId) return { ...identity, stage: 'unavailable', label: 'Great library · Outcome unavailable', parts: [] };
  const validWork = record.status === 'building' && Number.isFinite(record.workDone) && record.workDone >= 0 && Number.isFinite(record.workRequired) && record.workRequired > 0;
  const progress = record.status === 'building' && validWork ? Math.min(1, record.workDone / record.workRequired) : 0;
  const stage = record.status === 'completed' ? 'complete' : progress < 1 / 3 ? 'foundations' : progress < 2 / 3 ? 'walls' : 'finishing';
  const label = record.status === 'completed' ? `Great library · Completed · Round ${record.completedRound}`
    : `Great library · Building · ${validWork ? `${record.workDone} / ${record.workRequired} work` : 'Work unavailable'}`;
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id: `${record.orderId}:${id}`, shape, material, position, scale, rotation });
  };
  add('terrace', 'box', 'stone', [0, .07, 0], [2.2, .14, 1.8]);
  add('upper-step', 'box', stage === 'complete' ? 'plaster' : 'soil', [0, .18, -.08], [1.98, .12, 1.5]);
  add('identity', 'box', 'identity', [0, .16, .91], [1.75, .09, .06]);
  if (stage === 'complete') {
    add('archive', 'cylinder', 'plaster', [0, .91, -.32], [.68, 1.32, .68]);
    add('archive-band', 'cylinder', 'grain', [0, 1.38, -.32], [.76, .12, .76]);
    add('crown', 'cone', 'grain', [0, 1.72, -.32], [.9, .46, .9]);
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
      add(`wing-${side}`, 'box', 'plaster', [sign * .62, .51, .02], [.66, .56, 1.05], sign * .24);
      add(`wing-${side}-roof`, 'gable', 'grain', [sign * .62, .94, .02], [.8, .36, 1.15], sign * .24);
    }
    add('entrance-step', 'box', 'plaster', [0, .25, .69], [.78, .12, .46]);
    for (const sign of [-1, 1]) add(`entrance-column-${sign}`, 'cylinder', 'plaster', [sign * .28, .54, .62], [.14, .5, .14]);
    add('entrance-pediment', 'gable', 'grain', [0, .92, .62], [.82, .26, .32], Math.PI / 2);
    if (detail !== 'far') {
      add('archive-door', 'box', 'timber', [0, .53, .04], [.22, .54, .05]);
      for (const sign of [-1, 1]) for (const z of [-.27, .2]) add(`colonnade-${sign}-${z}`, 'cylinder', 'plaster', [sign * .98, .52, z], [.12, .5, .12]);
    }
    if (detail === 'close') {
      add('book-left', 'box', 'neutral', [-.1, .45, .72], [.19, .06, .22], -.16);
      add('book-right', 'box', 'neutral', [.1, .45, .72], [.19, .06, .22], .16);
      for (const sign of [-1, 1]) add(`garden-${sign}`, 'box', 'canopy', [sign * .9, .21, .7], [.2, .12, .22]);
    }
  } else {
    for (const x of [-.9, .9]) for (const z of [-.63, .58]) add(`stake-${x}-${z}`, 'box', 'timber', [x, .47, z], [.1, .52, .1]);
    if (stage !== 'foundations') {
      const height = stage === 'walls' ? .34 : .58;
      for (const sign of [-1, 1]) add(`unfinished-wing-${sign}`, 'box', 'stone', [sign * .62, .24 + height / 2, .02], [.66, height, 1.05], sign * .24);
      add('unfinished-archive', 'cylinder', 'stone', [0, stage === 'walls' ? .49 : .79, -.32], [.68, stage === 'walls' ? .5 : 1.1, .68]);
    }
    if (stage === 'finishing') add('scaffold-crossbar', 'box', 'timber', [0, 1.42, -.32], [1.9, .1, .1]);
    if (detail !== 'far') add('stacked-stone', 'box', 'stone', [0, .35, .65], [.56, .22, .3]);
    if (detail === 'close') for (const sign of [-1, 1]) add(`scaffold-rail-${sign}`, 'box', 'timber', [sign * .9, .72, -.02], [.09, .09, 1.3]);
  }
  return { ...identity, stage, label, parts: parts.slice(0, WONDER_PART_BUDGETS[detail]) };
}
