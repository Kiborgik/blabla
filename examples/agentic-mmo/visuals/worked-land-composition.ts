import type { VisualPart } from './world-visuals.ts';

export function workedLandCompositionV1(site: { cityId: string; tileId: number; improvementId: string }, parts: readonly VisualPart[]): VisualPart[] {
  const key = JSON.stringify(['worked-land-composition-v1', site.cityId, site.tileId, site.improvementId]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  const reflection = (hash & 1) === 0 ? 1 : -1;
  return parts.map(part => ({ ...part, position: [part.position[0] * reflection, part.position[1], part.position[2]], rotation: part.rotation * reflection }));
}
