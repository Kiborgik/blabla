import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import type { RouteCueObservation, RouteResultCue } from '../visuals/route-cues.ts';
import { projectRouteCues } from '../visuals/route-cues.ts';
import { createCueStream, createWorldCues, eventAnchor, latestCueEvent, routeResultPresentation } from '../web/world-cues.ts';
import { eventVisual } from '../visuals/world-visuals.ts';
import { routeLabelPlacement } from '../visuals/route-visuals.ts';
import type { AtlasWorld } from '../web/atlas.ts';

function fixture(): RouteCueObservation {
  return { identity: 'offline-fixture', revision: 10, mode: 'live', events: [], routes: [{
    id: 'route-exact', from: 'frontier', to: 'harbor', owner: 0, partner: 1, ownerName: 'Aster', partnerName: 'Pelagos', active: true, volume: 7, damage: 20,
    fromTown: { id: 'frontier', name: 'Far Hearth', civilization: 'Aster', color: '#e7bf69', q: 2, r: 1 },
    toTown: { id: 'harbor', name: 'Harbor', civilization: 'Pelagos', color: '#81b8d2', q: 5, r: 2 },
    agreement: { offerId: 'offer-exact', enabled: true, acceptedRound: 2, nextDeliveryRound: 12, lastAttemptRound: 8, lastDeliveryRound: 8, deliveryCount: 1,
      blockedBy: null, blockedReason: null, closedRound: null,
      terms: { recipeId: 'fixture', recipeVersion: 1, constructionCost: { materials: 5 }, proposerCargo: { food: 4 }, recipientCargo: { materials: 3 },
        proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 2 }, proposerYield: { credits: 2 }, recipientYield: { credits: 3 }, cadenceRounds: 4, damageDisableAt: 50 } },
  }] };
}
function delivered(id = '11:0'): GameEvent {
  return { id, round: 8, type: 'trade-delivered', title: 'Exchange', detail: 'route-exact', actor: 0, target: 1, tileId: 99,
    cause: 'Accepted offer offer-exact reached strategic round 8 with both combined obligations supplied', effects: ['7 cargo exchanged atomically'], importance: 3 };
}
function ordinary(id = '11:1'): GameEvent { return { ...delivered(id), type: 'population-growth', effects: ['Population 12'] }; }
function repaired(id = '11:2'): GameEvent {
  return { ...delivered(id), type: 'public-project-completed', detail: 'project-exact', publicProjectResult: {
    projectId: 'project-exact', routeId: 'route-exact', agreementOfferId: 'offer-exact', outcome: 'completed', reason: 'Both paid',
    proposer: 1, recipient: 0, proposerPaid: { materials: 7 }, recipientPaid: { materials: 5, credits: 2 }, damageBefore: 12, damageAfter: 0,
  } };
}
function result(event = delivered()): RouteResultCue {
  const base = fixture();
  const cue = projectRouteCues({ identity: base.identity, revision: 10 }, { ...base, revision: 11, events: [event] }).cues[0];
  assert.ok(cue); return cue;
}
const world: AtlasWorld = { tiles: [{ id: 99, q: -10, r: -10, owner: 0, terrain: 'grassland', height: .4 }], cities: [], routes: [] };

void test('one stream suppresses initial and repeated results and replaces generic delivery fallback', () => {
  const stream = createCueStream(); const base = fixture();
  assert.deepEqual(stream.observe(base, 3).events, []);
  const next = { ...base, revision: 11, events: [delivered()] };
  const batch = stream.observe(next, 3);
  assert.equal(batch.events.length, 1);
  assert.equal(batch.routeResults.length, 1);
  assert.equal(batch.events[0], batch.routeResults[0]);
  assert.deepEqual(stream.observe(next, 3).events, []);
  const generic = eventVisual(delivered()); assert.ok(generic);
  assert.equal(eventAnchor(world, generic), null);
});

