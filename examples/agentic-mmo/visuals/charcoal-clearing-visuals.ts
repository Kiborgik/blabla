import type { ImprovementView } from './improvement-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

function siteSample(seed: number, tileId: number, pile: number, channel: string): number {
  const key = JSON.stringify(['charcoal-clearing-v1', seed, tileId, pile, channel]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function charcoalClearingParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  const sample = (pile: number, channel: string): number => siteSample(view.worldSeed ?? 0, view.tileId, pile, channel);
  const orientation = (sample(0, 'orientation') - .5) * Math.PI / 4;
  const sine = Math.sin(orientation);
  const cosine = Math.cos(orientation);
  const parts: VisualPart[] = [{ id: `${view.id}:charcoal-identity`, shape: 'box', material: 'identity',
    position: [-.64, .065, 0], scale: [.05, .05, .8], rotation: 0 }];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    const [x, y, z] = position;
    parts.push({ id: `${view.id}:charcoal-${id}`, shape, material,
      position: [x * cosine + z * sine, y, z * cosine - x * sine], scale, rotation: rotation + orientation });
  };
  if (view.status === 'building') {
    for (const x of [-.43, .43]) for (const z of [-.36, .36]) {
      add(`survey-${x}-${z}`, 'box', 'timber', [x, .09, z], [.04, .18, .04]);
    }
    return parts;
  }
  add('working-pad', 'cylinder', 'timber', [0, .02, 0], [1.1, .04, 1.02]);
  add('mound-foot', 'cylinder', 'soil', [-.08, .0775, -.1], [.73, .075, .65]);
  add('mound', 'canopy', 'soil', [-.08, .195, -.1], [.74, .31, .66]);
  for (const pile of [0, 1]) {
    const x = (pile === 0 ? .4 : -.18) + (sample(pile, 'x') - .5) * .04;
    const z = (pile === 0 ? .1 : .44) + (sample(pile, 'z') - .5) * .04;
    const rotation = (pile === 0 ? Math.PI / 2 : 0) + (sample(pile, 'turn') - .5) * .24;
    const width = .36 + sample(pile, 'width') * .06;
    const log = (id: string, across: number, height: number, length: number, cutEnd: boolean): void => {
      const logX = x + Math.sin(rotation) * across;
      const logZ = z + Math.cos(rotation) * across;
      add(`wood-${pile}-${id}`, 'box', 'timber', [logX, height, logZ], [length, .065, .075], rotation);
      if (cutEnd) add(`cut-end-${pile}-${id}`, 'box', 'grain',
        [logX + Math.cos(rotation) * (length / 2 + .002), height, logZ - Math.sin(rotation) * (length / 2 + .002)],
        [.012, .055, .06], rotation);
    };
    for (const row of [0, 1]) log(`lower-${row}`, (row - .5) * .085, .0725, width, detail === 'close');
    if (detail !== 'far') log('upper', 0, .1375, width * .86, true);
  }
  const result = view.operation?.lastResult;
  const producedEnergy = result?.produced.energy ?? 0;
  if (detail !== 'far' && view.operation?.enabled === true && result?.status === 'operated' && Number.isFinite(producedEnergy) && producedEnergy > 0) {
    add('recorded-smoke', 'canopy', 'rockLight', [-.06, .41, -.105], [.075, .12, .07]);
    if (detail === 'close') add('recorded-heat', 'cylinder', 'roof', [-.08, .115, .215], [.04, .012, .03]);
  }
  return parts;
}
