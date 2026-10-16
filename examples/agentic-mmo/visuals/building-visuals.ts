import type { VisualPart } from './world-visuals.ts';
import { DETAIL_BUDGETS } from './visual-language.ts';
import type { DetailLevel, VisualIcon } from './visual-language.ts';

function part(id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): VisualPart {
  return { id, shape, material, position, scale, rotation: 0 };
}

export interface BuildingAppearance {
  id: string;
  icon: VisualIcon;
  label: string;
  corePartIds: readonly string[];
  parts: VisualPart[];
}

const APPEARANCES: Record<string, { icon: VisualIcon; label: string; corePartIds: readonly string[]; parts: (detail: DetailLevel) => VisualPart[] }> = {
  farm: {
    icon: 'farm', label: 'Farm', corePartIds: ['farm-soil', 'farm-row-0'], parts: (detail) => {
      const rows = DETAIL_BUDGETS[detail].fieldRows;
      return [part('farm-soil', 'box', 'soil', [1.02, .04, .35], [.78, .08, 1.12]),
        ...Array.from({ length: rows }, (_, row) => part(`farm-row-${row}`, 'box', 'crop', [1.02 + ((row + .5) / rows - .5) * .7, .1, .35], [.58 / rows, .09, .98]))];
    },
  },
  workshop: {
    icon: 'workshop', label: 'Workshop', corePartIds: ['workshop-roof'], parts: (detail) => [
      part('workshop-wall', 'box', 'timber', [-1.02, .25, .37], [.68, .5, .7]),
      part('workshop-roof', 'gable', 'roof', [-1.02, .65, .37], [.78, .32, .8]),
      ...(detail === 'far' ? [] : [part('workshop-chimney', 'box', 'stone', [-.77, .55, .55], [.15, 1.1, .15])]),
      ...(detail === 'close' ? [part('workshop-stack-0', 'box', 'timber', [-1.1, .1, .96], [.42, .2, .18]), part('workshop-stack-1', 'box', 'grain', [-.8, .08, .96], [.18, .16, .18])] : []),
    ],
  },
  irrigation: {
    icon: 'irrigation', label: 'Irrigation works', corePartIds: ['irrigation-cistern', 'irrigation-basin'], parts: (detail) => [
      part('irrigation-cistern', 'box', 'stone', [.84, .13, -.94], [.58, .26, .58]),
      part('irrigation-basin', 'box', 'water', [.84, .27, -.94], [.4, .03, .4]),
      ...(detail === 'far' ? [] : [part('irrigation-channel-stone', 'box', 'stone', [1.18, .065, -.43], [.22, .13, .68]), part('irrigation-channel', 'box', 'water', [1.18, .135, -.43], [.1, .02, .68])]),
      ...(detail === 'close' ? [part('irrigation-gate', 'box', 'timber', [1.18, .23, -.72], [.28, .18, .07])] : []),
    ],
  },
  kiln: {
    icon: 'kiln', label: 'Kiln', corePartIds: ['kiln-body'], parts: (detail) => [
      part('kiln-body', 'cylinder', 'roof', [-.86, .35, -.93], [.66, .7, .66]),
      part('kiln-opening', 'box', 'soil', [-.86, .2, -.59], [.25, .34, .05]),
      ...(detail === 'far' ? [] : [part('kiln-flue', 'cylinder', 'stone', [-.86, .8, -.93], [.22, .3, .22])]),
      ...(detail === 'close' ? [part('kiln-stack', 'box', 'roof', [-1.28, .1, -.67], [.24, .2, .35])] : []),
    ],
  },
  academy: {
    icon: 'academy', label: 'House of learning', corePartIds: ['academy-roof'], parts: (detail) => [
      part('academy-roof', 'gable', 'plaster', [-.86, .55, 1.3], [.86, .3, .55]),
      ...(detail === 'far' ? [] : [part('academy-wall', 'box', 'stone', [-.86, .2, 1.3], [.74, .4, .46]), part('academy-door', 'box', 'timber', [-.86, .16, 1.54], [.18, .32, .03])]),
      ...(detail === 'close' ? [part('academy-tablet-left', 'box', 'grain', [-1.03, .47, 1.55], [.16, .17, .03]), part('academy-tablet-right', 'box', 'grain', [-.85, .47, 1.55], [.16, .17, .03])] : []),
    ],
  },
  monument: {
    icon: 'monument', label: 'Civic gathering place', corePartIds: ['monument-platform'], parts: (detail) => [
      part('monument-platform', 'cylinder', 'stone', [.75, .075, 1.25], [.6, .15, .6]),
      ...(detail === 'far' ? [] : [part('monument-post', 'box', 'identity', [.75, .31, 1.25], [.1, .47, .1])]),
      ...(detail === 'close' ? [part('monument-bench-left', 'box', 'timber', [.53, .21, 1.25], [.09, .12, .3]), part('monument-bench-right', 'box', 'timber', [.97, .21, 1.25], [.09, .12, .3]), part('monument-cap', 'box', 'grain', [.75, .56, 1.25], [.15, .07, .15])] : []),
    ],
  },
  'fuel-yard': {
    icon: 'fuel-yard', label: 'Fuel yard', corePartIds: ['fuel-yard-stack'], parts: (detail) => [
      part('fuel-yard-stack', 'box', 'timber', [-1.25, .18, -.28], [.45, .36, .43]),
      ...(detail === 'far' ? [] : [part('fuel-yard-roof', 'gable', 'metal', [-1.25, .51, -.28], [.53, .18, .49])]),
      ...(detail === 'close' ? [part('fuel-yard-bundle', 'box', 'soil', [-1.25, .07, -.57], [.32, .14, .12]), part('fuel-yard-band', 'box', 'grain', [-1.25, .19, -.06], [.06, .35, .03])] : []),
    ],
  },
};

export function buildingIdentity(id: string): { icon: VisualIcon; label: string } | null {
  const appearance = Object.hasOwn(APPEARANCES, id) ? APPEARANCES[id] : undefined;
  return appearance ? { icon: appearance.icon, label: appearance.label } : null;
}

export function buildingAppearance(id: string, detail: DetailLevel): BuildingAppearance | null {
  const appearance = Object.hasOwn(APPEARANCES, id) ? APPEARANCES[id] : undefined;
  return appearance ? { id, icon: appearance.icon, label: appearance.label, corePartIds: [...appearance.corePartIds], parts: appearance.parts(detail) } : null;
}

export function buildingAppearances(ids: readonly string[], detail: DetailLevel): BuildingAppearance[] {
  const built = new Set(ids);
  return Object.keys(APPEARANCES).flatMap((id) => {
    const appearance = built.has(id) ? buildingAppearance(id, detail) : null;
    return appearance ? [appearance] : [];
  });
}

export function allocateBuildingParts(appearances: readonly BuildingAppearance[], budget: number): VisualPart[] {
  const selected = new Set(appearances.flatMap((appearance) => appearance.corePartIds));
  if (selected.size > budget) throw new RangeError('Settlement building cores exceed part budget');
  const optional = appearances.map((appearance) => appearance.parts.filter((entry) => !selected.has(entry.id)));
  const rounds = Math.max(0, ...optional.map((parts) => parts.length));
  for (let index = 0; index < rounds && selected.size < budget; index += 1) {
    for (const parts of optional) {
      const entry = parts[index];
      if (entry && selected.size < budget) selected.add(entry.id);
    }
  }
  return appearances.flatMap((appearance) => appearance.parts.filter((entry) => selected.has(entry.id)));
}
