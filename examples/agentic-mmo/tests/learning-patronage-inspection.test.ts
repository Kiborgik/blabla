import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import { BUILDINGS, CIVICS } from '../core/content.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import type { BuildingOperationResult, City, GameEvent, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { commitEvents, emitEvent } from '../core/simulation/events.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';
import { civicProgressPresentation } from '../web/civic-progress.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { storyLanguage } from '../web/story-language.ts';
import { spectatorChronicle } from '../web/spectator-hud.ts';
import { exactNumber } from '../web/number-format.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const release = 'settlement-learning-patronage-1';

function preparedWorld(): WorldState {
  const state = createWorld(1701, epoch, release);
  const actor = state.civilizations[0]!; const city = state.cities[0]!;
  actor.resources = { food: 100, materials: 80, credits: 80, energy: 30, culture: 30, science: 0 };
  actor.era = 2; city.population = 16; city.wellbeing = 53; city.damage = 7;
  syntheticTechnologies(state, actor.id, ['education', 'civic-institutions']);
  for (const id of ['campus', 'academy', 'library', 'university']) syntheticInstitution(state, city.id, id);
  state.revision++;
  const events: GameEvent[] = [];
  const completion = emitEvent(state, events, { type: 'civic-completed', title: 'Synthetic civic prerequisites', detail: 'Controlled fixture preparation, not natural progression', actor: actor.id, target: actor.id, tileId: null, cause: 'Explicit synthetic setup', effects: ['Completed civic political-philosophy'], importance: 1 });
  commitEvents(state, events);
  actor.civics = { ruleVersion: 1, completedCivicIds: CIVICS.map(civic => civic.id), active: null,
    lastCompleted: { civicId: 'political-philosophy', completedRound: 0, eventId: completion.id }, reformEntitlement: { civicId: 'political-philosophy', completedRound: 0, completionEventId: completion.id } };
  assert.ok(isWorldState(state), 'Synthetic prerequisite world must validate before the actual engine acts');
  return state;
}

function choose(state: WorldState, policyId: string, governmentId = 'chiefdom'): WorldState {
  const time = new Date(Date.parse(epoch) + state.round * 60_000 + 20_000).toISOString();
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time,
    action: { type: 'adopt-government', governmentId, assignments: [{ slotType: 'economic', slotIndex: 0, policyId }] } });
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}

function beat(state: WorldState): WorldState {
  const result = catchUpStrategy(state, new Date(Date.parse(epoch) + (state.round + 1) * 60_000).toISOString());
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}

function language(state: WorldState, event: GameEvent) {
  const fallback = eventLogEntries([event], { civilizations: state.civilizations })[0]!;
  const before = structuredClone({ state, event });
  const result = storyLanguage(state, event, fallback);
  assert.deepEqual({ state, event }, before); return result;
}

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  value = '';
  focused = false;
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
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function withDocument<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement);
    else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
}

function inspect(city: City, buildingId = 'library'): ElementRecord {
  return withDocument(() => {
    const host = new ElementRecord('section');
    renderSettlementInspection(host as unknown as HTMLElement, [city], city.id, () => undefined, undefined, buildingId);
    return host;
  });
}

function civicView(state: WorldState) {
  const city = state.cities[0]!;
  return civicProgressPresentation({ catalogue: capabilityCatalogue(), projection: projectCapabilities(state, 0, city.id, new Date(Date.parse(epoch) + state.round * 60_000 + 20_000).toISOString()), city, events: state.events });
}

await test('exact earned policy contribution is detached and remains a historical record when paused now', () => {
  const city: City = { id: 'synthetic-ui-town', name: 'Prepared town', civId: 0, tileId: 0, population: 16, wellbeing: 53, infrastructure: 0, focus: 'research', damage: 7, buildings: ['library'], buildingOperations: {} };
  const result: BuildingOperationResult = { round: 7, status: 'operated', paid: { credits: 1 }, produced: { science: 4.13 }, shortages: [],
    residents: { ruleVersion: 1, openingPopulation: 16, communityReserve: 3, required: 3, available: 6, allocated: 3 },
    policyContribution: { policyId: 'learning-patronage', percent: 25, unboostedScience: 3.3, bonusScience: 0.83 } };
  city.buildingOperations!.library = { enabled: false, lastResult: result };
  const view = operationVisual(city.buildingOperations!.library);
  assert.deepEqual(view.last?.policyContribution, result.policyContribution);
  assert.notEqual(view.last?.policyContribution, result.policyContribution);
  const before = structuredClone(city); const rendered = inspect(city).content();
  assert.match(rendered, /Built · Paused now/); assert.match(rendered, /Last recorded season · 7/);
  assert.match(rendered, /Made: 4.13 Science/); assert.match(rendered, /Learning patronage: \+0.83 Science.*25%.*3.3 before policy/);
  assert.match(rendered, /Included in Made/); assert.match(rendered, /Paid: 1 Credits/);
  assert.deepEqual(city, before);
});

