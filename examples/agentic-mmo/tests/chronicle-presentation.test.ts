import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import type { GameEvent } from '../core/types.ts';
import { BUILDINGS, IMPROVEMENTS, WONDERS } from '../core/content.ts';
import { wonderWorkRows, townDevelopmentFacts } from '../visuals/wonder-visuals.ts';
import { railWorkRows } from '../web/settlement-inspection.ts';
import { observedRail } from '../core/simulation/rail.ts';
import { spectatorChronicle, spectatorEventDestination } from '../web/spectator-hud.ts';
import { chronicleEventDestination, chronicleSummary, presentChronicleStories, renderChronicle } from '../web/chronicle-presentation.ts';

const event = (round: number, type = 'research-completed'): GameEvent => ({ id: `story-${round}`, round, type, title: `Discovery ${round}`, detail: '', actor: 0, target: 0, tileId: null, cause: 'A long technical reason', effects: [], importance: 4 });

void test('completed work resolves the exact owned site and Work item, not the first town of its civilization', () => {
  const state = createWorld(1701); const city = state.cities[0]; const improvement = IMPROVEMENTS[0]; const building = BUILDINGS[0];
  assert.ok(city && improvement && building);
  const source = { ...event(3, 'improvement-completed'), tileId: 7, detail: `${city.id}/7/${improvement.id}` };
  city.improvements = { '7': { tileId: 7, improvementId: improvement.id, operation: { enabled: true, lastResult: null },
    completion: { kind: 'improvement', orderId: 'paid-order', cityId: city.id, improvementId: improvement.id, tileId: 7,
      startedRound: 1, completedRound: 3, paid: { materials: 4 }, workRequired: 4, eventId: source.id } } };
  const before = structuredClone(state);
  assert.deepEqual(chronicleEventDestination(state, source, spectatorEventDestination(state, source)), {
    kind: 'site', id: `${city.id}/7`, cityId: city.id, tileId: 7, workId: '7', label: `${improvement.name} · ${city.name}`,
  });
  assert.deepEqual(state, before);
  const completed = { ...event(4, 'building-completed'), tileId: city.tileId };
  city.buildings.push(building.id);
  city.construction = { active: null, lastCompleted: { orderId: 'built', cityId: city.id, buildingId: building.id,
    startedRound: 1, completedRound: 4, paid: {}, workRequired: 4, eventId: completed.id } };
  assert.equal(chronicleEventDestination(state, completed, null)?.kind, 'site');
  const destination = chronicleEventDestination(state, completed, null);
  assert.ok(destination?.kind === 'site'); assert.equal(destination.workId, building.id); assert.equal(destination.tileId, city.tileId);
});

void test('wrong event, owner, round, site and work identity do not bind an unrelated receipt', () => {
  const state = createWorld(1701); const city = state.cities[0]; assert.ok(city);
  city.construction = { active: { ruleVersion: 1, kind: 'improvement', id: 'current-order', cityId: city.id, improvementId: 'pasture',
    tileId: 7, startedRound: 2, paid: {}, workRequired: 4, workDone: 0 }, lastCompleted: null };
  const source = { ...event(2, 'construction-started'), detail: 'current-order', tileId: 7 };
  const target = chronicleEventDestination(state, source, null);
  assert.ok(target?.kind === 'site'); assert.equal(target.workId, 'active:current-order');
  for (const invalid of [{ ...source, actor: 9 }, { ...source, target: 9 }, { ...source, round: 3 }, { ...source, tileId: 8 }, { ...source, detail: 'old-order' }])
    assert.equal(chronicleEventDestination(state, invalid, null), null);
});

void test('ordinary building orders use the exact town tile without relaxing district, improvement or event identity checks', () => {
  const state = createWorld(1701); const city = state.cities[0];
  const building = BUILDINGS.find(item => item.id === 'workshop'); const district = BUILDINGS.find(item => item.district);
  assert.ok(city && building && !building.district && district);
  const order = { ruleVersion: 1 as const, id: 'town-order', cityId: city.id, buildingId: building.id,
    startedRound: 2, paid: { materials: 4 }, workRequired: 4, workDone: 0 };
  city.construction = { active: order, lastCompleted: null };
  const source = { ...event(2, 'construction-started'), detail: order.id, tileId: city.tileId };
  const before = structuredClone(state);
  assert.deepEqual(chronicleEventDestination(state, source, null), { kind: 'site', id: `${city.id}/${city.tileId}`,
    cityId: city.id, tileId: city.tileId, workId: `active:${order.id}`, label: `${building.name} · ${city.name}` });
  assert.deepEqual(state, before);
  for (const invalid of [{ ...source, detail: 'other-order' }, { ...source, tileId: city.tileId + 1 }, { ...source, round: 3 }, { ...source, actor: 9 }, { ...source, target: 9 }])
    assert.equal(chronicleEventDestination(state, invalid, null), null);
  city.construction.active = { ...order, tileId: city.tileId + 1 };
  assert.equal(chronicleEventDestination(state, source, null), null);
  city.construction.active = { ...order, cityId: 'other-town' };
  assert.equal(chronicleEventDestination(state, source, null), null);
  city.construction.active = { ...order, buildingId: district.id };
  assert.equal(chronicleEventDestination(state, source, null), null);
  city.construction.active = { ruleVersion: 1, kind: 'improvement', id: order.id, cityId: city.id, improvementId: 'pasture',
    tileId: city.tileId, startedRound: 2, paid: {}, workRequired: 4, workDone: 0 };
  delete (city.construction.active as { tileId?: number }).tileId;
  assert.equal(chronicleEventDestination(state, source, null), null);
});

