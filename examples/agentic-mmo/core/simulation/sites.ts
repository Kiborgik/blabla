import { ECONOMY_RULES, RESOURCE_IDS, SETTLEMENT_SITE_OUTPUTS } from '../content.ts';
import type { HexTile, Resources, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';

export function siteProduction(state: WorldState, site: HexTile): Partial<Resources> {
  const terrain = hasFeatures(state, ['terrain-production']) ? SETTLEMENT_SITE_OUTPUTS[site.terrain] : undefined;
  const result: Partial<Resources> = {};
  for (const resource of RESOURCE_IDS) {
    const amount = (terrain?.[resource] ?? 0) + (site.resource === resource ? 1 : 0);
    if (amount > 0) result[resource] = amount;
  }
  return result;
}

export function describeSettlementSite(state: WorldState, site: HexTile): string {
  const outputs = siteProduction(state, site);
  const terrain = hasFeatures(state, ['terrain-production']) ? SETTLEMENT_SITE_OUTPUTS[site.terrain] : undefined;
  const bonuses = RESOURCE_IDS.filter((resource) => (terrain?.[resource] ?? 0) > 0)
    .map((resource) => `${resource} +${terrain?.[resource]}`).join(', ') || 'no additional yield';
  const deposit = site.resource ? `${site.resource}: ${site.resource} +1` : 'none';
  const base = RESOURCE_IDS.map((resource) => `${resource} ${(ECONOMY_RULES.baseProduction[resource] ?? 0) + (outputs[resource] ?? 0)}`).join(', ');
  return `Terrain ${site.terrain}: ${bonuses}; Deposit ${deposit}; Base yields before focus and productivity: ${base}`;
}
