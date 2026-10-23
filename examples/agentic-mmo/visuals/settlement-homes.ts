import { civilizationIdentity } from './visual-language.ts';
import type { SettlementDevelopment } from './settlement-development.ts';
import type { TownLot } from './town-plan.ts';
import type { SettlementFacts, VisualPart } from './world-visuals.ts';

interface HomeAppearance {
  wallShape: VisualPart['shape'];
  wall: VisualPart['material'];
  roofShape: VisualPart['shape'];
  roof: VisualPart['material'];
  roofHeight: number;
}

const EARNED_HOMES: Record<ReturnType<typeof civilizationIdentity>['name'], Record<'industrial' | 'launch', HomeAppearance>> = {
  Aster: {
    industrial: { wallShape: 'box', wall: 'plaster', roofShape: 'gable', roof: 'identity', roofHeight: .11 },
    launch: { wallShape: 'box', wall: 'plaster', roofShape: 'box', roof: 'identity', roofHeight: .075 },
  },
  Verdant: {
    industrial: { wallShape: 'box', wall: 'stone', roofShape: 'gable', roof: 'canopy', roofHeight: .13 },
    launch: { wallShape: 'box', wall: 'rockLight', roofShape: 'gable', roof: 'canopy', roofHeight: .10 },
  },
  Ember: {
    industrial: { wallShape: 'box', wall: 'roof', roofShape: 'box', roof: 'metal', roofHeight: .075 },
    launch: { wallShape: 'box', wall: 'stone', roofShape: 'box', roof: 'roof', roofHeight: .075 },
  },
  Pelagos: {
    industrial: { wallShape: 'box', wall: 'plaster', roofShape: 'box', roof: 'identity', roofHeight: .075 },
    launch: { wallShape: 'box', wall: 'rockLight', roofShape: 'box', roof: 'identity', roofHeight: .075 },
  },
  Vesper: {
    industrial: { wallShape: 'cylinder', wall: 'rockLight', roofShape: 'cone', roof: 'identity', roofHeight: .13 },
    launch: { wallShape: 'cylinder', wall: 'rockLight', roofShape: 'cone', roof: 'identity', roofHeight: .10 },
  },
};

type HomeFacts = Pick<SettlementFacts, 'id' | 'worldSeed' | 'civId' | 'population'>;

function homeHeightVariation(city: HomeFacts, lotId: string): number {
  const key = JSON.stringify(['earned-home-skyline-v1', city.worldSeed ?? 0, city.id, lotId]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 4294967296 * .03 - .015;
}

export function settlementHomeParts(city: HomeFacts, stage: SettlementDevelopment['stage'], lots: readonly TownLot[]): VisualPart[] {
  const identity = civilizationIdentity(city.civId);
  const primitive = stage === 'primitive';
  const earned = stage === 'industrial' || stage === 'launch' ? EARNED_HOMES[identity.name][stage] : null;
  const tier = city.population >= 28 ? 3 : city.population >= 14 ? 2 : city.population >= 7 ? 1 : 0;
  return lots.flatMap(({ id, x, z }, index): VisualPart[] => {
    const height = earned
      ? (index === 0 ? stage === 'launch' ? .70 + tier * .07 : .54 + tier * .05
        : index === 1 ? stage === 'launch' ? .49 + tier * .045 : .44 + tier * .04 : .34 + tier * .035) + homeHeightVariation(city, id)
      : (primitive ? .16 : .25) + tier * .035 + (index % 2) * .035;
    const width = (earned ? .20 : .18) + tier * .01;
    const roofHeight = earned ? earned.roofHeight : primitive ? .25 : identity.roofHeight;
    const roofWidth = earned ? Math.min(.265, width + .035) : width + .055;
    return [
      { id: `home-${index}-wall`, shape: earned ? earned.wallShape : primitive ? 'cylinder' : 'box', material: earned ? earned.wall : primitive ? 'timber' : identity.wall,
        position: [x, height / 2, z], scale: [width, height, width], rotation: 0 },
      { id: `home-${index}-roof`, shape: earned ? earned.roofShape : primitive ? 'cone' : identity.roofShape,
        material: earned ? earned.roof : primitive ? index % 2 ? 'grain' : identity.roof : identity.roof,
        position: [x, height + roofHeight / 2, z], scale: [roofWidth, roofHeight, roofWidth], rotation: primitive ? 0 : identity.rotation },
    ];
  });
}
