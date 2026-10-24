import { RESOURCE_IDS, SPACEFLIGHT_RULES } from '../core/content.ts';
import { CIV_COUNT } from '../core/types.ts';
import type { MarsArrivalReceipt, MarsColony, MarsHabitatReceipt, MarsMission, MarsUpkeepReceipt, Resources, WorldState } from '../core/types.ts';
import type { VisualPart } from './world-visuals.ts';

export type MarsBodyStatus = 'empty' | 'in-transit' | 'building' | 'habitable' | 'shortage' | 'uninhabited';
export interface MarsCivilizationObservation {
  id: number;
  name: string;
  color: string;
  status: MarsBodyStatus;
  population: number;
  progress: number;
  paidProgress: number | null;
  habitable: boolean;
  supplyStreak: number;
  colony: MarsColony | null;
  reserves: Resources | null;
  mission: MarsMission | null;
  missionsLaunched: number;
  lastArrival: MarsArrivalReceipt | null;
  lastUpkeep: MarsUpkeepReceipt | null;
  lastHabitatWork: MarsHabitatReceipt | null;
}
export interface MarsBodyObservation {
  seed: number;
  round: number;
  released: boolean;
  terminal: boolean;
  outcome: WorldState['outcome'];
  habitatRequiredWork: number;
  flightRounds: number;
  contextLabel: string;
  civilizations: MarsCivilizationObservation[];
}
export interface MarsScenePart {
  part: VisualPart;
  color: string;
  kind: 'context' | 'habitat' | 'reserve' | 'resident' | 'transit';
  civilizationId: number | null;
  layer: 'ground' | 'landmark' | 'recorded';
}
export interface MarsBodySite {
  civilizationId: number;
  selectionId: string;
  position: readonly [number, number, number];
  labelPosition: readonly [number, number, number];
  label: string;
  status: MarsBodyStatus;
}
export interface MarsBodyTransit extends MarsBodySite { missionId: string; fraction: number }
export interface MarsBodyScene { parts: MarsScenePart[]; sites: MarsBodySite[]; transits: MarsBodyTransit[] }

export function marsSelectionId(civilizationId: number): string { return `mars:${civilizationId}`; }

export function projectMarsBody(state: WorldState): MarsBodyObservation {
  return {
    seed: state.seed, round: state.round, released: state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId),
    terminal: state.outcome !== null, outcome: structuredClone(state.outcome), habitatRequiredWork: SPACEFLIGHT_RULES.habitat.requiredWork,
    flightRounds: SPACEFLIGHT_RULES.flightRounds,
    contextLabel: 'Illustrative terrain and layout — not simulated geography, territory or resources.',
    civilizations: state.civilizations.toSorted((left, right) => left.id - right.id).map(civ => {
      const ledger = state.spaceflight?.ruleVersion === SPACEFLIGHT_RULES.ruleVersion ? state.spaceflight.civilizations[civ.id] : undefined;
      const colony = ledger?.colony ?? null;
      const mission = ledger?.activeMission ?? null;
      const paidProgress = ledger?.lastHabitatWork ? civ.marsProgress : civ.marsProgress === 0 ? 0 : null;
      const habitable = colony !== null && Boolean(ledger?.lastArrival) && (ledger?.lastHabitatWork?.progressAfter ?? 0) >= SPACEFLIGHT_RULES.habitat.requiredWork
        && civ.marsProgress >= SPACEFLIGHT_RULES.habitat.requiredWork;
      const status: MarsBodyStatus = !colony ? mission ? 'in-transit' : 'empty'
        : civ.marsPopulation <= 0 ? 'uninhabited' : ledger?.lastUpkeep?.status === 'shortage' ? 'shortage' : habitable ? 'habitable' : 'building';
      return { id: civ.id, name: civ.name, color: civ.color, status, population: civ.marsPopulation, progress: civ.marsProgress,
        paidProgress, habitable, supplyStreak: civ.marsSupplyStreak, colony: structuredClone(colony), reserves: colony ? { ...colony.stock } : null,
        mission: structuredClone(mission), missionsLaunched: ledger?.missionsLaunched ?? 0,
        lastArrival: structuredClone(ledger?.lastArrival ?? null), lastUpkeep: structuredClone(ledger?.lastUpkeep ?? null),
        lastHabitatWork: structuredClone(ledger?.lastHabitatWork ?? null) };
    }),
  };
}

