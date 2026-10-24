import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { WorldState } from '../core/types.ts';
import { civicWorksForCity, recordedCivicWorks } from '../visuals/civic-works-visuals.ts';
import { districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { allocateMapHierarchy, type ScreenBox } from '../visuals/map-hierarchy.ts';
import { settlementVisual, settlementDetail, SETTLEMENT_RENDER_SCALE, DETAIL_BUDGETS, type SettlementFacts, type VisualPart } from '../visuals/world-visuals.ts';
import { civicWorksStory, createCivicWorksInspection } from '../web/civic-works-inspection.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { projectWorld } from '../web/live-world.ts';
import { mapHierarchyAnchors } from '../web/map-labels.ts';
import { hexPosition } from '../web/atlas.ts';
import { flatMapPoint, flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';
import { createSettlementMeshes, createDistrictMeshes } from '../web/settlement-three.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';
import { townProductionRows } from '../web/town-production.ts';
import { storyLanguage } from '../web/story-language.ts';
import { civicWorksFixture, civicWorksTown, acceptCivicWorksFixture, advanceCivicWorksFixture } from './fixtures/civic-works.ts';

const crew = (parts: readonly VisualPart[]): VisualPart[] => parts.filter(part => part.id.startsWith('civic-works:'));
const architecture = (parts: readonly VisualPart[]): VisualPart[] => parts.filter(part => !part.id.startsWith('civic-works:') && !part.id.startsWith('operation:'));

function paid(building = 'fuel-yard'): WorldState {
  const state = civicWorksFixture(building);
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  assert.equal(state.civicWorks!.lastResults[0]!.status, 'worked');
  return state;
}

function facts(state: WorldState): SettlementFacts {
  const town = projectWorld(state).cities.find(city => city.cityId === civicWorksTown(state).id)?.settlement;
  assert.ok(town);
  return town;
}

await test('actual paid work projects exactly three ground-level local staff, without simultaneous Kiln smoke', () => {
  const state = paid(); const before = structuredClone(state);
  const city = facts(state);
  assert.equal(settlementDetail(84), 'close');
  for (const detail of ['far', 'mid', 'close'] as const) {
    const view = settlementVisual(city, detail);
    assert.equal(crew(view.parts).filter(part => part.id.endsWith(':head')).length, detail === 'far' ? 0 : 3);
    assert.equal(crew(view.parts).length, detail === 'far' ? 0 : detail === 'mid' ? 6 : 9);
    assert.ok(!view.parts.some(part => part.id === 'operation:kiln:smoke'));
    assert.ok(view.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(view.parts.some(part => part.id.startsWith(`construction:${city.construction!.active!.id}:`)));
    assert.ok(crew(view.parts).every(part => part.position[1] <= .35));
    assert.ok(crew(view.parts).filter(part => part.id.endsWith(':tunic')).every(part => part.material === 'roof'));
  }
  const heads = crew(settlementVisual(city, 'close').parts).filter(part => part.id.endsWith(':head'));
  const projected = heads.map(part => { const point = flatMapPoint(...[part.position[0], part.position[2], part.position[1]] as const); return { x: point.x * 42 * SETTLEMENT_RENDER_SCALE, y: point.z * 42 * SETTLEMENT_RENDER_SCALE }; });
  for (const [index, left] of projected.entries()) for (const right of projected.slice(index + 1)) assert.ok(Math.hypot(left.x - right.x, left.y - right.y) >= 7);
  assert.deepEqual(state, before);
});

await test('missing, fabricated, stale, cross-order, paused and terminal facts never create live crew', () => {
  const city = facts(paid());
  const falsifiers: Array<(value: SettlementFacts) => void> = [
    value => { value.civicWorks!.last = null; },
    value => { value.civicWorks!.last!.paid.materials = .5; },
    value => { value.civicWorks!.last!.extraWork = 0; },
    value => { value.civicWorks!.last!.residents!.allocated = 2; },
    value => { value.civicWorks!.last!.orderId = 'construction-999'; },
    value => { value.civicWorks!.last!.cityId = 'another-town'; },
    value => { value.civicWorks!.last!.targetTileId++; },
    value => { value.round = (value.round ?? 0) + 1; },
    value => { value.civicWorks!.last!.workBefore = .25; },
    value => { value.buildingOperations!.kiln!.enabled = false; },
    value => { value.buildingOperations!.kiln!.lastResult!.status = 'operated'; value.buildingOperations!.kiln!.lastResult!.produced = { materials: 4 }; },
    value => { value.civicWorks!.last!.terminal = 'expired'; value.civicWorks!.active = null; },
    value => { value.construction!.active = null; },
    value => { value.terminal = true; },
  ];
  for (const mutate of falsifiers) {
    const changed = structuredClone(city); mutate(changed);
    assert.deepEqual(crew(settlementVisual(changed, 'close').parts), []);
  }
  const inactive = structuredClone(city); inactive.civicWorks = { active: null, last: null };
  const paused = structuredClone(city); paused.buildingOperations!.kiln!.enabled = false;
  for (const detail of ['far', 'mid', 'close'] as const) {
    assert.deepEqual(architecture(settlementVisual(city, detail).parts), architecture(settlementVisual(inactive, detail).parts));
    assert.deepEqual(architecture(settlementVisual(city, detail).parts), architecture(settlementVisual(paused, detail).parts));
  }
});

await test('actual idle, paused and unfunded beats leave crew absent and ordinary funded production remains inspectable', () => {
  const idle = civicWorksFixture(); advanceCivicWorksFixture(idle);
  const idleCity = civicWorksTown(idle);
  assert.equal(idleCity.buildingOperations!.kiln!.lastResult!.status, 'operated');
  assert.match(townProductionRows(idleCity)[0]!.result, /Made .* Materials/);
  assert.deepEqual(crew(settlementVisual(facts(idle), 'close').parts), []);
  for (const change of [
    (state: WorldState) => { civicWorksTown(state).buildingOperations!.kiln!.enabled = false; },
    (state: WorldState) => { state.civilizations[0]!.resources.energy = 0; },
    (state: WorldState) => { state.civilizations[0]!.resources.credits = 0; },
  ]) {
    const state = civicWorksFixture(); acceptCivicWorksFixture(state); change(state); advanceCivicWorksFixture(state);
    assert.equal(state.civicWorks!.lastResults[0]!.status, 'blocked');
    assert.deepEqual(crew(settlementVisual(facts(state), 'close').parts), []);
    assert.deepEqual(state.civicWorks!.lastResults[0]!.paid, {});
  }
});

for (const building of ['campus', 'library']) await test(`actual ${building} crew stays at its exact remote district, not the town or another site`, () => {
  const state = paid(building); const city = civicWorksTown(state); const world = projectWorld(state);
  const receipt = state.civicWorks!.lastResults[0]!;
  assert.notEqual(receipt.targetTileId, city.tileId);
  assert.deepEqual(crew(settlementVisual(facts(state), 'close').parts), []);
  const target = world.districts!.find(site => site.tileId === receipt.targetTileId)!;
  assert.ok(target);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = districtParts(target, detail);
    assert.equal(crew(parts).filter(part => part.id.endsWith(':head')).length, detail === 'far' ? 0 : 3);
    assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
    if (detail !== 'far') assert.ok(crew(parts).find(part => part.id.endsWith('resident-2:head'))!.position[2] > (building === 'campus' ? .4 : .6));
    const noCrew = structuredClone(target); noCrew.civicWorks = { active: null, last: null };
    assert.deepEqual(architecture(parts), architecture(districtParts(noCrew, detail)));
  }
  const other = { ...target, tileId: target.tileId + 1 };
  assert.deepEqual(crew(districtParts(other, 'close')), []);
});

function overlap(left: ScreenBox, right: ScreenBox): boolean {
  return left.left < right.left + right.width && left.left + left.width > right.left && left.top < right.top + right.height && left.top + left.height > right.top;
}

await test('normal 84-pixel desktop and narrow town overlays protect actual scaffold and crew geometry', () => {
  const state = paid(); const world = projectWorld(state); const town = world.cities.find(city => city.cityId === 'city-0')!;
  const origin = hexPosition(town.q, town.r);
  const floor = world.tiles.find(tile => tile.q === town.q && tile.r === town.r)!.height;
  for (const width of [1280, 390]) {
    const project = (q: number, r: number, height: number): { x: number; y: number } => {
      const point = hexPosition(q, r); const flat = flatMapPoint(point.x - origin.x, point.z - origin.z, height - floor);
      return { x: width / 2 + flat.x * 42, y: 300 + flat.z * 42 };
    };
    const anchors = mapHierarchyAnchors(world, 'city-0', null, project);
    const anchor = anchors.find(item => item.id === 'city-0')!;
    assert.ok(anchor.protectedBounds);
    const view = settlementVisual(town.settlement!, 'close');
    for (const part of view.parts) for (const [x, y, z] of transformedVertices(part)) {
      const point = flatMapPoint(x * SETTLEMENT_RENDER_SCALE, z * SETTLEMENT_RENDER_SCALE, y * SETTLEMENT_RENDER_SCALE);
      const px = width / 2 + point.x * 42; const py = 300 + point.z * 42; const bounds = anchor.protectedBounds;
      assert.ok(px >= bounds.left && px <= bounds.left + bounds.width && py >= bounds.top && py <= bounds.top + bounds.height);
    }
    const allocation = allocateMapHierarchy(anchors, { width, height: 660, tileDiameter: 84, blocked: [{ left: 0, top: 0, width, height: 78 }, { left: 0, top: 565, width, height: 95 }] });
    const item = allocation.items.find(item => item.id === 'city-0')!;
    assert.ok(item.mark); assert.equal(item.placementMode, 'exterior');
    assert.equal(overlap(item.mark, anchor.protectedBounds), false);
    if (item.label) assert.equal(overlap(item.label, anchor.protectedBounds), false);
  }
});

await test('CPU Three instance counts and flat faces consume the same receipt-backed town and district parts', () => {
  for (const building of ['fuel-yard', 'campus', 'library']) {
    const state = paid(building); const world = projectWorld(state); const material = new THREE.MeshBasicMaterial();
    const towns = createSettlementMeshes(world, () => material); const districts = createDistrictMeshes(world, () => material);
    assert.equal(towns.update(84), 'close'); assert.equal(districts.update(84), 'close');
    const count = (group: THREE.Group): number => group.children.reduce((sum, child) => sum + (child instanceof THREE.InstancedMesh ? child.count : 0), 0);
    assert.equal(count(towns.group), world.cities.reduce((sum, city) => sum + settlementVisual(city.settlement!, 'close').parts.length, 0));
    assert.equal(count(districts.group), (world.districts ?? []).reduce((sum, site) => sum + districtParts(site, 'close').length, 0));
    const parts = [...settlementVisual(facts(state), 'close').parts, ...(world.districts ?? []).flatMap(site => districtParts(site, 'close'))];
    assert.equal(new Set(flatSceneFaces(parts, .72).filter(face => face.part.id.startsWith('civic-works:')).map(face => face.part.id)).size, 9);
    towns.dispose(); districts.dispose(); material.dispose();
  }
});

await test('Chronicle distinguishes acceptance, real fee/work, blocked and completed history without fictional output', () => {
  const state = paid();
  const accepted = state.events.find(event => event.type === 'civic-works-accepted')!;
  const worked = state.events.find(event => event.type === 'civic-works-worked')!;
  assert.match(civicWorksStory(accepted)!.summary, /No crew payment or work yet/);
  assert.equal(recordedCivicWorks(worked)?.eventId, worked.id);
  const row = eventLogEntries([worked], { civilizations: state.civilizations })[0]!;
  assert.equal(row.family, 'building'); assert.equal(row.routine, false);
  assert.match(row.summary, /ordinary .* crew work/); assert.match(row.summary, /Paid 1 Material \+ 2 Credits; 3 local staff/);
  assert.ok(row.receiptDetails.some(line => line.includes(worked.civicWorks!.orderId)));
  assert.match(storyLanguage(state, worked, row).title, new RegExp(civicWorksTown(state).name));
  assert.equal(recordedCivicWorks({ ...worked, tileId: (worked.tileId ?? 0) + 1 }), null);
  advanceCivicWorksFixture(state);
  assert.equal(state.civicWorks!.active.length, 0);
  assert.equal(civicWorksTown(state).construction!.active, null);
  assert.equal(state.civicWorks!.lastResults[0]!.terminal, 'order-completed');
  assert.deepEqual(crew(settlementVisual(facts(state), 'close').parts), []);
  assert.ok(civicWorksForCity(state.civicWorks, civicWorksTown(state))?.last);
});

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  value = '';
  focused = false;
  disabled = false;
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  constructor(tag: string) { this.tag = tag; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { for (const child of [...children].reverse()) { child.remove(); child.parent = this; this.children.unshift(child); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  replaceChildren(...children: ElementRecord[]): void { for (const child of [...this.children]) child.remove(); this.append(...children); }
  querySelector(selector: string): ElementRecord | null { return this.all().find(node => node.tag === selector) ?? null; }
  focus(): void { this.focused = true; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function withDocument<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try { return run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
}

await test('read-only production inspection selects exact commission, separates fee from ordinary operation and retains terminal history', () => {
  const state = paid(); const city = civicWorksTown(state); const before = structuredClone(state);
  withDocument(() => {
    const host = document.createElement('section'); assert.ok(host instanceof ElementRecord);
    let inspected = 0;
    renderSettlementInspection(host, [city], city.id, () => undefined, undefined, '', undefined, undefined, undefined, () => { inspected++; }, undefined, undefined, [], state.civicWorks);
    const button = host.all().find(node => node.dataset['productionWork'] === 'kiln')!;
    assert.ok(button); assert.match(button.content(), /Crew added .* work · No Kiln Materials/);
    button.listeners.get('click')?.();
    assert.equal(inspected, 1);
    assert.equal(host.dataset['selectedWork'], `civic-works:${state.civicWorks!.lastResults[0]!.commissionId}`);
    const preview = host.all().find(node => node.className === 'work-preview')!;
    assert.match(preview.content(), /Paid 1 Material \+ 2 Credits; 3 local staff/);
    assert.match(preview.content(), new RegExp(city.construction!.active!.id));
    assert.equal(host.all().find(node => node.className === 'work-picker')!.focused, true);
    assert.doesNotMatch(host.content(), /Commission now|Hire|Move crew/);
  });
  assert.deepEqual(state, before);
  advanceCivicWorksFixture(state);
  withDocument(() => {
    const view = civicWorksForCity(state.civicWorks, city);
    const card = createCivicWorksInspection(view);
    assert.ok(card instanceof ElementRecord);
    assert.match(card.content(), /construction order completed/);
    assert.match(card.content(), new RegExp(view!.last!.orderId));
    assert.match(card.content(), /No ordinary Kiln Energy charge or Materials output/);
  });
});
