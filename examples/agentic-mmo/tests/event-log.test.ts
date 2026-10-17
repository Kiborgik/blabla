import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import type { RouteResultCue } from '../visuals/route-cues.ts';
import { eventLogEntries, latestStoryEvent, renderEventLog } from '../web/event-log.ts';

function event(overrides: Partial<GameEvent> = {}): GameEvent {
  return { id: '8:0', round: 4, type: 'earthquake', title: 'Earthquake in Tidehaven', detail: 'city-3', actor: 5, target: 3, tileId: 157,
    cause: 'Recorded Director choice', effects: ['Tidehaven damage 0 → 35'], importance: 3, ...overrides };
}
const civilizations = [{ id: 3, name: 'Pelagos', color: '#68d9d3' }];

void test('an all-important window retains newest24 in original order without mutation', () => {
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
void test('first-glance disaster names the event and hides opaque route identity while retaining its exact record', () => {
  const [row] = eventLogEntries([event({ title: 'The earth moves: Pelagos', effects: ['Route route-203 damage 0 → 25'] })], { civilizations });
  assert.equal(row?.title, 'Earthquake hit Pelagos');
  assert.equal(row?.deltas[0]?.subject, 'Trade route');
  assert.deepEqual(row?.effects, ['Route route-203 damage 0 → 25']);
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
function receipt(): Extract<RouteResultCue, { kind: 'delivery' }> {
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

void test('first-glance research names the recorded target and never calls its start an unlock', () => {
  const options = { civilizations: [{ id: 2, name: 'Ember', color: '#f1a26c' }] };
  const [started] = eventLogEntries([event({ actor: 2, target: 2, type: 'research-started', title: 'Ember begins a discovery', detail: 'fuel-management', effects: ['Research target fuel-management'] })], options);
  assert.equal(started?.title, 'Ember began Fuel management');
  assert.equal(started?.category, 'Researching');
  assert.doesNotMatch(started?.title ?? '', /unlock|complete|fuel-management/i);
  const [completed] = eventLogEntries([event({ actor: 2, target: 2, type: 'research-completed', title: 'Ember discovers Fuel management', effects: ['Technology fuel-management unlocked'] })], options);
  assert.equal(completed?.title, 'Ember discovered Fuel management');
  assert.equal(completed?.category, 'Discovery');
  const [unknown] = eventLogEntries([event({ type: 'research-started', title: 'A recorded unfamiliar research choice', detail: 'future-secret' })], options);
  assert.equal(unknown?.title, 'A recorded unfamiliar research choice');
});

void test('constructed and operating buildings have distinct plain named headlines', () => {
  const [built] = eventLogEntries([event({ actor: 3, target: 3, type: 'building-completed', title: 'Tidehaven builds Kiln', detail: 'Constructed', effects: [] })], { civilizations });
  assert.equal(built?.title, 'Tidehaven completed Kiln');
  assert.equal(built?.category, 'Built');
  assert.equal(built?.deltas.length, 0);
  const [working] = eventLogEntries([event({ actor: 3, target: 3, type: 'building-operation', title: 'Tidehaven: Kiln operated', detail: 'city-3/kiln at strategic round 4', effects: ['Paid 2 energy', 'Produced 7.8 materials'] })], { civilizations });
  assert.equal(working?.title, 'Tidehaven · Kiln');
  assert.equal(working?.category, 'Made supplies');
  assert.deepEqual(working?.deltas.map(delta => [delta.kind, delta.value]), [['payment', 2], ['production', 7.8]]);
  const [paused] = eventLogEntries([event({ type: 'building-operation-changed', title: 'Tidehaven pauses irrigation', detail: 'city-3/irrigation' })], { civilizations });
  assert.equal(paused?.title, 'Tidehaven pauses Irrigation works');
});

void test('important recorded choices survive routine floods within a fixed96 input and24 output budget', () => {
  const choice = event({ id: '1:0', type: 'research-started', title: 'Pelagos begins a discovery', detail: 'kiln-firing', actor: 3 });
  const routine = Array.from({ length: 60 }, (_, index) => event({ id: `${index + 2}:0`, type: 'settlement-production' }));
  const before = structuredClone(routine);
  const rows = eventLogEntries([choice, ...routine], { civilizations });
  assert.equal(rows.length, 24);
  assert.ok(rows.some(row => row.id === choice.id));
  assert.deepEqual(routine, before);
  assert.ok(!eventLogEntries([choice, ...Array.from({ length: 96 }, (_, index) => event({ id: `${index + 2}:0`, type: 'clock-tick' }))], { civilizations }).some(row => row.id === choice.id));
});

void test('trade consent headlines name both recorded parties without pretending to ship cargo', () => {
  const options = { civilizations: [...civilizations, { id: 4, name: 'Vesper', color: '#cdb0ef' }] };
  const [row] = eventLogEntries([event({ type: 'trade-accepted', actor: 3, target: 4, title: 'Pelagos accepts a standing exchange', effects: [] })], options);
  assert.equal(row?.title, 'Pelagos agreed to trade with Vesper');
  assert.equal(row?.category, 'Agreement');
  assert.equal(row?.deltas.length, 0);
});

void test('map story retains a named decision through routine seasons while paid zero output stays honest', () => {
  const choice = event({ type: 'research-started', detail: 'fuel-management' });
  const season = event({ id: '9:0', type: 'settlement-production' });
  assert.equal(latestStoryEvent([choice, season]), choice);
  assert.equal(latestStoryEvent([season, event({ type: 'clock-tick' })]), season);
  const [row] = eventLogEntries([event({ type: 'building-operation', title: 'Tidehaven: Kiln operated', effects: ['Paid 2 energy'] })], { civilizations });
  assert.equal(row?.category, 'No output');
  assert.doesNotMatch(row?.summary ?? '', /made supplies/i);
});

void test('only the exact retained delivery exposes separate sent cargo transport and commerce for both parties', () => {
  const cue: RouteResultCue = { ...receipt(), kind: 'delivery', factSource: 'bound-agreement', exchange: {
    proposer: { civilization: 3, cargo: { energy: 4 }, paidUpkeep: { energy: 1 }, creditedCommerce: { credits: 2 } },
    recipient: { civilization: 4, cargo: { materials: 3 }, paidUpkeep: { energy: 1 }, creditedCommerce: { credits: 2 } },
  } };
  const options = { civilizations: [...civilizations, { id: 4, name: 'Vesper', color: '#cdb0ef' }], receipts: [cue] };
  const [row] = eventLogEntries([event({ type: 'trade-delivered', detail: 'route-1', actor: 3, target: 4 })], options);
  assert.deepEqual(row?.exchanges, [
    { from: 'Pelagos', to: 'Vesper', cargo: '4 Energy', upkeep: '1 Energy', commerce: '2 Credits' },
    { from: 'Vesper', to: 'Pelagos', cargo: '3 Materials', upkeep: '1 Energy', commerce: '2 Credits' },
  ]);
  assert.deepEqual(eventLogEntries([event({ type: 'trade-delivered', detail: 'route-1', id: '9:0' })], options)[0]?.exchanges, []);
});

class ElementRecord {
  value = ''; disabled = false;
  focus(): void { return; }
  listeners = new Map<string, () => void>();
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  tag: string; textContent = ''; className = ''; dataset: Record<string, string> = {};
  children: ElementRecord[] = []; attributes = new Map<string, string>();
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_value: string) { throw new Error('History must not interpret recorded text as markup'); }
  append(...nodes: ElementRecord[]): void { this.children.push(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  replaceChildren(...nodes: ElementRecord[]): void { this.children = nodes; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}
function firstGlance(node: ElementRecord): string {
  const children = node.tag === 'details' && !node.attributes.has('open') ? node.children.filter(child => child.tag === 'summary') : node.children;
  return [node.textContent, ...children.map(firstGlance)].join(' ');
}
void test('first glance names the action and keeps raw causes IDs and routine results behind native disclosures', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: ElementRecord[] = [];
  const make = (tag: string): ElementRecord => { const node = new ElementRecord(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag) } });
  try {
    const host = document.createElement('ol');
    renderEventLog(host, [
      event({ type: 'research-started', actor: 3, target: 3, detail: 'fuel-management', title: 'Pelagos begins a discovery', cause: 'Opaque engine explanation', effects: ['Research target fuel-management'] }),
      event({ id: '9:0', type: 'building-operation', actor: 3, target: 3, title: 'Tidehaven: Kiln operated', effects: ['Paid 2 energy', 'Produced 7.8 materials'] }),
    ], { civilizations });
    const root = nodes[0]; assert.ok(root);
    const visible = firstGlance(root);
    assert.match(visible, /Pelagos began Fuel management/);
    assert.match(visible, /Routine seasons & calendar/);
    assert.doesNotMatch(visible, /Opaque engine|fuel-management|Event 8:0|Made 7.8/);
    const filter = nodes.find(node => node.tag === 'select' && node.attributes.get('aria-label') === 'Show'); assert.ok(filter); filter.value = 'routine'; filter.listeners.get('change')?.();
    assert.match(root.content(), /Used  2 Energy|Used 2 Energy/);
    assert.match(root.content(), /Made  7.8 Materials|Made 7.8 Materials/);
    assert.ok(nodes.some(node => node.tag === 'summary' && node.textContent === 'Details'));
    assert.ok(nodes.some(node => node.className === 'event-log-page')); 
  } finally { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); }
});
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
    assert.ok(nodes.some(node => node.tag === 'summary' && node.textContent === 'Details'));
    assert.ok(nodes.some(node => node.tag === 'svg' && node.attributes.get('aria-hidden') === 'true'));
    assert.ok(nodes.some(node => node.attributes.get('style') === '--actor-color:#68d9d3'));
    assert.ok(nodes.every(node => node.tag !== 'script'));
    renderEventLog(host, [], { civilizations: [{ id: 5, name: 'Injected', color: 'url(secret)' }] });
    assert.match(root.content(), /No recorded events/);
  } finally { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); }
});
