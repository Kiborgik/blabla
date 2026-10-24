import { RIVER_INTAKE_RULES } from '../core/river-intake-content.ts';
import type { DrainageEdgeView } from './drainage-visuals.ts';
import { hexPosition } from './landscape.ts';
import type { TerrainFace, TerrainPoint, TerrainSurface } from './landscape.ts';
import type { ImprovementView } from './improvement-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface RiverIntakeVisualFacts {
  surface: TerrainSurface;
  edge: DrainageEdgeView;
  round: number;
  terminal: boolean;
  eligible: boolean;
  receiptCurrent: boolean;
}

export const RIVER_INTAKE_MARK_PATH = 'M3 3V14M11 3V14M2 5H12M5 8H9V13H5ZM3 17H10L14 21H22M14 16H22M16 11H22';

type Footprint = { x: number; z: number; width: number; depth: number; rotation: number };
type Contact = { low: number; high: number };
type Plot = Footprint & Contact;

function sample(seed: number, tileId: number, channel: string): number {
  const key = JSON.stringify(['river-intake-visuals-v1', seed, tileId, channel]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 4294967296;
}

function interpolate(a: TerrainPoint, b: TerrainPoint, t: number): TerrainPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function samePoint(a: TerrainPoint, b: TerrainPoint): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) < 1e-10);
}

function footprintContact(surface: TerrainSurface, footprint: Footprint, groundOnly = false): Contact | null {
  const cosine = Math.cos(footprint.rotation); const sine = Math.sin(footprint.rotation);
  const planes = [[cosine, -sine, footprint.width / 2], [-cosine, sine, footprint.width / 2],
    [sine, cosine, footprint.depth / 2], [-sine, -cosine, footprint.depth / 2]] as const;
  let area = 0; let low = Infinity; let high = -Infinity;
  for (const face of surface.faces) {
    if (groundOnly && face.kind !== 'ground') continue;
    for (let index = 1; index + 1 < face.points.length; index++) {
      let polygon: TerrainPoint[] = [face.points[0]!, face.points[index]!, face.points[index + 1]!];
      for (const [nx, nz, limit] of planes) {
        const input = polygon; polygon = [];
        for (const [pointIndex, a] of input.entries()) {
          const b = input[(pointIndex + 1) % input.length]!;
          const da = (a[0] - footprint.x) * nx + (a[2] - footprint.z) * nz - limit;
          const db = (b[0] - footprint.x) * nx + (b[2] - footprint.z) * nz - limit;
          if (da <= 0) polygon.push(a);
          if ((da <= 0) !== (db <= 0)) polygon.push(interpolate(a, b, da / (da - db)));
        }
      }
      const covered = Math.abs(polygon.reduce((sum, point, pointIndex) => {
        const next = polygon[(pointIndex + 1) % polygon.length]!;
        return sum + (point[0] - footprint.x) * (next[2] - footprint.z) - (next[0] - footprint.x) * (point[2] - footprint.z);
      }, 0)) / 2;
      if (covered < 1e-14) continue;
      area += covered;
      for (const point of polygon) { low = Math.min(low, point[1]); high = Math.max(high, point[1]); }
    }
  }
  return Number.isFinite(low) && Number.isFinite(high) && Math.abs(area - footprint.width * footprint.depth) < 1e-9 ? { low, high } : null;
}

function border(face: TerrainFace, neighbors: readonly TerrainFace[], center: TerrainPoint): TerrainPoint[] {
  return face.points.filter(point => neighbors.some(neighbor => neighbor.points.some(other => samePoint(point, other))))
    .toSorted((a, b) => Math.hypot(a[0] - center[0], a[2] - center[2]) - Math.hypot(b[0] - center[0], b[2] - center[2]));
}

