import type { ImprovementView } from './improvement-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export const SHORE_FISHERY_MARK_PATH = 'M4 12L9 6L17 8L20 12L17 16L9 18ZM4 12L1 8V16ZM16 11h.01';

export function shoreFisheryParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => {
    parts.push({ id: `${view.id}:fishery-${id}`, shape: 'box', material, position, scale, rotation: 0 });
  };
  add('ground', 'soil', [0, .025, 0], [1.2, .05, .9]);
  add('identity', 'identity', [-.6, .07, 0], [.05, .08, .8]);
  if (view.status === 'building') {
    for (const x of [-.44, .44]) add(`survey-${x}`, 'timber', [x, .14, -.25], [.065, .28, .065]);
    add('survey-line', 'grain', [0, .26, -.25], [.88, .025, .025]);
  } else {
    for (const x of [-.44, .44]) add(`post-${x}`, 'timber', [x, .31, -.25], [.065, .62, .065]);
    add('beam', 'timber', [0, .62, -.25], [.95, .06, .065]);
    if (detail !== 'close') add('net', 'canopy', [0, .36, -.25], [.76, .38, .018]);
    add('bottom-cord', 'grain', [0, .17, -.25], [.76, .025, .025]);
    if (detail !== 'far') {
      add('bin', 'timber', [.31, .1, .23], [.26, .2, .23]);
      add('mat', 'grain', [-.18, .06, .22], [.38, .035, .3]);
    }
    if (detail === 'close') {
      for (const x of [-.19, 0, .19]) add(`strand-vertical-${x}`, 'grain', [x, .36, -.23], [.015, .38, .014]);
      for (const y of [.27, .45]) add(`strand-horizontal-${y}`, 'grain', [0, y, -.23], [.76, .015, .014]);
    }
  }
  return parts;
}