void test('route and ordinary results share one narrow slot or at most three desktop slots', () => {
  for (const slots of [1, 3]) {
    const stream = createCueStream(); const base = fixture(); stream.observe(base, slots);
    const batch = stream.observe({ ...base, revision: 11, events: [delivered(), ordinary(), repaired(), ordinary('11:3')] }, slots);
    assert.equal(batch.events.length, slots);
    assert.equal(new Set(batch.events.map((cue) => cue.eventId)).size, slots);
  }
});

void test('history and hidden baseline suppress both result classes and resume without a cue storm', () => {
  const stream = createCueStream(); const base = fixture(); stream.observe(base, 3);
  const next = { ...base, revision: 11, events: [delivered(), ordinary()] };
  assert.deepEqual(stream.observe({ ...next, mode: 'history' }, 3).events, []);
  assert.deepEqual(stream.observe(next, 3).events, []);
  assert.deepEqual(stream.observe({ ...next, revision: 12, mode: 'baseline', events: [delivered('12:0'), ordinary('12:1')] }, 3).events, []);
  assert.deepEqual(stream.observe({ ...next, revision: 12 }, 3).events, []);
  assert.equal(stream.observe({ ...next, revision: 13, events: [delivered('13:0'), ordinary('13:1')] }, 3).events.length, 2);
});

void test('an old response cannot rewind stream history or restart a seen ordinary cue', () => {
  const stream = createCueStream(); const base = fixture(); stream.observe(base, 3);
  const latest = { ...base, revision: 11, events: [ordinary()] }; stream.observe(latest, 3);
  assert.deepEqual(stream.observe(base, 3).events, []);
  assert.deepEqual(stream.observe(latest, 3).events, []);
});

void test('receipt presentation keeps exact towns cargo paid transport and commerce separately readable', () => {
  const presentation = routeResultPresentation(result());
  assert.equal(presentation.icon, 'cargo');
  assert.equal(presentation.deltas[0]?.value, 7);
  assert.match(presentation.summary, /Far Hearth.*Harbor.*8/);
  assert.match(presentation.details.join(' '), /Cargo sent.*Aster.*4 Food/);
  assert.match(presentation.details.join(' '), /Transport paid.*Aster.*1 Energy/);
  assert.match(presentation.details.join(' '), /Commerce received.*Pelagos.*3 Credits/);
  assert.doesNotMatch(presentation.details.join(' '), /net|construction|arriv|journey|in transit/i);
  const repair = routeResultPresentation(result(repaired()));
  assert.equal(repair.icon, 'repair');
  assert.equal(repair.deltas[0]?.value, -12);
  assert.match(repair.details.join(' '), /12%.*0%.*20%/);
  assert.match(repair.details.join(' '), /Paid.*Pelagos.*7 Materials/);
});

void test('unbound history keeps its recorded aggregate and says why no map accent exists', () => {
  const base = fixture();
  const cue = projectRouteCues({ identity: base.identity, revision: 10 }, { ...base, revision: 11, routes: [], events: [delivered()] }).cues[0];
  assert.ok(cue);
  const presentation = routeResultPresentation(cue);
  assert.match(presentation.details.join(' '), /Recorded cargo: 7/);
  assert.match(presentation.details.join(' '), /endpoint position unavailable/i);
  assert.doesNotMatch(presentation.details.join(' '), /Transport paid/);
});

void test('changed world identity baselines both classes without replaying or mutating observations', () => {
  const stream = createCueStream(); const base = fixture(); stream.observe(base, 3);
  const next = { ...base, identity: 'new-world', revision: 11, events: [delivered(), ordinary()] };
  const before = structuredClone(next);
  assert.deepEqual(stream.observe(next, 3), { events: [], routeResults: [] });
  assert.deepEqual(next, before);
  assert.equal(stream.observe({ ...next, revision: 12, events: [delivered('12:0'), ordinary('12:1')] }, 3).events.length, 2);
});

void test('latest charter result stays the story through a later clock while unrelated later actions still win', () => {
  const growth = ordinary('9:0'); const repair = repaired(); const clock = { ...ordinary('12:0'), type: 'clock-tick' };
  assert.equal(latestCueEvent([growth, repair, clock]), repair);
  assert.equal(latestCueEvent([repair, clock]), repair);
  const later = ordinary('13:0');
  assert.equal(latestCueEvent([growth, repair, clock, later]), later);
});

