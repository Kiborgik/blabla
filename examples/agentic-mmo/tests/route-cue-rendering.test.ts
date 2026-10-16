import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import type { RouteCueObservation, RouteResultCue } from '../visuals/route-cues.ts';
import { projectRouteCues } from '../visuals/route-cues.ts';
import { createCueStream, createWorldCues, eventAnchor, latestCueEvent, routeResultPresentation } from '../web/world-cues.ts';
import { eventVisual } from '../visuals/world-visuals.ts';
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
  dataset: Record<string, string> = {}; style: Record<string, string> = {}; attributes = new Map<string, string>(); children: NodeRecord[] = []; parent: NodeRecord | null = null;
  classList = { toggle: (name: string, enabled: boolean): void => { const values = new Set(this.className.split(' ')); if (enabled) values.add(name); else values.delete(name); this.className = [...values].join(' '); } };
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: NodeRecord[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  replaceChildren(...nodes: NodeRecord[]): void { this.children = []; this.append(...nodes); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  querySelectorAll(): NodeRecord[] { return []; }
  getBoundingClientRect(): DOMRect { return { x: 0, y: 0, top: 0, left: 0, bottom: this.clientHeight, right: this.clientWidth, width: this.clientWidth, height: this.clientHeight, toJSON: () => ({}) }; }
  content(): string { return [this.textContent, ...this.children.map((child) => child.content())].join(' '); }
}
function recordingDocument(): { nodes: NodeRecord[]; restore: () => void } {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'); const nodes: NodeRecord[] = [];
  const make = (tag: string): NodeRecord => { const node = new NodeRecord(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag), querySelectorAll: () => [],
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
