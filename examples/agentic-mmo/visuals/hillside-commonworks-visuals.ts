import type { ImprovementView } from './improvement-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export const HILLSIDE_COMMONWORKS_MARK_PATH = 'M3 21Q12 16 21 21M4 16Q10 12 16 15M6 11Q10 8 14 10M15 6L19 3L23 6M16 6V10M22 6V10';

function siteSample(seed: number, tileId: number, row: number, channel: string): number {
  const key = JSON.stringify(['hillside-commonworks-v1', seed, tileId, row, channel]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function hillsideCommonworksParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id: `${view.id}:commons-${id}`, shape, material, position, scale, rotation });
  };
  const strips = [0, 1, 2].map(row => {
    const sample = (channel: string): number => siteSample(view.worldSeed ?? 0, view.tileId, row, channel);
    return { row, x: (sample('offset') - .5) * .12, z: .34 - row * .3, height: .035 + row * .025,
      width: 1.16 - row * .11 + sample('width') * .08, rotation: (sample('turn') - .5) * .11,
      material: sample('crop') < .4 ? 'grain' as const : 'crop' as const };
  });
  add('identity', 'box', 'identity', [-.73, .06, -.01], [.05, .08, .94]);
  if (view.status === 'building') {
    const strip = strips[0]!;
    for (const side of [-1, 1]) add(`survey-${side}`, 'box', 'timber',
      [strip.x + side * Math.cos(strip.rotation) * strip.width / 2, .11, strip.z - side * Math.sin(strip.rotation) * strip.width / 2], [.04, .22, .04]);
    add('survey-line', 'box', 'timber', [strip.x, .19, strip.z], [strip.width, .02, .02], strip.rotation);
    return parts;
  }
  for (const strip of strips) {
    add(`strip-${strip.row}`, 'box', strip.material, [strip.x, strip.height / 2, strip.z], [strip.width, strip.height, .2], strip.rotation);
    add(`retaining-edge-${strip.row}`, 'box', 'stone',
      [strip.x + Math.sin(strip.rotation) * .13, (strip.height + .015) / 2, strip.z + Math.cos(strip.rotation) * .13],
      [strip.width + .02, strip.height + .015, .045], strip.rotation);
  }
  for (const x of [.31, .59]) add(`shelter-post-${x}`, 'box', 'timber', [x, .14, -.52], [.045, .28, .045]);
  add('shelter-roof', 'gable', 'timber', [.45, .29, -.52], [.38, .12, .29]);
  if (detail !== 'far') {
    for (const strip of strips) add(`soil-margin-${strip.row}`, 'box', 'soil',
      [strip.x - Math.sin(strip.rotation) * .115, strip.height / 2, strip.z - Math.cos(strip.rotation) * .115],
      [strip.width, strip.height, .03], strip.rotation);
    add('tool-rack', 'box', 'timber', [.45, .15, -.54], [.31, .035, .035]);
    add('tool-handle', 'box', 'timber', [.49, .145, -.51], [.02, .19, .02]);
  }
  if (detail === 'close') {
    for (const strip of strips) add(`furrow-${strip.row}`, 'box', 'soil',
      [strip.x, strip.height + .003, strip.z], [strip.width * .87, .006, .018], strip.rotation);
    add('tool-head', 'box', 'metal', [.49, .235, -.51], [.08, .025, .025]);
    const result = view.operation?.lastResult;
    if (view.operation?.enabled === true && result?.status === 'operated' && (result.produced.food ?? 0) > 0) {
      add('recorded-harvest', 'cylinder', 'grain', [.7, .045, -.5], [.1, .09, .1]);
    }
  }
  return parts;
}