class NodeRecord {
  tag: string; textContent = ''; className = ''; hidden = false; clientWidth = 1188; clientHeight = 761;
  bounds: { left: number; top: number; width: number; height: number } | null = null;
  cueSize = { width: 172, height: 96 };
  dataset: Record<string, string> = {}; style: Record<string, string> = {}; attributes = new Map<string, string>(); children: NodeRecord[] = []; parent: NodeRecord | null = null;
  classList = { toggle: (name: string, enabled: boolean): void => { const values = new Set(this.className.split(' ')); if (enabled) values.add(name); else values.delete(name); this.className = [...values].join(' '); } };
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: NodeRecord[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  replaceChildren(...nodes: NodeRecord[]): void { this.children = []; this.append(...nodes); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  querySelectorAll(): NodeRecord[] { return []; }
  getBoundingClientRect(): DOMRect {
    const route = this.className.split(' ').includes('route-result-card');
    const cue = this.className.split(' ').includes('world-cue');
    const width = this.hidden ? 0 : cue ? route ? 180 : this.cueSize.width : this.bounds?.width ?? this.clientWidth;
    const height = this.hidden ? 0 : cue ? route ? 44 : this.cueSize.height : this.bounds?.height ?? this.clientHeight;
    const origin = cue ? this.parent?.parent?.bounds : this.bounds;
    const left = cue ? (origin?.left ?? 0) + Number.parseFloat(this.style['left'] ?? '0') - width / 2 : origin?.left ?? 0;
    const top = cue ? (origin?.top ?? 0) + Number.parseFloat(this.style['top'] ?? '0') - (route ? 0 : height) : origin?.top ?? 0;
    return { x: left, y: top, top, left, bottom: top + height, right: left + width, width, height, toJSON: () => ({}) };
  }
  content(): string { return [this.textContent, ...this.children.map((child) => child.content())].join(' '); }
}
function recordingDocument(obstacles: NodeRecord[] = [], cueSize = { width: 172, height: 96 }): { nodes: NodeRecord[]; restore: () => void } {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'); const nodes: NodeRecord[] = [];
  const make = (tag: string): NodeRecord => { const node = new NodeRecord(tag); node.cueSize = cueSize; nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag),
    querySelectorAll: (selector: string) => obstacles.filter((node) => selector.split(',').some((part) => node.className.split(' ').includes(part.trim().slice(1)))),
    createTextNode: (text: string) => { const node = make('#text'); node.textContent = text; return node; },
  } });
  return { nodes, restore: () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); } };
}

void test('shared DOM adapter places two stationary exact-town marks and one result card with cleanup', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = recordingDocument();
  try {
    const host = document.createElement('main');
    const projected: number[][] = [];
    const cues = createWorldCues(host, world, (x, z) => { projected.push([x, z]); return { x: 200 + x * 10, y: 300 + z * 10 }; });
    const event = result(); cues.show([event]);
    const marks = dom.nodes.filter((node) => node.className.includes('route-result-mark') && node.parent);
    assert.equal(marks.length, 2);
    assert.deepEqual(marks.map((node) => node.dataset['cityId']), ['frontier', 'harbor']);
    assert.equal(dom.nodes.filter((node) => node.className.includes('route-result-card') && node.parent).length, 1);
    assert.ok(projected.every(([x, z]) => x !== -10 && z !== -10));
    const positions = marks.map((node) => ({ ...node.style }));
    cues.update(); assert.deepEqual(marks.map((node) => ({ ...node.style })), positions);
    cues.setMotion(false); assert.ok(dom.nodes.find((node) => node.className.includes('world-cues'))?.className.includes('still'));
    cues.show([event]); assert.equal(dom.nodes.filter((node) => node.className.includes('route-result-card') && node.parent).length, 1);
    context.mock.timers.tick(2700);
    assert.equal(marks.filter((node) => node.parent).length, 0);
    cues.show([result(repaired())]); cues.clear();
    assert.equal(dom.nodes.filter((node) => node.className.includes('route-result-mark') && node.parent).length, 0);
    cues.dispose(); assert.equal(dom.nodes.filter((node) => node.className.includes('world-cues') && node.parent).length, 0);
  } finally { dom.restore(); }
});