await test('current source engine pays all three institutions and UI preserves their exact receipts without mutation', () => {
  const state = beat(choose(preparedWorld(), 'learning-patronage'));
  const city = state.cities[0]!; const before = structuredClone(state); const projected = projectWorld(state);
  for (const id of ['academy', 'library', 'university']) {
    const result = city.buildingOperations![id]!.lastResult!; const contribution = result.policyContribution;
    assert.equal(result.status, 'operated'); assert.ok(contribution); assert.equal(contribution.percent, 25);
    assert.deepEqual(result.paid, BUILDINGS.find(building => building.id === id)!.operatingInputs);
    const rendered = inspect(city, id).content();
    assert.ok(rendered.includes(`Made: ${exactNumber(result.produced.science!)} Science`));
    assert.ok(rendered.includes(`Learning patronage: +${exactNumber(contribution.bonusScience)} Science`));
    assert.ok(rendered.includes(`${exactNumber(contribution.unboostedScience)} before policy`));
    const atlas = projected.cities.find(town => town.cityId === city.id)!;
    assert.deepEqual(atlas.settlement!.buildingOperations![id]!.lastResult!.policyContribution, contribution);
    assert.notEqual(atlas.settlement!.buildingOperations![id]!.lastResult!.policyContribution, contribution);
    const event = state.events.findLast(event => event.type === 'building-operation' && event.detail === `${city.id}/${id} at strategic round ${result.round}`)!;
    assert.ok(event.effects.includes(`Learning patronage: +${contribution.bonusScience} science from ${contribution.unboostedScience} at ${contribution.percent}%`));
    assert.equal(eventLogEntries([event], { civilizations: state.civilizations })[0]!.routine, true);
    assert.ok(!spectatorChronicle(state).some(story => story.event.id === event.id));
  }
  assert.deepEqual(state, before);
});

await test('paused blocked and missing operation records never invent patronage output', () => {
  for (const mode of ['paused', 'unpaid', 'unstaffed', 'absent'] as const) {
    let state = choose(preparedWorld(), 'learning-patronage'); const actor = state.civilizations[0]!; const city = state.cities[0]!;
    if (mode === 'paused') city.buildingOperations!.library!.enabled = false;
    if (mode === 'unpaid') actor.resources.credits = 0;
    if (mode === 'unstaffed') city.population = 3;
    if (mode !== 'absent') state = beat(state);
    const current = state.cities[0]!; const result = current.buildingOperations!.library!.lastResult;
    assert.equal(result?.policyContribution, undefined);
    const rendered = inspect(current).content(); assert.doesNotMatch(rendered, /Learning patronage:|before policy|Included in Made/);
    if (mode === 'absent') assert.match(rendered, /No operating result recorded yet/);
    else { assert.deepEqual(result?.paid, {}); assert.deepEqual(result?.produced, {}); assert.match(rendered, /Made: None/); }
  }
  const beforePolicy = beat(preparedWorld()); const chosenAfter = choose(beforePolicy, 'learning-patronage');
  assert.equal(chosenAfter.cities[0]!.buildingOperations!.library!.lastResult?.policyContribution, undefined);
  assert.doesNotMatch(inspect(chosenAfter.cities[0]!).content(), /Learning patronage:/);
  assert.deepEqual(operationVisual(undefined), { current: 'Unknown', summary: 'No operating record', tone: 'neutral', last: null });
});

await test('arrangement Chronicle explains the selected tradeoff without claiming earned Science or reusing current motives', () => {
  let state = choose(preparedWorld(), 'learning-patronage');
  const event = state.events.findLast(event => event.type === 'arrangement-accepted')!; const original = language(state, event);
  assert.match(original.consequence, /Economic priority: paid, staffed learning instead of Urban planning/);
  assert.doesNotMatch(JSON.stringify(original), /earned|made|produced|Science \+/);
  const selected = spectatorChronicle(state).find(story => story.event.id === event.id); assert.deepEqual(selected?.display, original);
  for (let index = 0; index < 4; index++) state = beat(state);
  const retained = structuredClone(state.cities[0]!.buildingOperations!.library!.lastResult!);
  state = choose(state, 'urban-planning');
  assert.deepEqual(language(state, event), original);
  assert.deepEqual(state.cities[0]!.buildingOperations!.library!.lastResult, retained);
  assert.match(inspect(state.cities[0]!).content(), /Learning patronage:/);
  const urban = state.events.findLast(event => event.type === 'arrangement-accepted')!;
  assert.match(language(state, urban).consequence, /Economic priority: faster construction/);
  state = beat(state);
  assert.equal(state.cities[0]!.buildingOperations!.library!.lastResult?.policyContribution, undefined);
  assert.doesNotMatch(inspect(state.cities[0]!).content(), /Learning patronage:/);
});

await test('current government effects are conditional and pending learning never applies early', () => {
  let state = choose(preparedWorld(), 'urban-planning');
  for (let index = 0; index < 4; index++) state = beat(state);
  state = choose(state, 'learning-patronage', 'autocracy');
  const pending = civicView(state); assert.ok(pending);
  assert.doesNotMatch(pending.effects.join(' '), /25%|Library|University/);
  assert.match(pending.government.pending.join(' '), /Learning patronage/);
  assert.match(pending.government.choiceExplanation, /cannot be combined.*wildcard/);
  const event = state.events.findLast(event => event.type === 'arrangement-accepted')!;
  assert.match(language(state, event).consequence, /not finished yet/);
  state = beat(beat(state)); const active = civicView(state); assert.ok(active);
  assert.match(active.effects.join(' '), /25% Science.*fully funded.*staffed.*Library.*House of learning.*University.*only/);
  assert.match(active.effectExplanation, /not credited work or goods/);
});

await test('unknown and impossible across-slot historical arrangements retain bounded fallback', () => {
  const state = choose(preparedWorld(), 'learning-patronage', 'autocracy');
  const event = state.events.findLast(event => event.type === 'arrangement-accepted')!;
  for (const detail of ['economic:0 future-policy', 'economic:99 learning-patronage', 'economic:0 learning-patronage, wildcard:0 urban-planning']) {
    const unknown = { ...event, detail }; const result = language(state, unknown);
    assert.doesNotMatch(result.consequence, /Economic priority:|Policies:/);
    assert.ok(result.consequence.length <= 180);
  }
});
