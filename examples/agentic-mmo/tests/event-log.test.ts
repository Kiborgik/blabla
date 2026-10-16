import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import type { RouteResultCue } from '../visuals/route-cues.ts';
import { eventLogEntries, renderEventLog } from '../web/event-log.ts';

function event(overrides: Partial<GameEvent> = {}): GameEvent {
  return { id: '8:0', round: 4, type: 'earthquake', title: 'Earthquake in Tidehaven', detail: 'city-3', actor: 5, target: 3, tileId: 157,
    cause: 'Recorded Director choice', effects: ['Tidehaven damage 0 → 35'], importance: 3, ...overrides };
}
const civilizations = [{ id: 3, name: 'Pelagos', color: '#68d9d3' }];

void test('newest 24 preserve original order and do not alter input', () => {
  const input = Array.from({ length: 40 }, (_, index) => event({ id: `${index}:0` }));
  const before = structuredClone(input);
  assert.deepEqual(eventLogEntries(input, { civilizations }).map(row => row.id), input.slice(-24).toReversed().map(row => row.id));
  assert.deepEqual(input, before);
});
void test('canonical earthquake title actors and signed damage remain explicit', () => {
  const [row] = eventLogEntries([event()], { civilizations });
  assert.ok(row);
  assert.equal(row.title, 'Earthquake in Tidehaven');
  assert.deepEqual(row.participants.map(person => person.name), ['World Director', 'Pelagos']);
  assert.equal(row.deltas[0]?.value, 35);
  assert.equal(row.deltas[0]?.tone, 'negative');
  assert.deepEqual(row.effects, ['Tidehaven damage 0 → 35']);
});
void test('gross production paid inputs and capacity retain separate delta grammar', () => {
  const [row] = eventLogEntries([event({ type: 'building-operation', title: 'Kiln operated', effects: ['Produced 3 materials', 'Paid 2 energy', 'Seasonal materials +4'] })], { civilizations });
  assert.ok(row);
  assert.deepEqual(row.deltas.map(delta => delta.kind), ['production', 'payment', 'rate']);
  assert.equal(row.deltas[1]?.tone, 'neutral');
  assert.match(row.qualifiers.join(' '), /Produced · Before costs/);
  assert.match(row.qualifiers.join(' '), /Paid inputs/);
  assert.match(row.qualifiers.join(' '), /Base \/ season/);
});
void test('blocked trade and building retain canonical reasons without invented stop or supply claims', () => {
  for (const type of ['trade-blocked', 'building-operation']) {
    const [row] = eventLogEntries([event({ type, title: 'Result blocked', cause: 'Resident support unavailable', effects: [] })], { civilizations });
    assert.ok(row);
    assert.equal(row.title, 'Result blocked');
    assert.equal(row.cause, 'Resident support unavailable');
    assert.doesNotMatch(row.category, /stopped|supplies/i);
  }
});
void test('unknown kinds and missing participants keep recorded facts visible', () => {
  const [row] = eventLogEntries([event({ type: 'future-event', actor: null, target: 99, effects: ['An unfamiliar retained fact'] })], { civilizations });
  assert.ok(row);
  assert.equal(row.category, 'World record');
  assert.deepEqual(row.participants.map(person => person.name), ['World', 'Civilization 99']);
  assert.deepEqual(row.effects, ['An unfamiliar retained fact']);
  assert.equal(eventLogEntries([event({ actor: 3, target: 3 })], { civilizations })[0]?.participants.length, 1);
});
function receipt(): RouteResultCue {
  return { kind: 'delivery', eventId: '8:0', round: 4, routeId: 'route-1', agreementOfferId: 'offer-1', endpoints: null, mapAnchor: null,
    accent: 'none', label: '7 cargo delivered', aggregateCargo: 7, factSource: 'event-aggregate', exchange: null };
}
void test('only retained exact event round and route receipts may add details', () => {
  const delivery = event({ type: 'trade-delivered', detail: 'route-1', effects: ['7 cargo exchanged atomically'] });
  const options = { civilizations, receipts: [receipt()] };
  assert.match(eventLogEntries([delivery], options)[0]?.receiptDetails.join(' ') ?? '', /Recorded cargo: 7/);
  for (const mismatch of [event(), { ...delivery, id: '9:0' }, { ...delivery, round: 5 }, { ...delivery, detail: 'route-2' }]) {
    assert.deepEqual(eventLogEntries([mismatch], options)[0]?.receiptDetails, []);
  }
});
void test('unretained shipment shows aggregate without inventing per-party costs', () => {
  const [row] = eventLogEntries([event({ type: 'trade-delivered', effects: ['7 cargo exchanged atomically'] })], { civilizations });
  assert.ok(row);
  assert.equal(row.deltas[0]?.value, 7);
  assert.match(row.qualifiers.join(' '), /Per-party receipt not retained/);
  assert.deepEqual(row.receiptDetails, []);
});

class ElementRecord {
  tag: string; textContent = ''; className = ''; dataset: Record<string, string> = {};
  children: ElementRecord[] = []; attributes = new Map<string, string>();
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_value: string) { throw new Error('History must not interpret recorded text as markup'); }
  append(...nodes: ElementRecord[]): void { this.children.push(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  replaceChildren(...nodes: ElementRecord[]): void { this.children = nodes; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}
void test('DOM uses safe text native disclosure and semantic icons without history animation', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: ElementRecord[] = [];
  const make = (tag: string): ElementRecord => { const node = new ElementRecord(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag) } });
  try {
    const host = document.createElement('ol');
    renderEventLog(host, [event({ title: '<script>unsafe()</script>', effects: ['Tidehaven damage 0 → 35', 'A retained fact beyond the chips'] })], { civilizations });
    const root = nodes[0]; assert.ok(root);
    assert.match(root.content(), /<script>unsafe\(\)<\/script>/);
    assert.match(root.content(), /World Director.*Pelagos/);
    assert.match(root.content(), /A retained fact beyond the chips/);
    assert.ok(nodes.some(node => node.tag === 'summary' && node.textContent === 'Recorded details'));
    assert.ok(nodes.some(node => node.tag === 'svg' && node.attributes.get('aria-hidden') === 'true'));
    assert.ok(nodes.some(node => node.attributes.get('style') === '--actor-color:#68d9d3'));
    assert.ok(nodes.every(node => node.tag !== 'script'));
    renderEventLog(host, [], { civilizations: [{ id: 5, name: 'Injected', color: 'url(secret)' }] });
    assert.match(root.content(), /No recorded events/);
  } finally { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); }
});