void test('wonder and rail event destinations bind the existing exact Work picker keys instead of generic active keys', () => {
  const state = createWorld(1701); const city = state.cities[0]; const wonder = WONDERS[0]; assert.ok(city && wonder);
  const order = { kind: 'wonder' as const, ruleVersion: 1 as const, id: 'wonder-order', cityId: city.id, wonderId: wonder.id,
    tileId: 7, startedRound: 2, paid: { materials: 8 }, workRequired: 8, workDone: 2 };
  city.construction = { active: order, lastCompleted: null };
  const started = { ...event(2, 'construction-started'), detail: order.id, tileId: order.tileId };
  const destination = chronicleEventDestination(state, started, null);
  assert.ok(destination?.kind === 'site');
  assert.equal(destination.workId, wonderWorkRows(townDevelopmentFacts(state, city.id).wonders, city.id)[0]?.key);
  assert.equal(destination.workId, `wonder:${wonder.id}:${order.id}`);
  const completion = { kind: 'wonder' as const, ruleVersion: 1 as const, orderId: order.id, cityId: city.id, civId: city.civId,
    wonderId: wonder.id, tileId: 7, startedRound: 2, completedRound: 4, paid: { materials: 8 }, workRequired: 8, eventId: 'wonder-finished' };
  city.construction.active = null;
  state.wonders = { [wonder.id]: { ruleVersion: 1, completion, losses: [], boostLimit: 2, boostPercent: 20, boosts: [] } };
  const completed = { ...event(4, 'wonder-completed'), id: completion.eventId, detail: order.id, tileId: completion.tileId, wonderCompletion: completion };
  const finished = chronicleEventDestination(state, completed, null); assert.ok(finished?.kind === 'site');
  assert.equal(finished.workId, wonderWorkRows(townDevelopmentFacts(state, city.id).wonders, city.id)[0]?.key);
  const retainedWonder = state.wonders[wonder.id]; assert.ok(retainedWonder);
  retainedWonder.completion = { ...completion, orderId: 'different-order' };
  const unrelated = chronicleEventDestination(state, completed, null); assert.ok(unrelated?.kind === 'site'); assert.equal(unrelated.workId, null);
  for (const invalid of [{ ...completed, id: 'other-event' }, { ...completed, round: 5 }, { ...completed, actor: 9 }, { ...completed, tileId: 8 }])
    assert.equal(chronicleEventDestination(state, invalid, null), null);
  const rail = { kind: 'rail' as const, ruleVersion: 1 as const, id: 'rail-order', cityId: city.id, edgeId: '7:8', tileId: 7,
    toTileId: 8, startedRound: 2, paid: { materials: 4 }, strategicPaid: { iron: 1 }, workRequired: 2, workDone: 0 };
  city.construction.active = rail;
  const railDestination = chronicleEventDestination(state, { ...started, detail: rail.id }, null);
  assert.ok(railDestination?.kind === 'site'); assert.equal(railDestination.workId, railWorkRows(city)[0]?.key);
  assert.equal(railDestination.workId, `rail:${rail.edgeId}:${rail.id}`);
});