function placement(view: ImprovementView): { tangent: readonly [number, number]; outward: readonly [number, number]; bank: TerrainPoint; water: TerrainPoint; rotation: number; plots: Plot[] } | null {
  const facts = view.riverIntake;
  if (!facts || facts.edge.fromTileId !== view.tileId || facts.surface.key !== `${view.q},${view.r}`
    || facts.edge.id !== `drainage:1:${view.tileId}:${facts.edge.toTileId}`
    || !Number.isSafeInteger(facts.edge.contributingLandTiles) || facts.edge.contributingLandTiles < RIVER_INTAKE_RULES.minimumContributingLand) return null;
  const { surface, edge } = facts; const origin = hexPosition(view.q, view.r);
  if (!samePoint(surface.center, [origin.x, view.height, origin.z]) || !samePoint(edge.points[0], surface.center)
    || !surface.faces.every(face => face.points.every(point => point.every(Number.isFinite)))) return null;
  const channels = surface.faces.filter(face => face.kind === 'channel' && face.drainageEdgeId === edge.id);
  const ground = surface.faces.filter(face => face.kind === 'ground');
  const banks = surface.faces.filter(face => face.kind === 'bank' && face.drainageEdgeId === edge.id).toSorted((a, b) => a.key.localeCompare(b.key));
  if (banks.length !== 2 || channels.length !== 1) return null;
  const seed = view.worldSeed ?? 0;
  if (sample(seed, view.tileId, 'bank') < .5) banks.reverse();
  for (const face of banks) {
    const landBorder = border(face, ground, surface.center); const waterBorder = border(face, channels, surface.center);
    if (landBorder.length !== 2 || waterBorder.length !== 2) continue;
    const distance = Math.hypot(landBorder[1]![0] - landBorder[0]![0], landBorder[1]![2] - landBorder[0]![2]);
    if (distance < .2) continue;
    const tangent = [(landBorder[1]![0] - landBorder[0]![0]) / distance, (landBorder[1]![2] - landBorder[0]![2]) / distance] as const;
    const rotation = -Math.atan2(tangent[1], tangent[0]);
    for (const t of [.52 + sample(seed, view.tileId, 'position') * .06, .68, .38]) {
      const bank = interpolate(landBorder[0]!, landBorder[1]!, t); const water = interpolate(waterBorder[0]!, waterBorder[1]!, t);
      const sign = (bank[0] - water[0]) * -tangent[1] + (bank[2] - water[2]) * tangent[0] >= 0 ? 1 : -1;
      const outward = [-tangent[1] * sign, tangent[0] * sign] as const;
      for (const factor of [1, .8, .6, .45]) {
        const length = (.39 + sample(seed, view.tileId, 'length') * .055) * factor;
        const plots: Plot[] = [];
        for (const row of [0, 1]) for (const segment of [0, 1]) {
          const along = (segment - .5) * length / 2;
          const across = (.13 + row * .14) * factor;
          const footprint: Footprint = { x: bank[0] + tangent[0] * along + outward[0] * across,
            z: bank[2] + tangent[1] * along + outward[1] * across, width: length / 2 - .008, depth: .075 * factor, rotation };
          const contact = footprintContact(surface, footprint, true);
          if (contact) plots.push({ ...footprint, ...contact });
        }
        if (plots.length === 4) return { tangent, outward, bank, water, rotation, plots };
      }
    }
  }
  return null;
}

export function riverIntakeWorking(view: ImprovementView): boolean {
  const facts = view.riverIntake; const result = view.operation?.lastResult; const river = result?.river;
  const food = result?.produced.food ?? 0; const completion = view.completion;
  return view.improvementId === RIVER_INTAKE_RULES.improvementId && view.status === 'built' && view.operation?.enabled === true
    && facts?.eligible === true && facts.receiptCurrent === true && facts.terminal === false
    && Number.isSafeInteger(facts.round) && completion?.tileId === view.tileId && completion.cityId === view.cityId
    && completion.improvementId === view.improvementId && completion.completedRound < facts.round
    && result?.round === facts.round && result.status === 'operated' && result.blockedReason === null
    && Number.isFinite(food) && food > 0 && result.paid.materials === RIVER_INTAKE_RULES.materialsPerOperation
    && result.residents.allocated === RIVER_INTAKE_RULES.residentsPerOperation
    && river?.ruleVersion === RIVER_INTAKE_RULES.ruleVersion && river.ruleId === RIVER_INTAKE_RULES.ruleId
    && river.tileId === view.tileId && river.downstreamTileId === facts.edge.toTileId && river.outletTileId === facts.edge.outletTileId
    && river.supportBuildingId === RIVER_INTAKE_RULES.supportBuildingId && river.supportAllocationRound === facts.round
    && river.required === RIVER_INTAKE_RULES.flowPerOperation && river.withdrawn === RIVER_INTAKE_RULES.flowPerOperation
    && Number.isSafeInteger(river.availableBefore) && river.availableBefore >= river.required
    && river.remainingAfter === river.availableBefore - river.withdrawn;
}

