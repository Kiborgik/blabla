import { RESOURCE_IDS } from '../core/content.ts';
import { METRIC_LABELS } from './visual-language.ts';
import { workedLandCompositionV1 } from './worked-land-composition.ts';
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
  const made = RESOURCE_IDS.filter(resource => (result.produced[resource] ?? 0) > 0).map(resource => METRIC_LABELS[resource]);
  return made.length ? `${made.join(' and ')} made` : 'Worked with no output';
}

export function improvementParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  return workedLandCompositionV1(view, improvementRecipeParts(view, detail));
}

function improvementRecipeParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  if (view.improvementId === 'lumber-mill') return lumberParts(view, detail);
  if (view.improvementId === 'pasture') return pastureParts(view, detail);
  if (view.improvementId !== 'mine') return [];
  if (detail !== 'close') return mineOverviewParts(view, detail);
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
    add('survey-beam', 'box', 'timber', [-.085, .7, -.18], [.97, .1, .14]);
  } else {
    add('opening', 'box', 'timber', [-.15, .25, -.26], [.7, .44, .24]);
    for (const x of [-.56, .26]) add(`portal-${x}`, 'box', 'stone', [x, .32, -.19], [.14, .54, .32]);
    add('portal-top', 'box', 'stone', [-.15, .65, -.19], [1, .16, .38]);
    add('spoil', 'cone', 'stone', [.53, .25, .38], [.55, .45, .55]);
    for (const x of [-.33, .03]) add(`track-${x}`, 'box', 'metal', [x, .17, .33], [.045, .045, .72]);
    add('stack', 'box', 'stone', [.51, .16, -.08], [.3, .2, .3]);
    for (const z of [.05, .27, .49]) add(`sleeper-${z}`, 'box', 'timber', [-.15, .15, z], [.55, .045, .07]);
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}

function mineOverviewParts(view: ImprovementView, detail: 'far' | 'mid'): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => { parts.push({ id: `${view.id}:${id}`, shape, material, position, scale, rotation: 0 }); };
  add('worked-ground', 'cylinder', 'soil', [0, .03, 0], [1.28, .06, 1.08]);
  add('cut-bank', 'box', 'rock', [-.16, .13, -.35], [.94, .16, .18]);
  add('identity', 'box', 'identity', [-.65, .07, 0], [.055, .08, .74]);
  if (view.status === 'building') {
    for (const x of [-.46, .2]) add(`survey-frame-${x}`, 'box', 'timber', [x, .22, -.25], [.07, .36, .08]);
    if (detail === 'mid') add('survey-beam', 'box', 'timber', [-.13, .36, -.25], [.73, .07, .08]);
  } else {
    add('opening', 'box', 'soil', [-.16, .075, .03], [.64, .09, .62]);
    add('spoil', 'cone', 'stone', [.4, .18, .24], [.48, .3, .44]);
    add('cut-timber', 'box', 'timber', [-.16, .18, -.25], [.66, .08, .08]);
    if (detail === 'mid') {
      for (const x of [-.46, .14]) add(`cut-support-${x}`, 'box', 'timber', [x, .13, -.25], [.07, .18, .08]);
      for (const x of [-.29, -.03]) add(`track-${x}`, 'box', 'metal', [x, .13, .2], [.035, .035, .48]);
    }
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}

function pastureParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => { parts.push({ id: `${view.id}:${id}`, shape, material, position, scale, rotation: 0 }); };
  add('pasture-ground', 'box', 'crop', [0, .035, 0], [1.65, .07, 1.45]);
  add('pasture-identity', 'box', 'identity', [-.8, .1, 0], [.06, .1, 1.4]);
  if (view.status === 'building') {
    for (const x of [-.65, .65]) add(`pasture-survey-${x}`, 'box', 'timber', [x, .25, -.6], [.07, .5, .07]);
    add('pasture-survey-line', 'box', 'grain', [0, .4, -.6], [1.3, .04, .04]);
  } else {
    for (const z of [-.62, .62]) add(`pasture-fence-${z}`, 'box', 'timber', [0, .25, z], [1.5, .12, .07]);
    add('pasture-fence-end', 'box', 'timber', [.74, .25, 0], [.07, .12, 1.3]);
    add('pasture-shelter-roof', 'gable', 'roof', [-.4, .55, -.36], [.7, .25, .5]);
    add('pasture-shelter-wall', 'box', 'timber', [-.4, .22, -.36], [.6, .44, .4]);
    if (detail !== 'far') {
      for (const x of [-.7, .7]) for (const z of [-.6, .6]) add(`pasture-post-${x}-${z}`, 'box', 'timber', [x, .25, z], [.08, .5, .08]);
    }
    if (detail === 'close') add('pasture-trough', 'box', 'stone', [.35, .11, -.3], [.45, .2, .22]);
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}

