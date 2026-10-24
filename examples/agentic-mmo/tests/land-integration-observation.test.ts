import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERAS, HISTORICAL_MILESTONES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { resolveHistory } from '../core/simulation/history.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { worldJourney, renderMarsObservation } from '../web/mars-observation.ts';
import { storyLanguage } from '../web/story-language.ts';
import { landIntegrationFixture } from './fixtures/land-integration.ts';

let baseline: ReturnType<typeof landIntegrationFixture> | undefined;
function fixture() { baseline ??= landIntegrationFixture(); return structuredClone(baseline); }
function connected(state: WorldState) {
  const view = worldJourney(state).milestones.find(item => item.id === 'connected-world'); assert.ok(view); return view;
}
function milestone(state: WorldState) {
  const event = state.events.find(item => item.type === 'history-milestone' && item.landIntegration); assert.ok(event); return event;
}
function language(state: WorldState, event = milestone(state)) {
  const row = eventLogEntries([event], { civilizations: state.civilizations })[0]; assert.ok(row);
  const before = structuredClone({ state, event, row }); const result = storyLanguage(state, event, row);
  assert.deepEqual({ state, event, row }, before); return result;
}

void test('unearned journey explains both earned paths without treating agreement or counters as connection', () => {
  const { beforeDue, routeId } = fixture(); const state = beforeDue;
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'navigation');
  state.routes.find(route => route.id === routeId)!.agreement!.deliveryCount = 999;
  state.eventCounts['trade-delivered'] = 999;
  const before = structuredClone(state); const view = connected(state);
  assert.equal(view.status, 'not-yet-recorded'); assert.equal(view.proof, null);
  assert.match(view.explanation, /After states rise/); assert.match(view.explanation, /Navigation.*coastal settlement/);
  assert.match(view.explanation, /ordinary-founded town.*actual paid foreign land exchange/);
  assert.match(view.explanation, /Neither path is recorded yet/); assert.deepEqual(state, before);
});

void test('actual paid land milestone uses current town names while retaining exact proof outside the main summary', () => {
  const { state, foundedCityId, sourceCityId, foreignCityId, routeId } = fixture();
  const event = milestone(state); const witness = event.landIntegration!; const view = connected(state); const story = language(state, event);
  assert.equal(view.status, 'recorded'); assert.equal(story.title, 'A connected world');
  for (const text of [view.explanation, story.cause]) {
    for (const id of [foundedCityId, sourceCityId, foreignCityId, routeId, witness.founding.eventId, witness.delivery.eventId]) assert.equal(text.includes(id), false, id);
    for (const id of [foundedCityId, foreignCityId]) assert.ok(text.includes(`${state.cities.find(city => city.id === id)!.name} (current name)`));
    assert.match(text, /founded with transferred residents and paid supplies/);
    assert.match(text, /Both partners paid cargo and upkeep/);
  }
  assert.ok(story.consequence.includes(ERAS[2]!.name)); assert.match(story.consequence, /calendar was unchanged/);
  assert.deepEqual(view.proof?.connection, witness);
  for (const id of [foundedCityId, sourceCityId, foreignCityId, routeId, witness.delivery.eventId]) assert.ok(event.detail.includes(id));
  assert.match(story.consequence, /not changes to every town/);
  assert.match(view.explanation, /did not advance the calendar/);
  assert.doesNotMatch(JSON.stringify([story, view.explanation]), /Navigation has founded|guaranteed|every town grew|source-to-town route/);
});

void test('recipient endpoint and another recipe retain the actual town and exact paid exchange', () => {
  const { state, foundedCityId, foreignCityId } = landIntegrationFixture({ recipient: true, seed: 1711, recipeId: 'energy-for-materials' });
  const witness = milestone(state).landIntegration!;
  assert.equal(witness.delivery.toCityId, foundedCityId);
  assert.equal(witness.delivery.fromCityId, foreignCityId);
  assert.ok(connected(state).explanation.includes(state.cities.find(city => city.id === foundedCityId)!.name));
  assert.ok(language(state).cause.includes(state.cities.find(city => city.id === foreignCityId)!.name));
});

void test('frozen journey and retained Chronicle survive pruning, stopped routes and changed populations without inventing historical names', () => {
  const { state, foundedCityId, sourceCityId, routeId } = fixture(); const event = structuredClone(milestone(state));
  const witness = state.milestoneProofs!['connected-world']!.connection!; assert.equal(witness.kind, 'land');
  const founded = state.cities.find(city => city.id === foundedCityId)!;
  founded.name = '<img src=x> New name'; founded.population = 1;
  state.cities = state.cities.filter(city => city.id !== sourceCityId);
  const route = state.routes.find(item => item.id === routeId)!; route.active = false; route.agreement!.enabled = false;
  state.events = []; state.round += 100; state.year = 1750;
  const view = connected(state); const story = language(state, event);
  assert.equal(view.status, 'recorded'); assert.deepEqual(view.proof?.connection, witness);
  for (const text of [view.explanation, story.cause]) {
    assert.match(text, /<img src=x> New name \(current name\)/);
    assert.match(text, /founded with transferred residents/); assert.match(text, /completed a paid land exchange/);
    assert.doesNotMatch(text, /with 1 residents|Navigation has founded/);
  }
  assert.match(story.consequence, /10,000 BCE.*calendar was unchanged/);
});

void test('missing current towns use a bounded honest label rather than invented historic names', () => {
  const { state, foundedCityId, foreignCityId } = fixture(); const event = structuredClone(milestone(state));
  for (const city of state.cities) city.name = 'x'.repeat(10_000);
  assert.ok(language(state, event).cause.length < 500);
  state.cities = state.cities.filter(city => city.id !== foundedCityId && city.id !== foreignCityId);
  const story = language(state, event);
  assert.match(story.cause, /The recorded founded town/);
  assert.doesNotMatch(story.cause, /current name|city-/);
  assert.equal(connected(state).status, 'recorded');
});

