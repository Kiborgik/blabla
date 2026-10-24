import { BUILDINGS } from '../core/content.ts';
import type { VisualPart } from './world-visuals.ts';
import { TOWN_FARM_LOTS } from './town-plan.ts';
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
  granary: {
    icon: 'food', label: 'Granary', corePartIds: ['granary-silo'], parts: (detail) => [
      part('granary-silo', 'cylinder', 'plaster', [.38, .3, -1.21], [.38, .6, .38]),
      part('granary-cap', 'cone', 'roof', [.38, .69, -1.21], [.46, .2, .46]),
      ...(detail === 'far' ? [] : [part('granary-bin', 'cylinder', 'timber', [.03, .22, -1.21], [.25, .44, .25])]),
      ...(detail === 'close' ? [part('granary-door', 'box', 'timber', [.38, .17, -1.01], [.13, .26, .04])] : []),
    ],
  },
  launchpad: {
    icon: 'infrastructure', label: 'Launch complex', corePartIds: ['launchpad-gantry', 'launchpad-apron', 'launchpad-service-arm'], parts: (detail) => [
      part('launchpad-apron', 'cylinder', 'stone', [-.94, .075, .87], [1.05, .15, 1.05]),
      part('launchpad-gantry', 'box', 'metal', [-1.22, .79, .54], [.15, 1.58, .2]),
      part('launchpad-service-arm', 'box', 'metal', [-.99, 1.48, .54], [.59, .12, .18]),
      ...(detail === 'far' ? [] : [part('launchpad-pad', 'cylinder', 'water', [-.9, .16, .94], [.58, .025, .58]), part('launchpad-gantry-foot', 'box', 'stone', [-1.22, .16, .54], [.33, .2, .33])]),
      ...(detail === 'close' ? [part('launchpad-service-tank', 'cylinder', 'plaster', [-1.34, .37, 1.23], [.24, .58, .24]), part('launchpad-gantry-crossbar', 'box', 'grain', [-1.22, .85, .66], [.16, .09, .03])] : []),
    ],
  },
  'water-mill': {
    icon: 'irrigation', label: 'Water mill', corePartIds: ['water-mill-wheel', 'water-mill-roof'], parts: (detail) => [
      part('water-mill-wheel', 'cylinder', 'timber', [1.25, .3, .98], [.48, .25, .48]),
      part('water-mill-roof', 'gable', 'roof', [.89, .5, .96], [.58, .3, .48]),
      ...(detail === 'far' ? [] : [part('water-mill-wall', 'box', 'plaster', [.89, .2, .96], [.5, .4, .4]), part('water-mill-race', 'box', 'water', [1.25, .08, .98], [.26, .05, .74])]),
      ...(detail === 'close' ? [part('water-mill-axle', 'box', 'timber', [1.14, .3, .98], [.5, .07, .07])] : []),
    ],
  },
  aqueduct: {
    icon: 'irrigation', label: 'Aqueduct', corePartIds: ['aqueduct-channel'], parts: (detail) => [
      part('aqueduct-channel', 'box', 'stone', [0, .68, -1.25], [1.32, .2, .3]),
      ...(detail === 'far' ? [] : [-.52, 0, .52].map((x, index) => part(`aqueduct-support-${index}`, 'box', 'stone', [x, .29, -1.25], [.14, .58, .3]))),
      ...(detail === 'close' ? [part('aqueduct-water', 'box', 'water', [0, .79, -1.25], [1.2, .02, .14])] : []),
    ],
  },
  farm: {
    icon: 'farm', label: 'Farm', corePartIds: ['farm-soil', 'farm-soil-step', 'farm-row-0'], parts: (detail) => {
      const [main, rear] = TOWN_FARM_LOTS;
      return [
        ...TOWN_FARM_LOTS.map((lot, index) => part(index === 0 ? 'farm-soil' : 'farm-soil-step', 'box', 'soil', [lot.x, .02, lot.z], [lot.width, .04, lot.depth])),
        part('farm-row-0', 'box', 'grain', [main.x, .07, main.z + (detail === 'far' ? 0 : main.depth / 4)], [main.width - .04, .06, detail === 'far' ? main.depth - .04 : main.depth / 2 - .04]),
        ...(detail === 'far' ? [] : [
          part('farm-row-1', 'box', 'crop', [main.x, .07, main.z - main.depth / 4], [main.width - .04, .06, main.depth / 2 - .04]),
          part('farm-row-2', 'box', 'grain', [rear.x, .07, rear.z], [rear.width - .04, .06, rear.depth - .04]),
          ...TOWN_FARM_LOTS.map((lot, index) => part(`farm-edge-${index}`, 'box', 'stone', [lot.x, .04, lot.z - lot.depth / 2 + .01], [lot.width, .08, .02])),
        ]),
      ];
    },
  },
  workshop: {
    icon: 'workshop', label: 'Workshop', corePartIds: ['workshop-roof'], parts: (detail) => [
      part('workshop-wall', 'box', 'timber', [-1.04, .24, .24], [.74, .48, .62]),
      part('workshop-roof', 'gable', 'metal', [-1.04, .58, .24], [.86, .24, .74]),
      part('workshop-chimney', 'box', 'stone', [-1.31, .55, .35], [.2, 1.1, .22]),
      ...(detail === 'far' ? [] : [part('workshop-yard', 'box', 'soil', [-1.04, .025, .84], [.88, .05, .46]), part('workshop-stack-0', 'box', 'timber', [-1.05, .13, .85], [.6, .22, .19])]),
      ...(detail === 'close' ? [part('workshop-stack-1', 'box', 'grain', [-.78, .09, .63], [.18, .16, .18])] : []),
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
      part('academy-roof', 'gable', 'plaster', [-.86, .65, 1.3], [.96, .3, .65]),
      part('academy-wall', 'box', 'stone', [-.86, .25, 1.25], [.74, .5, .46]),
      part('academy-portico-left', 'box', 'plaster', [-1.17, .26, 1.58], [.1, .52, .1]),
      part('academy-portico-right', 'box', 'plaster', [-.55, .26, 1.58], [.1, .52, .1]),
      ...(detail === 'far' ? [] : [part('academy-door', 'box', 'timber', [-.86, .16, 1.54], [.18, .32, .03])]),
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
  'boat-yard': {
    icon: 'boat-yard', label: 'Boat yard', corePartIds: ['boat-yard-slipway', 'boat-yard-roof'], parts: (detail) => [
      part('boat-yard-slipway', 'box', 'timber', [1.22, .08, -.32], [.62, .16, .76]),
      part('boat-yard-roof', 'gable', 'plaster', [1.22, .46, -.47], [.68, .28, .4]),
      part('boat-yard-davit', 'box', 'timber', [1.48, .51, -.02], [.08, .88, .09]),
      part('boat-yard-davit-arm', 'box', 'timber', [1.26, .94, -.02], [.52, .07, .09]),
      ...(detail === 'far' ? [] : [part('boat-yard-post-left', 'box', 'timber', [.99, .22, -.47], [.07, .44, .07]), part('boat-yard-post-right', 'box', 'timber', [1.45, .22, -.47], [.07, .44, .07])]),
      ...(detail === 'close' ? [part('boat-yard-rail-left', 'box', 'grain', [1.02, .18, -.08], [.06, .04, .42]), part('boat-yard-rail-right', 'box', 'grain', [1.42, .18, -.08], [.06, .04, .42])] : []),
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
  return appearance ? { id, icon: appearance.icon, label: appearance.label, corePartIds: detail === 'far' && id !== 'farm' ? appearance.corePartIds.slice(0, 1) : [...appearance.corePartIds], parts: appearance.parts(detail) } : null;
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
  if (selected.size > budget) {
    const cores = appearances.flatMap(appearance => appearance.corePartIds.flatMap(id => appearance.parts.filter(entry => entry.id === id)));
    return cores.slice(0, Math.max(0, budget));
  }
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

export function installedBuildingBadges(ids: readonly string[]): Array<{ icon: VisualIcon; label: string; value: number }> {
  const built = new Set(ids);
  const local = buildingAppearances(ids, 'far').map(({ icon, label }) => ({ icon, label, value: 1 }));
  return [...local, ...BUILDINGS.filter(building => built.has(building.id) && !Object.hasOwn(APPEARANCES, building.id)).map(building => ({
    icon: building.id === 'coal-plant' ? 'energy' as const : building.production.science ? 'science' as const : building.production.culture ? 'culture' as const : building.production.credits ? 'credits' as const : 'infrastructure' as const,
    label: building.name, value: 1,
  }))];
}

export interface BuildingSite { x: number; z: number; width: number; depth: number; height: number }

export function placeBuildingParts(parts: readonly VisualPart[], reference: readonly VisualPart[], site: BuildingSite): VisualPart[] {
  if (!reference.length) return [];
  const bounds = (axis: 0 | 2): [number, number] => [
    Math.min(...reference.map(part => part.position[axis] - (part.scale[axis] * Math.abs(Math.cos(part.rotation)) + part.scale[axis === 0 ? 2 : 0] * Math.abs(Math.sin(part.rotation))) / 2)),
    Math.max(...reference.map(part => part.position[axis] + (part.scale[axis] * Math.abs(Math.cos(part.rotation)) + part.scale[axis === 0 ? 2 : 0] * Math.abs(Math.sin(part.rotation))) / 2)),
  ];
  const [left, right] = bounds(0);
  const [back, front] = bounds(2);
  const horizontal = Math.min(site.width / Math.max(.01, right - left), site.depth / Math.max(.01, front - back));
  return parts.map(part => ({ ...part,
    position: [site.x + (part.position[0] - (left + right) / 2) * horizontal, part.position[1] * site.height, site.z + (part.position[2] - (back + front) / 2) * horizontal],
    scale: [part.scale[0] * horizontal, part.scale[1] * site.height, part.scale[2] * horizontal],
  }));
}