void test('completed rail events open the exact retained rail Work row with full receipt identity', () => {
  const state = createWorld(1701); const city = state.cities[0]; assert.ok(city);
  const completion = { kind: 'rail' as const, ruleVersion: 1 as const, orderId: 'finished-rail-order', cityId: city.id, civId: city.civId,
    edgeId: '7:8', tileId: 7, toTileId: 8, startedRound: 2, completedRound: 4, paid: { materials: 4 }, strategicPaid: { iron: 1 }, workRequired: 2, eventId: 'rail-finished' };
  state.railEdges = { [completion.edgeId]: completion };
  city.construction = { active: null, lastCompleted: null };
  const source = { ...event(4, 'rail-completed'), id: completion.eventId, detail: completion.edgeId, tileId: completion.tileId, railCompletion: completion };
  const before = structuredClone(state); const destination = chronicleEventDestination(state, source, null);
  assert.ok(destination?.kind === 'site'); assert.equal(destination.cityId, city.id); assert.equal(destination.tileId, completion.tileId);
  assert.equal(destination.workId, railWorkRows(city, observedRail(state, city.civId, city.id))[0]?.key);
  assert.equal(destination.workId, `rail:${completion.edgeId}:${completion.orderId}`);
  assert.deepEqual(state, before);
  for (const invalid of [{ ...source, id: 'wrong-event' }, { ...source, detail: '8:9' }, { ...source, tileId: 8 }, { ...source, round: 5 },
    { ...source, actor: 9 }, { ...source, target: 9 }, { ...source, railCompletion: { ...completion, orderId: 'wrong-order' } },
    { ...source, railCompletion: { ...completion, cityId: 'wrong-town' } }, { ...source, railCompletion: { ...completion, civId: 9 } },
    { ...source, railCompletion: { ...completion, toTileId: 9 } }]) assert.equal(chronicleEventDestination(state, invalid, null), null);
  delete state.railEdges[completion.edgeId]; assert.equal(chronicleEventDestination(state, source, null), null);
});

void test('presentation keeps three real stories and the complete record while removing technical proof from the compact summary', () => {
  const state = createWorld(1701); state.events = [event(1), event(2), event(3), event(4)];
  const original = spectatorChronicle(state); const before = structuredClone(original);
  const stories = presentChronicleStories(state, original);
  assert.equal(stories.length, 3); assert.deepEqual(original, before);
  assert.deepEqual(stories.map(story => story.event.id), original.map(story => story.event.id));
  assert.equal(chronicleSummary('12.5 Food moved. Supplies were paid.'), '12.5 Food moved.');
  assert.equal(chronicleSummary('The recorded details are in Events → Details.'), '');
  assert.ok(chronicleSummary('Long factual result '.repeat(30)).length <= 140);
  assert.equal(presentChronicleStories({ ...state, events: [] }, original)[0]?.destination, null);
});

void test('one current headline and two recent rows remain inert, keyboard actions retain identity, and stale world actions cannot fire', () => {
  class ElementRecord {
    tag: string; textContent = ''; className = ''; dataset: Record<string, string> = {}; children: ElementRecord[] = [];
    attributes = new Map<string, string>(); listeners = new Map<string, () => void>(); focused = false;
    constructor(tag: string) { this.tag = tag; }
    set innerHTML(_value: string) { throw new Error('Text must remain inert'); }
    append(...children: ElementRecord[]): void { this.children.push(...children); }
    replaceChildren(...children: ElementRecord[]): void { this.children = children; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
    contains(value: ElementRecord): boolean { return this.all().includes(value); }
    focus(): void { this.focused = true; }
    all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const originals = new Map(['document', 'HTMLElement', 'HTMLButtonElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const doc: { activeElement: ElementRecord | null; createElement: (tag: string) => ElementRecord; createElementNS: (_ns: string, tag: string) => ElementRecord } = {
    activeElement: null, createElement: tag => new ElementRecord(tag), createElementNS: (_ns, tag) => new ElementRecord(tag),
  };
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  try {
    const state = createWorld(1701); state.events = [event(1), event(2), { ...event(3), title: '<img src=x onerror=alert(1)>' }];
    const stories = presentChronicleStories(state, spectatorChronicle(state));
    const lead = stories[0]; assert.ok(lead); lead.summary = 'Construction finished.';
    const host = new ElementRecord('ol'); let selected = '';
    assert.ok(host instanceof HTMLElement);
    const render = (identity: string): void => renderChronicle(host, stories, destination => { selected = destination.label; }, identity);
    render('world-one/earth');
    assert.equal(host.children.length, 3); assert.equal(host.children[0]?.className, 'chronicle-current');
    assert.equal(host.all().filter(node => node.className === 'chronicle-result').length, 1);
    assert.equal(host.all().filter(node => node.className === 'chronicle-cause').length, 0);
    assert.ok(host.all().some(node => node.textContent === '<img src=x onerror=alert(1)>'));
    assert.equal(host.all().some(node => node.tag === 'img'), false);
    const old = host.all().find(node => node.tag === 'button'); assert.ok(old);
    old.listeners.get('click')?.(); assert.ok(selected);
    doc.activeElement = old; render('world-one/earth');
    assert.ok(host.all().some(node => node.dataset['storyId'] === old.dataset['storyId'] && node.focused));
    selected = ''; render('world-two/earth'); old.listeners.get('click')?.(); assert.equal(selected, '');
    assert.equal(host.all().some(node => node.focused), false);
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
