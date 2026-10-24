import type { VisualPart } from './world-visuals.ts';

export interface WoodlandVisualFacts {
  stock: number;
  capacity: number;
  lastHarvestRound: number | null;
  recovered: number;
  current: boolean;
}

export function woodlandStandParts(parts: readonly VisualPart[], facts: WoodlandVisualFacts | null | undefined, height: number): VisualPart[] {
  if (!facts || facts.lastHarvestRound === null || !Number.isSafeInteger(facts.lastHarvestRound) || facts.lastHarvestRound < 0
    || !Number.isSafeInteger(facts.capacity) || facts.capacity <= 0 || !Number.isSafeInteger(facts.stock) || facts.stock < 0 || facts.stock >= facts.capacity) return [...parts];
  const canopies = parts.filter(part => part.shape === 'canopy' || part.shape === 'broadleaf');
  const fraction = facts.stock / facts.capacity;
  const matureCount = 1 + Math.floor(fraction * (canopies.length - 1));
  const recovering = facts.current && Number.isSafeInteger(facts.recovered) && facts.recovered > 0 && facts.recovered <= facts.stock;
  return canopies.flatMap((canopy, index): VisualPart[] => {
    const split = canopy.id.lastIndexOf(':');
    const prefix = canopy.id.slice(0, split); const suffix = canopy.id.slice(split + 1);
    const trunk = parts.find(part => part.id === `${prefix}:trunk:${suffix}`);
    if (index < matureCount) {
      const vertical = .55 + fraction * .45; const width = .65 + fraction * .35;
      const base = Math.max(0, canopy.position[1] - height - canopy.scale[1] / 2);
      if (base < .01) return [canopy, ...(trunk ? [trunk] : [])].map(part => ({ ...part,
        position: [part.position[0], height + (part.position[1] - height) * vertical, part.position[2]],
        scale: [part.scale[0] * width, part.scale[1] * vertical, part.scale[2] * width],
      }));
      const mature: VisualPart = { ...canopy,
        position: [canopy.position[0], height + base + canopy.scale[1] * vertical / 2, canopy.position[2]],
        scale: [canopy.scale[0] * width, canopy.scale[1] * vertical, canopy.scale[2] * width] };
      const trunkHeight = trunk ? Math.max(trunk.scale[1] * vertical, base + .04) : 0;
      return [mature, ...(trunk ? [{ ...trunk, position: [trunk.position[0], height + trunkHeight / 2, trunk.position[2]] as const,
        scale: [trunk.scale[0] * width, trunkHeight, trunk.scale[2] * width] as const }] : [])];
    }
    const root = trunk?.position ?? canopy.position;
    const width = Math.min(.12, Math.max(.065, canopy.scale[0] * .28));
    const stump: VisualPart = { id: `${prefix}:stump:${suffix}`, shape: 'cylinder', material: 'timber',
      position: [root[0], height + .0375, root[2]], scale: [width, .075, width], rotation: canopy.rotation };
    if (!recovering || index !== matureCount) return [stump];
    const saplingHeight = .16 + fraction * .08;
    const saplingWidth = Math.min(.24, canopy.scale[0] * .62);
    return [stump, { id: `${prefix}:sapling:${suffix}`, shape: 'canopy', material: 'canopyLight',
      position: [root[0], height + .045 + saplingHeight / 2, root[2]],
      scale: [saplingWidth, saplingHeight, saplingWidth * .9], rotation: canopy.rotation }];
  });
}