export const LUMBER_MARK_PATH = 'M3 19L9 5L15 19ZM7 13H11M9 19V23M14 16L18 12L22 16V22H14ZM16 18H20';

function lumberParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  if (detail !== 'close') return lumberOverviewParts(view, detail);
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => { parts.push({ id: `${view.id}:${id}`, shape, material, position, scale, rotation }); };
  add('lumber-platform', 'box', 'timber', [0, .08, 0], [1.5, .14, 1.15]);
  add('lumber-identity', 'box', 'identity', [-.77, .12, 0], [.06, .1, 1.15]);
  if (view.status === 'building') {
    for (const x of [-.55, .55]) add(`lumber-survey-${x}`, 'box', 'timber', [x, .35, -.35], [.1, .55, .1]);
    add('lumber-survey-beam', 'box', 'grain', [0, .6, -.35], [1.2, .06, .08]);
  } else {
    add('lumber-roof', 'gable', 'roof', [-.1, .8, -.17], [1.25, .4, .85]);
    add('lumber-saw', 'box', 'metal', [.45, .42, .35], [.08, .55, .48]);
    add('lumber-bench', 'box', 'timber', [.23, .25, .38], [.8, .3, .35]);
    for (const x of [-.6, .4]) add(`lumber-post-${x}`, 'box', 'timber', [x, .4, -.4], [.1, .65, .1]);
    add('lumber-wall', 'box', 'timber', [-.1, .4, -.55], [1.1, .65, .08]);
    for (const z of [.25, .5]) add(`lumber-stack-${z}`, 'box', 'timber', [-.55, .24, z], [.5, .18, .13]);
    for (const x of [-.4, -.12, .16]) add(`lumber-joist-${x}`, 'box', 'grain', [x, .17, -.1], [.06, .04, 1.1]);
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}

function lumberOverviewParts(view: ImprovementView, detail: 'far' | 'mid'): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => { parts.push({ id: `${view.id}:${id}`, shape, material, position, scale, rotation: 0 }); };
  add('lumber-platform', 'box', 'timber', [-.18, .04, -.26], [.8, .08, .62]);
  add('lumber-identity', 'box', 'identity', [-.65, .07, -.06], [.055, .08, .8]);
  if (view.status === 'building') {
    for (const x of [-.48, .12]) add(`lumber-survey-${x}`, 'box', 'timber', [x, .2, -.42], [.07, .32, .07]);
    add('lumber-survey-beam', 'box', 'grain', [-.18, .36, -.42], [.67, .05, .07]);
  } else {
    add('lumber-roof', 'gable', 'timber', [-.18, .4, -.26], [.74, .18, .56]);
    add('lumber-saw', 'box', 'metal', [.3, .27, .17], [.05, .32, .32]);
    add('lumber-bench', 'box', 'timber', [.22, .17, .19], [.65, .22, .28]);
    for (const x of [-.48, .12]) add(`lumber-post-${x}`, 'box', 'timber', [x, .2, -.42], [.07, .32, .07]);
    for (const z of [.25, .45]) add(`lumber-stack-${z}`, 'box', 'timber', [-.4, .13, z], [.72, .16, .14]);
    add('lumber-log-ends', 'box', 'grain', [-.765, .13, .35], [.035, .15, .34]);
    if (detail === 'mid') {
      add('lumber-stack-upper', 'box', 'timber', [-.4, .26, .35], [.64, .13, .14]);
      add('lumber-log-ends-upper', 'box', 'grain', [-.725, .26, .35], [.035, .12, .13]);
      add('lumber-brace', 'box', 'timber', [-.18, .3, -.42], [.67, .06, .07]);
    }
  }
  return parts.slice(0, IMPROVEMENT_PART_BUDGETS[detail]);
}