function obstacle(className: string, left: number, top: number, width: number, height: number): NodeRecord {
  const node = new NodeRecord('section'); node.className = className; node.bounds = { left, top, width, height }; return node;
}

function separated(a: DOMRect, b: DOMRect): boolean {
  return a.right + 6 <= b.left || b.right + 6 <= a.left || a.bottom + 6 <= b.top || b.bottom + 6 <= a.top;
}

void test('ordinary cues measure their full cards and reserve separate readable bounds without route results', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = recordingDocument([], { width: 260, height: 142 });
  try {
    const host = document.createElement('main');
    const localWorld = { ...world, tiles: [...world.tiles, { ...world.tiles[0]!, id: 100, q: -9 }] };
    const first = eventVisual(ordinary()); const second = eventVisual({ ...ordinary('11:3'), tileId: 100 });
    assert.ok(first && second);
    const cues = createWorldCues(host, localWorld, () => ({ x: 590, y: 420 }));
    cues.show([first, second]);
    const cards = dom.nodes.filter((node) => node.dataset['event'] && node.parent);
    assert.equal(cards.length, 2);
    assert.ok(cards.every((card) => !card.hidden));
    assert.ok(separated(cards[0]!.getBoundingClientRect(), cards[1]!.getBoundingClientRect()));
    const positions = cards.map((card) => ({ ...card.style }));
    cues.update(); assert.deepEqual(cards.map((card) => ({ ...card.style })), positions);
    cues.dispose();
  } finally { dom.restore(); }
});

void test('ordinary cues avoid every active HUD and map-label boundary even when no route cue exists', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const name of ['masthead', 'panel', 'world-heading', 'era-pill', 'map-tools', 'layer-controls', 'chronicle', 'connection-actions', 'map-hint', 'city-label', 'flat-city', 'route-map-label', 'flat-route-label']) {
    const hud = obstacle(name, 380, 180, 240, 160);
    const dom = recordingDocument([hud], { width: 236, height: 116 });
    try {
      const host = document.createElement('main');
      const event = eventVisual(ordinary()); assert.ok(event);
      const cues = createWorldCues(host, world, () => ({ x: 500, y: 350 }));
      cues.show([event]);
      const card = dom.nodes.find((node) => node.dataset['event']); assert.ok(card);
      assert.equal(card.hidden, false, name);
      assert.ok(separated(card.getBoundingClientRect(), hud.getBoundingClientRect()), name);
      cues.dispose();
    } finally { dom.restore(); }
  }
});

void test('ordinary bottom-anchored cards stay below the masthead and inside an offset viewport edge', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const hud = obstacle('masthead', 64, 32, 1188, 52);
  const dom = recordingDocument([hud], { width: 254, height: 126 });
  try {
    const host = document.createElement('main');
    dom.nodes[0]!.bounds = { left: 64, top: 32, width: 1188, height: 761 };
    const event = eventVisual(ordinary()); assert.ok(event);
    const cues = createWorldCues(host, world, () => ({ x: 12, y: 14 }));
    cues.show([event]);
    const card = dom.nodes.find((node) => node.dataset['event']); assert.ok(card);
    assert.equal(card.hidden, false);
    const bounds = card.getBoundingClientRect();
    assert.ok(bounds.left >= 72 && bounds.top >= 40 && bounds.right <= 1244 && bounds.bottom <= 785);
    assert.ok(separated(bounds, hud.getBoundingClientRect()));
    assert.equal(Number.parseFloat(card.style['top']!), bounds.bottom - 32);
    cues.dispose();
  } finally { dom.restore(); }
});