export function marsStatusLabel(civ: MarsCivilizationObservation): string {
  if (civ.status === 'empty') return 'No colony';
  if (civ.status === 'in-transit') return 'In transit · no colony';
  if (civ.status === 'uninhabited') return 'Uninhabited · 0 people';
  if (civ.status === 'shortage') return `Supply shortage · ${civ.population} people`;
  if (civ.paidProgress === null) return `Habitat record unavailable · ${civ.population} people`;
  if (civ.paidProgress === 0) return `Landed · habitat not started · ${civ.population} people`;
  return `${civ.status === 'habitable' ? 'Habitable' : 'Habitat building'} · ${civ.population} people`;
}

function noise(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 13, 0xc2b2ae35);
  return ((value ^ value >>> 16) >>> 0) / 0x100000000;
}

export function marsBodyScene(observation: MarsBodyObservation): MarsBodyScene {
  const parts: MarsScenePart[] = []; const sites: MarsBodySite[] = []; const transits: MarsBodyTransit[] = [];
  const add = (id: string, shape: VisualPart['shape'], color: string, position: VisualPart['position'], scale: VisualPart['scale'],
    kind: MarsScenePart['kind'] = 'context', civilizationId: number | null = null, rotation = 0,
    layer: MarsScenePart['layer'] = kind === 'context' ? 'landmark' : 'recorded'): void => {
    parts.push({ part: { id, shape, material: 'stone', position, scale, rotation }, color, kind, civilizationId, layer });
  };
  const dust = ['#b76d50', '#b36749', '#be7452', '#aa5d43', '#c17a58'];
  for (let index = 0; index < 11; index += 1) {
    const angle = index * Math.PI * 2 / 10;
    const x = index === 10 ? 0 : Math.cos(angle) * 9;
    const z = index === 10 ? 1.5 : 1.5 + Math.sin(angle) * 6.1;
    const depth = .9 + noise(observation.seed, index + 400) * .7;
    add(`mars-dust-facet-${index}`, 'canopy', dust[index % dust.length]!, [x, -depth / 2 - .03, z],
      [14 + noise(observation.seed, index + 420) * 3, depth, 11.5], 'context', null, angle * .37, 'ground');
  }
  for (let index = 0; index < 26; index += 1) {
    const angle = index * Math.PI * 2 / 26;
    const radius = .79 + noise(observation.seed, index) * .16;
    const x = Math.cos(angle) * 17 * radius; const z = 1.5 + Math.sin(angle) * 12.7 * radius;
    const size = .5 + noise(observation.seed, index + 100) * 1.4;
    add(`mars-rock-${index}`, 'canopy', index % 3 ? '#9b553e' : '#cf8055', [x, size * .12, z], [size * 1.8, size * .55, size], 'context', null, angle);
  }
  add('mars-crater-floor', 'cylinder', '#854d3d', [-4.6, .005, 1.3], [6.2, .025, 4.1]);
  add('mars-crater-dust', 'canopy', '#aa654b', [-4.1, .03, 1.7], [4.6, .08, 2.6]);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI * 2 / 12;
    add(`mars-crater-rim-${index}`, 'canopy', index < 6 ? '#ce825a' : '#a86046',
      [-4.6 + Math.cos(angle) * 3.4, .12, 1.3 + Math.sin(angle) * 2.3], [2, .65, 1.1], 'context', null, -angle);
  }
  for (let index = 0; index < 6; index += 1) add(`mars-ridge-${index}`, 'canopy', index % 2 ? '#b76e4b' : '#c78056',
    [-9 + index * 1.4, .16, 9.4 + Math.sin(index * .6)], [3.6, .9, 1.7], 'context', null, -.4);
  for (const civ of observation.civilizations) {
    if (civ.colony) {
      const angle = civ.id * Math.PI * 2 / CIV_COUNT - .18 + (noise(observation.seed, civ.id + 300) - .5) * .18;
      const x = Math.cos(angle) * 8; const z = 1.2 + Math.sin(angle) * 6.3;
      const id = marsSelectionId(civ.id);
      const size = 1.7;
      const put = (suffix: string, shape: VisualPart['shape'], color: string, dx: number, y: number, dz: number, scale: VisualPart['scale'], kind: MarsScenePart['kind'] = 'habitat'): void =>
        add(`${id}-${suffix}`, shape, color, [x + dx * size, y * size, z + dz * size], [scale[0] * size, scale[1] * size, scale[2] * size], kind, civ.id);
      sites.push({ civilizationId: civ.id, selectionId: id, position: [x, 1.1 * size, z], labelPosition: [x, 2.1 * size, z - .5 * size],
        status: civ.status, label: `${civ.name} · ${marsStatusLabel(civ)}` });
      const progress = Math.max(0, Math.min(1, (civ.paidProgress ?? 0) / observation.habitatRequiredWork));
      const inhabited = civ.population > 0;
      const trim = civ.status === 'shortage' ? '#efbb58' : inhabited ? civ.color : '#8e9290';
      if (progress > 0) {
        put('foundation', 'cylinder', '#666565', 0, .08, 0, [3.8, .16, 3]);
        put('shell', 'box', inhabited ? '#e9dec4' : '#b4ada0', 0, .2 + progress * .5, 0, [2.7, .25 + progress, 1.8]);
        put('identity-band', 'box', trim, 0, .28 + progress, .92, [2.7, .15, .08]);
        if (civ.habitable) {
          put('roof', 'canopy', '#eee2c8', 0, 1.5, 0, [3.3, 1.2, 2.45]);
          put('airlock', 'box', '#d5d0bd', 1.55, .45, .1, [.6, .8, .8]);
          put('sealed-door', 'box', '#425b61', 1.87, .45, .1, [.06, .58, .46]);
          put('window', 'box', inhabited && civ.status !== 'shortage' ? '#9cc6c5' : '#405359', 0, .84, .92, [1.65, .35, .06]);
        } else {
          for (const side of [-1, 1]) {
            put(`frame-${side}`, 'box', '#656660', side * 1.5, .8, 0, [.11, 1.5, 2.1]);
            put(`top-frame-${side}`, 'box', trim, 0, 1.54, side * .99, [3.1, .09, .09]);
          }
        }
      }
      if (civ.reserves) for (const resource of RESOURCE_IDS) {
        const quantity = civ.reserves[resource];
        if (quantity <= 0) continue;
        const index = RESOURCE_IDS.indexOf(resource);
        const count = Math.min(3, Math.ceil(Math.log2(quantity + 1) / 2));
        for (let unit = 0; unit < count; unit += 1) {
          const dx = -1.5 + index * .61; const dz = 1.8 + unit * .48;
          put(`reserve-${resource}-${unit}`, resource === 'energy' ? 'cylinder' : 'box', resource === 'food' ? '#b6b78b' : resource === 'energy' ? '#7ca5ae' : '#c6b7a0',
            dx, resource === 'energy' ? .37 : .22, dz, [.43, resource === 'energy' ? .72 : .4, .4], 'reserve');
        }
      }
      for (let person = 0; person < Math.min(8, Math.max(0, Math.floor(civ.population))); person += 1) {
        const dx = 2.05 + person % 2 * .48; const dz = .9 + Math.floor(person / 2) * .55;
        put(`resident-${person}-suit`, 'cylinder', '#eee6ce', dx, .3, dz, [.24, .58, .24], 'resident');
        put(`resident-${person}-visor`, 'box', '#304b55', dx, .56, dz + .07, [.2, .16, .15], 'resident');
      }
    }
    if (civ.mission) {
      const mission = civ.mission;
      const fraction = Math.max(0, Math.min(.94, (observation.round - mission.departureRound) / Math.max(1, mission.arrivalRound - mission.departureRound)));
      const lane = -12 + (civ.id % CIV_COUNT) * 6;
      const x = lane - 2 + fraction * 4; const z = -13.3;
      const id = `${marsSelectionId(civ.id)}-transit`;
      for (let dash = 0; dash < 5; dash += 1) add(`${id}-track-${dash}`, 'box', '#9c8782', [lane - 2 + dash, .05, z], [.35, .04, .04], 'transit', civ.id);
      add(`${id}-hull`, 'cylinder', '#e9e0cc', [x, .45, z], [.55, .75, .55], 'transit', civ.id);
      add(`${id}-nose`, 'cone', civ.color, [x, 1, z], [.59, .45, .59], 'transit', civ.id);
      add(`${id}-cargo`, 'box', '#8b9da0', [x, .3, z], [1.2, .22, .33], 'transit', civ.id);
      transits.push({ civilizationId: civ.id, selectionId: marsSelectionId(civ.id), missionId: mission.id, fraction,
        position: [lane, 1.3, z], labelPosition: [lane, 0, z + .8], status: 'in-transit',
        label: `${civ.name} · ${observation.terminal ? `In flight at world end; scheduled arrival round ${mission.arrivalRound}` : 'In transit'} · not landed` });
    }
  }
  return { parts, sites, transits };
}
