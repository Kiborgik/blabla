import type { CityImprovement, ImprovementConstructionOrder, ImprovementConstructionCompletion, Resources } from '../core/types.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface ImprovementView {
  id: string;
  cityId: string;
  townName: string;
  civId: number;
  improvementId: string;
  name: string;
  tileId: number;
  q: number;
  r: number;
  height: number;
  color: string;
  status: 'building' | 'built';
  construction: ImprovementConstructionOrder | null;
  completion: ImprovementConstructionCompletion | null;
  operation: CityImprovement['operation'] | null;
  baseProduction: Partial<Resources>;
  residentsRequired: number;
}

export const IMPROVEMENT_PART_BUDGETS = { far: 10, mid: 15, close: 20 } as const;

export function improvementLabel(view: ImprovementView): string {
  return `${view.name}${view.status === 'building' ? ' · Building' : view.operation?.enabled === false ? ' · Paused' : ''}`;
}

export function improvementLastLabel(result: CityImprovement['operation']['lastResult']): string {
  if (!result) return 'No operating record yet';
  if (result.status === 'paused') return 'Paused that season';
  if (result.status === 'blocked') return result.blockedReason === 'resident-shortage' ? 'Not enough local support' : 'Site could not operate';
  return Object.values(result.produced).some(amount => amount > 0) ? 'Materials made' : 'Worked with no output';
}

export function improvementParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  if (view.improvementId !== 'mine') return [];
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id: `${view.id}:${id}`, shape, material, position, scale, rotation });
  };
  add('worked-ground', 'box', 'grain', [0, .05, 0], [1.68, .1, 1.45]);
  add('cut-floor', 'box', 'soil', [-.12, .12, .06], [.9, .08, .8]);
  add('cut-bank', 'box', 'soil', [0, .2, -.55], [1.55, .3, .28]);
  add('identity', 'box', 'identity', [-.79, .16, 0], [.08, .12, 1.3]);
  if (view.status === 'building') {
    for (const x of [-.52, .35]) add(`survey-frame-${x}`, 'box', 'timber', [x, .38, -.18], [.1, .6, .12]);
    if (detail !== 'far') add('survey-beam', 'box', 'timber', [-.085, .7, -.18], [.97, .1, .14]);
  } else {
    add('opening', 'box', 'timber', [-.15, .25, -.26], [.7, .44, .24]);
    for (const x of [-.56, .26]) add(`portal-${x}`, 'box', 'stone', [x, .32, -.19], [.14, .54, .32]);
    add('portal-top', 'box', 'stone', [-.15, .65, -.19], [1, .16, .38]);
    add('spoil', 'cone', 'stone', [.53, .25, .38], [.55, .45, .55]);
    if (detail !== 'far') {
      for (const x of [-.33, .03]) add(`track-${x}`, 'box', 'metal', [x, .17, .33], [.045, .045, .72]);
      add('stack', 'box', 'stone', [.51, .16, -.08], [.3, .2, .3]);
    }
    if (detail === 'close') for (const z of [.05, .27, .49]) add(`sleeper-${z}`, 'box', 'timber', [-.15, .15, z], [.55, .045, .07]);
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}