void test('journey proof projection deep-clones every nested land receipt and transport field', () => {
  const { state } = fixture(); const before = structuredClone(state); const proof = connected(state).proof;
  assert.ok(proof?.connection?.kind === 'land');
  proof.connection.founding.paid.food = 999;
  proof.connection.delivery.proposerPaid.food = 999;
  proof.connection.delivery.recipientPaid.materials = 999;
  proof.connection.delivery.proposerStrategicPaid.iron = 999;
  proof.connection.delivery.tradeTerms.proposerCargo.food = 999;
  proof.connection.delivery.tradeTerms.transport!.tileIds[0] = 999;
  assert.deepEqual(state, before);
});

void test('malformed or misidentified land events keep the exact fallback rather than inventing earned history', () => {
  const { state } = fixture(); const original = milestone(state);
  const variants = [
    (event: GameEvent) => { event.landIntegration!.founding.population += 1; },
    (event: GameEvent) => { event.landIntegration!.delivery.toCityId = 'city-unrelated'; },
    (event: GameEvent) => { event.landIntegration!.delivery.proposerPaid = {}; },
    (event: GameEvent) => { event.round += 1; },
    (event: GameEvent) => { event.actor = 0; },
    (event: GameEvent) => { event.effects[1] = 'Historical milestone industrial-world recorded'; },
    (event: GameEvent) => { event.effects.push('Unknown additional fact'); },
  ];
  for (const change of variants) {
    const event = structuredClone(original); change(event); event.title = 'Original malformed record';
    const row = eventLogEntries([event], { civilizations: state.civilizations })[0]!;
    assert.deepEqual(language(state, event), { title: row.title, cause: row.cause, consequence: row.summary || row.effects.slice(0, 2).join(' ') });
  }
});

void test('the original coastal branch retains its authored explanation and calendar distinction', () => {
  const state = createWorld(1701, '2026-10-24T00:00:00.000Z', 'settlement-expansion-labor-1');
  state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
  state.unlockedFeatures.push('navigation'); state.civilizations[0]!.technologies.push('navigation');
  state.eventCounts['coastal-founded'] = 1;
  state.routes = [0, 1, 2].map(index => ({ id: `route-observer-${index}`, from: state.cities[index]!.id, to: state.cities[index + 1]!.id, owner: index, partner: index + 1, active: true, damage: 0, volume: 1 }));
  const events: GameEvent[] = []; resolveHistory(state, events);
  const event = events.find(item => item.type === 'history-milestone' && item.effects[1] === 'Historical milestone connected-world recorded'); assert.ok(event);
  assert.equal(event.landIntegration, undefined);
  assert.equal(connected(state).explanation, HISTORICAL_MILESTONES.find(item => item.id === 'connected-world')!.explanation);
  assert.match(language(state, event).consequence, /calendar was unchanged/);
});

class ElementRecord {
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  textContent = ''; className = ''; open = false; type = ''; scrollTop = 0;
  dataset: Record<string, string> = {}; children: ElementRecord[] = [];
  style = { setProperty: (_name: string, _value: string): void => {} };
  append(...children: ElementRecord[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementRecord[]): void { this.children = children; }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
  querySelectorAll(selector: string): ElementRecord[] {
    assert.equal(selector, 'details[data-journey-record]');
    return this.all().filter(node => node.tag === 'details' && node.dataset['journeyRecord'] !== undefined);
  }
}

void test('existing journey renders land receipt text inertly without new controls, panels or geometry', () => {
  const { state, foundedCityId } = fixture(); state.cities.find(city => city.id === foundedCityId)!.name = '<img src=x>';
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new ElementRecord(tag) } });
  try {
    const host = new ElementRecord('div'); const before = structuredClone(state);
    renderMarsObservation(host as unknown as HTMLElement, state, 0, () => { assert.fail('No automatic town navigation'); });
    assert.match(host.content(), /<img src=x> \(current name\)/);
    assert.equal(host.all().some(node => ['img', 'svg', 'button', 'form', 'input', 'select'].includes(node.tag)), false);
    assert.equal(host.all().filter(node => node.className === 'journey-world-records').length, 1);
    assert.equal(host.all().filter(node => node.className === 'journey-milestones').length, 1);
    const record = host.all().find(node => node.dataset['journeyRecord'] === 'milestone:connected-world'); assert.ok(record);
    assert.equal(record.tag, 'details'); assert.equal(record.children[0]?.tag, 'summary'); assert.equal(record.open, false);
    const witness = milestone(state).landIntegration!;
    for (const id of [witness.founding.sourceCityId, witness.founding.foundedCityId, witness.delivery.routeId, witness.founding.eventId, witness.delivery.eventId]) assert.ok(record.content().includes(id), id);
    assert.match(record.content(), new RegExp(`Round ${witness.founding.round}`));
    assert.match(record.content(), new RegExp(`Round ${witness.delivery.round}`));
    assert.match(record.content(), /not a claim that the route is still active/);
    record.open = true; const dialog = new ElementRecord('dialog'); dialog.scrollTop = 230;
    renderMarsObservation(host as unknown as HTMLElement, state, 0, () => {}, { scrollHost: dialog as unknown as HTMLElement, scrollTop: dialog.scrollTop });
    assert.equal(host.all().find(node => node.dataset['journeyRecord'] === 'milestone:connected-world')?.open, true); assert.equal(dialog.scrollTop, 230);
    assert.deepEqual(state, before);
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
});