void test('route and ordinary cards reserve one shared collision space in either arrival order', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const routeFirst of [true, false]) {
    const dom = recordingDocument([], { width: 248, height: 124 });
    try {
      const host = document.createElement('main');
      const event = eventVisual(ordinary()); assert.ok(event);
      const route = result();
      const cues = createWorldCues(host, world, () => ({ x: 590, y: 420 }));
      cues.show(routeFirst ? [route, event] : [event, route]);
      const cards = dom.nodes.filter((node) => node.dataset['event'] && node.parent);
      assert.equal(cards.length, 2);
      assert.ok(cards.every((card) => !card.hidden));
      assert.ok(separated(cards[0]!.getBoundingClientRect(), cards[1]!.getBoundingClientRect()));
      cues.dispose();
    } finally { dom.restore(); }
  }
});

void test('narrow resize keeps one ordinary cue and recovers hidden cards without changing Chronicle events', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const hud = obstacle('chronicle', 0, 0, 0, 0); hud.textContent = 'Population grew';
  const dom = recordingDocument([hud], { width: 220, height: 100 });
  try {
    const host = document.createElement('main'); const hostRecord = dom.nodes[0]!;
    const events = [ordinary(), { ...ordinary('11:3'), tileId: 100 }]; const before = structuredClone(events);
    const visual = events.map((event) => eventVisual(event)); assert.ok(visual[0] && visual[1]);
    const localWorld = { ...world, tiles: [...world.tiles, { ...world.tiles[0]!, id: 100, q: -9 }] };
    let point = { x: 500, y: 380 };
    const cues = createWorldCues(host, localWorld, () => point);
    cues.show([visual[0], visual[1]]);
    hostRecord.clientWidth = 360; point = { x: 180, y: 220 }; cues.update();
    const cards = dom.nodes.filter((node) => node.dataset['event'] && node.parent);
    assert.equal(cards.length, 1); const card = cards[0]!;
    assert.equal(card.dataset['event'], '11:3'); assert.equal(card.hidden, false);
    assert.ok(card.getBoundingClientRect().left >= 8 && card.getBoundingClientRect().right <= 352);
    hud.bounds = { left: 0, top: 0, width: 360, height: 761 }; cues.update();
    assert.equal(card.hidden, true);
    assert.equal(hud.textContent, 'Population grew');
    assert.deepEqual(events, before); assert.equal(latestCueEvent(events), events[1]);
    hud.bounds = { left: 0, top: 0, width: 0, height: 0 }; hostRecord.clientWidth = 200; point.x = 100; cues.update();
    assert.equal(card.hidden, true);
    hostRecord.clientWidth = 360; point.x = 180; cues.update();
    assert.equal(card.hidden, false);
    assert.ok(card.getBoundingClientRect().left >= 8 && card.getBoundingClientRect().right <= 352);
    cues.dispose();
  } finally { dom.restore(); }
});

void test('placement preserves route defaults while measured oversized cards have no readable slot', () => {
  assert.deepEqual(routeLabelPlacement({ x: 250, y: 300 }, [], 501, 761), { x: 250, y: 278, width: 180, height: 44 });
  assert.deepEqual(routeLabelPlacement({ x: 250, y: 300 }, [], 501, 761, { width: 240, height: 120 }), { x: 250, y: 240, width: 240, height: 120 });
  assert.equal(routeLabelPlacement({ x: 100, y: 200 }, [], 200, 761, { width: 220, height: 100 }), null);
  assert.equal(routeLabelPlacement({ x: 250, y: 100 }, [], 501, 100, { width: 220, height: 100 }), null);
});

void test('unanchored result produces no guessed map elements and a narrow shared layer never exceeds one result', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = recordingDocument();
  try {
    const host = document.createElement('main'); Object.defineProperty(host, 'clientWidth', { value: 501 });
    const cues = createWorldCues(host, world, () => ({ x: 250, y: 200 }));
    const unbound = { ...result(), mapAnchor: null, accent: 'none' as const };
    cues.show([unbound]); assert.equal(dom.nodes.filter((node) => node.dataset['event']).length, 0);
    cues.show([result(), result(repaired())]);
    assert.equal(dom.nodes.filter((node) => node.className.includes('route-result-card') && node.parent).length, 1);
    assert.equal(dom.nodes.filter((node) => node.className.includes('route-result-mark') && node.parent).length, 2);
    cues.dispose();
  } finally { dom.restore(); }
});
