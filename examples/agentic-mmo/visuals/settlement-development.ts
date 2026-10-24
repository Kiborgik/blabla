import { BUILDINGS } from '../core/content.ts';
import type { BuildingOperationResult, City, Resources } from '../core/types.ts';
import { buildingAppearance, buildingAppearances } from './building-visuals.ts';
import type { BuildingAppearance } from './building-visuals.ts';
import type { SettlementFacts, VisualPart } from './world-visuals.ts';
import type { DetailLevel } from './visual-language.ts';
import { TOWN_FARM_LOTS } from './town-plan.ts';

export interface SettlementDevelopment {
  stage: 'primitive' | 'civic' | 'industrial' | 'launch';
  label: string;
  evidence: string[];
}

export type OperationContext = Pick<City, 'buildingOperations' | 'localPower'> & { round?: number; terminal?: boolean };
export interface SettlementConstruction {
  orderId: string;
  buildingId: string;
  label: string;
  workDone: number;
  workRequired: number;
  paid: Partial<Resources>;
}

const INDUSTRIAL = ['foundry', 'coal-plant', 'factory', 'research-lab'];
const CIVIC = ['granary', 'aqueduct', 'academy', 'monument', 'campus', 'library', 'university', 'observatory', 'commercial-hub', 'market', 'bank', 'theater-square', 'printing-house', 'industrial-zone', 'guild-workshop'];

export function settlementDevelopment(city: Pick<SettlementFacts, 'buildings'>): SettlementDevelopment {
  const built = new Set(city.buildings);
  if (built.has('launchpad')) return { stage: 'launch', label: 'Launch infrastructure', evidence: ['launchpad'] };
  const industrial = INDUSTRIAL.filter(id => built.has(id));
  if (industrial.length) return { stage: 'industrial', label: 'Industrial town', evidence: industrial };
  const civic = CIVIC.filter(id => built.has(id));
  if (civic.length) return { stage: 'civic', label: 'Civic town', evidence: civic };
  return { stage: 'primitive', label: 'Hearth settlement', evidence: [] };
}

export function settlementLandmarks(city: SettlementFacts, detail: DetailLevel, reservedConstruction = false): BuildingAppearance[] {
  const preferred = [
    ['academy', 'aqueduct', 'monument', 'granary'],
    ['farm', 'water-mill', 'irrigation', 'granary'],
    ['workshop', 'kiln', 'fuel-yard', 'aqueduct'],
    ['boat-yard', 'water-mill', 'granary', 'irrigation'],
    ['academy', 'monument', 'aqueduct', 'kiln'],
  ][((city.civId % 5) + 5) % 5] ?? [];
  const priority = ['launchpad', ...preferred, 'boat-yard', 'academy', 'workshop', 'kiln', 'water-mill', 'aqueduct', 'granary', 'farm', 'irrigation', 'monument', 'fuel-yard'];
  const count = detail === 'far' ? 1 : detail === 'mid' ? 2 : 3;
  return buildingAppearances(city.buildings, detail)
    .toSorted((left, right) => priority.indexOf(left.id) - priority.indexOf(right.id))
    .slice(0, Math.max(1, count - Number(reservedConstruction)));
}

export function currentBuildingOperation(context: OperationContext, buildingId: string): BuildingOperationResult | null {
  if (context.terminal || !Number.isInteger(context.round)) return null;
  const operation = context.buildingOperations?.[buildingId];
  const result = operation?.lastResult;
  if (!operation?.enabled || !result || result.status !== 'operated' || result.round !== context.round
    || result.shortages.length || result.strategicShortages?.length || (result.localPower?.shortage ?? 0) > 0) return null;
  const productive = Object.values(result.produced).some(amount => Number.isFinite(amount) && amount > 0)
    || (result.localPower?.generated ?? 0) > 0 || (result.localPower?.consumed ?? 0) > 0;
  return productive ? result : null;
}

export function settlementConstruction(city: SettlementFacts, detail: DetailLevel): { facts: SettlementConstruction | null; parts: VisualPart[] } {
  const order = city.construction?.active;
  if (!order || !('buildingId' in order) || order.cityId !== city.id || city.buildings.includes(order.buildingId)
    || (order.tileId !== undefined && order.tileId !== city.tileId)
    || !Object.values(order.paid).some(amount => Number.isFinite(amount) && amount > 0)) return { facts: null, parts: [] };
  const appearance = buildingAppearance(order.buildingId, 'close');
  const definition = BUILDINGS.find(building => building.id === order.buildingId);
  if (!appearance || !definition) return { facts: null, parts: [] };
  const xs = appearance.parts.flatMap(part => [part.position[0] - part.scale[0] / 2, part.position[0] + part.scale[0] / 2]);
  const zs = appearance.parts.flatMap(part => [part.position[2] - part.scale[2] / 2, part.position[2] + part.scale[2] / 2]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...zs) - Math.min(...zs);
  const progress = order.workRequired > 0 ? Math.max(0, Math.min(.95, order.workDone / order.workRequired)) : 0;
  const height = .25 + progress * .65;
  const parts: VisualPart[] = [];
  const add = (id: string, material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => {
    parts.push({ id: `construction:${order.id}:${id}`, shape: 'box', material, position, scale, rotation: 0 });
  };
  if (order.buildingId === 'farm') {
    TOWN_FARM_LOTS.forEach((lot, index) => add(index === 0 ? 'foundation' : 'foundation-step', 'soil', [lot.x, .02, lot.z], [lot.width, .04, lot.depth]));
    const main = TOWN_FARM_LOTS[0];
    add('stake-left', 'timber', [main.x - main.width / 2 + .03, .13, main.z + main.depth / 2 - .03], [.04, .18, .04]);
    if (detail !== 'far') {
      add('stake-right', 'timber', [main.x + main.width / 2 - .03, .13, main.z - main.depth / 2 + .03], [.04, .18, .04]);
      const stripWidth = (main.width - .06) * (.35 + progress * .5);
      add('unfinished-strip', 'settled', [main.x - main.width / 2 + .03 + stripWidth / 2, .05, main.z], [stripWidth, .02, .1]);
    }
  } else {
    add('foundation', 'soil', [x, .05, z], [width, .1, depth]);
    add('open-frame', 'timber', [x - width * .38, height / 2, z - depth * .35], [.09, height, .09]);
    if (detail !== 'far') {
      add('frame-right', 'timber', [x + width * .38, height / 2, z - depth * .35], [.09, height, .09]);
      add('scaffold-beam', 'timber', [x, height, z - depth * .35], [width * .84, .07, .09]);
    }
    if (detail === 'close') add('paid-supplies', 'stone', [x + width * .17, .15, z + depth * .23], [width * .35, .2, depth * .3]);
  }
  return { facts: { orderId: order.id, buildingId: order.buildingId, label: definition.name, workDone: order.workDone, workRequired: order.workRequired, paid: { ...order.paid } }, parts };
}

export function settlementOperationParts(city: SettlementFacts, detail: DetailLevel): VisualPart[] {
  if (detail === 'far' || !city.buildings.includes('kiln') || !currentBuildingOperation(city, 'kiln')) return [];
  return [{ id: 'operation:kiln:smoke', shape: 'canopy', material: 'rockLight', position: [-.86, 1.15, -.93], scale: [.26, .35, .26], rotation: .3 }];
}