export function riverIntakeParts(view: ImprovementView, detail: DetailLevel): VisualPart[] {
  const site = placement(view);
  if (view.improvementId !== RIVER_INTAKE_RULES.improvementId || !site || !view.riverIntake) return [];
  const surface = view.riverIntake.surface; const origin = hexPosition(view.q, view.r);
  const { bank, water, tangent, outward, rotation, plots } = site;
  const parts: VisualPart[] = [];
  const add = (id: string, material: VisualPart['material'], footprint: Footprint, bottom: number, top: number): void => {
    parts.push({ id: `${view.id}:intake-${id}`, shape: 'box', material,
      position: [footprint.x - origin.x, (bottom + top) / 2 - view.height, footprint.z - origin.z],
      scale: [footprint.width, top - bottom, footprint.depth], rotation: footprint.rotation });
  };
  const atBank = (along: number, across: number, width: number, depth: number): Footprint => ({
    x: bank[0] + tangent[0] * along + outward[0] * across, z: bank[2] + tangent[1] * along + outward[1] * across, width, depth, rotation });
  const posts = [-1, 1].map(side => atBank(side * .085, .018, .035, .035));
  const postContacts = posts.map(post => footprintContact(surface, post));
  if (postContacts.some(contact => contact === null)) return [];
  const frameTop = Math.max(...postContacts.map(contact => contact!.high)) + .19;
  for (const [index, post] of posts.entries()) add(view.status === 'building' ? `frame-stake-${index}` : `gate-post-${index}`, 'timber', post, postContacts[index]!.low - .008, frameTop);
  add('frame-beam', 'timber', atBank(0, .018, .21, .04), frameTop - .015, frameTop + .02);
  if (view.status === 'building') {
    for (const [index, plot] of plots.entries()) {
      const footprint = { ...plot, width: .027, depth: .027 };
      const contact = footprintContact(surface, footprint, true);
      if (contact) add(`plot-stake-${index}`, 'timber', footprint, contact.low - .005, contact.high + .09);
    }
    return parts;
  }
  const gate = atBank(0, .005, .135, .032); const gateContact = footprintContact(surface, gate);
  const reach = Math.hypot(bank[0] - water[0], bank[2] - water[2]);
  const tray = atBank(0, (.045 - reach) / 2, .13, reach + .065); const trayContact = footprintContact(surface, tray);
  if (!gateContact || !trayContact) return [];
  add('sluice-gate', 'timber', gate, gateContact.low - .008, frameTop - .025);
  add('bank-tray', 'timber', tray, trayContact.low - .008, trayContact.high + .012);
  const working = riverIntakeWorking(view);
  for (const [index, plot] of plots.entries()) add(`furrow-${index}`, working ? 'crop' : 'soil', plot, plot.low - .006, plot.high + .014);
  if (working) add('recorded-water', 'water', { ...tray, width: .082, depth: tray.depth * .88 }, trayContact.high + .012, trayContact.high + .018);
  if (detail !== 'far') {
    for (const [index, plot] of plots.entries()) add(`furrow-groove-${index}`, 'soil', { ...plot, width: plot.width * .9, depth: .012 }, plot.high + .014, plot.high + .019);
  }
  if (detail === 'close') {
    for (const side of [-1, 1]) add(`tray-rim-${side}`, 'timber', { ...tray, x: tray.x + tangent[0] * side * .0575,
      z: tray.z + tangent[1] * side * .0575, width: .015 }, trayContact.high + .012, trayContact.high + .043);
    add('gate-handle', 'timber', atBank(0, .005, .025, .025), frameTop - .025, frameTop + .07);
    add('gate-grip', 'timber', atBank(0, .005, .09, .025), frameTop + .05, frameTop + .075);
  }
  return parts;
}
