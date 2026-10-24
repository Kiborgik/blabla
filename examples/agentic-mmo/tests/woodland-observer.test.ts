import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { isWoodlandState } from '../core/woodland-validation.ts';
import type { WoodlandImprovementId } from '../core/woodland-types.ts';
import { projectWorld } from '../web/live-world.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';
import { improvementParts } from '../visuals/improvement-visuals.ts';
import { projectLandscape } from '../visuals/landscape.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
type Fixture = ReturnType<typeof journey>;

function journey(improvementId: WoodlandImprovementId) {
  const initial = createGeneratedWorld(1701, epoch, 'settlement-renewing-worked-woodlands-1');
  const pair = initial.cities.flatMap(city => initial.tiles.filter(tile => tile.terrain === 'forest'
    && !initial.cities.some(other => other.tileId === tile.id) && hexDistance(tile, initial.tiles[city.tileId]!) <= 3).map(tile => ({ city, tile })))[0];
  assert.ok(pair, 'Synthetic prerequisites reuse the existing generated forest; no terrain rewrite or natural-choice claim');
  const { id: cityId, civId } = pair.city; const tileId = pair.tile.id;
  pair.tile.owner = civId;
  syntheticTechnologies(initial, civId, [improvementId === 'charcoal-clearing' ? 'kiln-firing' : 'machinery']);
  if (improvementId === 'lumber-mill') initial.civilizations.find(actor => actor.id === civId)!.era = 1;
  Object.assign(pair.city, { population: 4, focus: 'research', wellbeing: 50, damage: 0 });
  Object.assign(initial.civilizations.find(actor => actor.id === civId)!.resources, { food: 200, materials: 100, credits: 100 });
  assert.ok(isWorldState(initial), 'Explicit synthetic legal ownership, technologies, Lumber era 1, population and opening stock');
  const inputs: unknown[] = [];
  const act = (state: WorldState, action: GameAction): WorldState => {
    const command = { seat: civId, expectedRevision: state.revision, timestamp: at((state.independentTurns?.strategyTicks ?? 0) * 60 + 20), action };
    const result = applyCommand(state, command); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
    inputs.push({ kind: 'command', command, beforeRevision: state.revision, afterRevision: result.state.revision });
    return result.state;
  };
  const beat = (state: WorldState): WorldState => {
    const timestamp = at(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const result = catchUpStrategy(state, timestamp); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
    inputs.push({ kind: 'strategy', timestamp, beforeRevision: state.revision, afterRevision: result.state.revision });
    return result.state;
  };
  const installed = (state: WorldState) => state.cities.find(city => city.id === cityId)!.improvements?.[String(tileId)];
  const building = act(initial, { type: 'improve', cityId, tileId, improvementId });
  let full = building;
  for (let index = 0; index < 12 && !installed(full); index++) full = beat(full);
  assert.ok(installed(full), 'The actual paid construction completes within the finite fixture');
  assert.equal(installed(full)!.operation.lastResult, null);
  let depleted = full; const harvests: WorldState[] = [];
  for (let index = 0; index < 8; index++) { depleted = beat(depleted); harvests.push(depleted); }
  const paid = harvests[0]!;
  const recovering = beat(depleted);
  const pausedChoice = act(paid, { type: 'set-improvement-operation', cityId, tileId, improvementId, enabled: false });
  const paused = beat(pausedChoice);
  const residentOpening = structuredClone(paid);
  residentOpening.cities.find(city => city.id === cityId)!.population = 3;
  assert.ok(isWorldState(residentOpening), 'Synthetic resident-shortage branch changes only current population before an actual beat');
  const resident = beat(residentOpening);
  const inputOpening = structuredClone(paid);
  inputOpening.civilizations.find(actor => actor.id === civId)!.resources.materials = 0;
  assert.ok(isWorldState(inputOpening), 'Synthetic input-shortage branch changes only opening Materials before an actual beat');
  const input = improvementId === 'charcoal-clearing' ? beat(inputOpening) : null;
  return { improvementId, cityId, civId, tileId, initial, building, full, paid, harvests, depleted, recovering, pausedChoice, paused, residentOpening, resident, inputOpening, input, inputs };
}

const fixtures = new Map<WoodlandImprovementId, Fixture>();
function fixture(id: WoodlandImprovementId): Fixture {
  let value = fixtures.get(id); if (!value) { value = journey(id); fixtures.set(id, value); } return value;
}
const site = (state: WorldState, value: Fixture) => {
  const found = projectWorld(state).improvements!.find(view => view.cityId === value.cityId && view.tileId === value.tileId);
  assert.ok(found); return found;
};
const result = (state: WorldState, value: Fixture) => {
  const receipt = site(state, value).operation?.lastResult; assert.ok(receipt); return receipt;
};
const activeParts = (state: WorldState, value: Fixture) => improvementParts(site(state, value), 'close').filter(part => /recorded-(smoke|heat)/u.test(part.id));
const architecture = (state: WorldState, value: Fixture) => improvementParts(site(state, value), 'close').filter(part => !/recorded-(smoke|heat)/u.test(part.id));
const forestParts = (state: WorldState, value: Fixture) => {
  const world = projectWorld(state); const view = site(state, value);
  return projectLandscape(world.tiles.filter(tile => tile.id === value.tileId), [view], 'close').parts.filter(part => !part.id.startsWith('ground:'));
};

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  value = '';
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  attributes = new Map<string, string>();
  constructor(tag: string) { this.tag = tag; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { for (const child of [...children].reverse()) { child.remove(); child.parent = this; this.children.unshift(child); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  replaceChildren(...children: ElementRecord[]): void { for (const child of [...this.children]) child.remove(); this.append(...children); }
  querySelector(selector: string): ElementRecord | null { return this.all().find(node => node.tag === selector) ?? null; }
  focus(): void {}
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(): void {}
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].filter(Boolean).join(' ').replace(/\s+/gu, ' ').trim(); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function inspect(state: WorldState, value: Fixture): ElementRecord {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const elementDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const createElement = (tag: string) => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (text: string) => { const node = createElement('#text'); node.textContent = text; return node; } } });
  try {
    const host = new ElementRecord('section');
    renderSettlementInspection(host as unknown as HTMLElement, state.cities, value.cityId, () => undefined, undefined, String(value.tileId), undefined, undefined, undefined, undefined, undefined, undefined, projectWorld(state).improvements);
    return host;
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
    if (elementDescriptor) Object.defineProperty(globalThis, 'HTMLElement', elementDescriptor); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
}

for (const id of ['lumber-mill', 'charcoal-clearing'] as const) {
  void test(`${id}: actual completion preserves eight work-lots without invented production`, () => {
    const value = fixture(id); const view = site(value.full, value); const before = structuredClone(value.full);
    assert.deepEqual(view.completion?.paid, id === 'charcoal-clearing' ? { materials: 8, credits: 4 } : { materials: 10, credits: 5 });
    assert.equal(view.woodland?.stock, 8); assert.equal(view.woodland?.lastHarvestRound, null);
    assert.equal(view.woodland?.recovered, 0); assert.equal(view.woodland?.productive, false); assert.equal(view.woodland?.eligible, true);
    assert.equal(activeParts(value.full, value).length, 0);
    const dom = inspect(value.full, value).content();
    assert.match(dom, /Woodland work-lots: 8 \/ 8\. Last harvest: none/);
    assert.match(dom, /Next-opening forecast:.*not recorded output/);
    assert.match(dom, /No operating result has been recorded yet/);
    assert.deepEqual(value.full, before);
  });

  void test(`${id}: actual harvest depletes exactly eight local lots and current receipts reach the inspector`, () => {
    const value = fixture(id);
    for (const [index, state] of value.harvests.entries()) {
      const receipt = result(state, value); const view = site(state, value);
      assert.equal(receipt.status, 'operated'); assert.equal(receipt.residents.allocated, 1);
      assert.deepEqual(receipt.paid, id === 'charcoal-clearing' ? { materials: 1 } : {});
      assert.deepEqual(receipt.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: value.tileId, required: 1, opening: 8 - index, harvested: 1, recovered: 0, closing: 7 - index });
      assert.equal(view.woodland?.stock, 7 - index); assert.equal(view.woodland?.productive, true);
      assert.equal(state.tiles[value.tileId]!.terrain, 'forest');
      assert.ok(isWoodlandState(state.woodlands, state));
    }
    assert.equal(site(value.depleted, value).woodland?.eligible, false);
    assert.match(site(value.depleted, value).woodland!.reason!, /No opening woodland work-lot/);
    const dom = inspect(value.depleted, value).content();
    assert.match(dom, /Woodland work-lots: 0 \/ 8/);
    assert.match(dom, /1 opening − 1 harvested \+ 0 recovered = 0 closing work-lots/);
    assert.match(dom, /Assigned: 1 resident/);
    assert.match(dom, id === 'charcoal-clearing' ? /Paid that season: 1 Materials/ : /Paid that season: None/);
    assert.match(dom, id === 'charcoal-clearing' ? /Made: [\d.]+ Energy/ : /Made: [\d.]+ Materials/);
    assert.deepEqual(architecture(value.depleted, value), architecture(value.full, value));
    const full = forestParts(value.full, value); const depleted = forestParts(value.depleted, value);
    assert.ok(depleted.some(part => part.id.includes(':stump:')));
    assert.ok(depleted.filter(part => part.shape === 'canopy').length < full.filter(part => part.shape === 'canopy').length);
    if (id === 'charcoal-clearing') assert.equal(activeParts(value.paid, value).length, 2);
  });

  void test(`${id}: actual empty-stock rest recovers one lot without input debit, staffing or output`, () => {
    const value = fixture(id); const receipt = result(value.recovering, value); const view = site(value.recovering, value);
    assert.equal(receipt.status, 'blocked'); assert.equal(receipt.blockedReason, 'woodland-shortage');
    assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents.allocated, 0);
    assert.deepEqual(receipt.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: value.tileId, required: 1, opening: 0, harvested: 0, recovered: 1, closing: 1 });
    assert.equal(view.woodland?.stock, 1); assert.equal(view.woodland?.recovered, 1); assert.equal(view.woodland?.productive, false);
    assert.equal(view.woodland?.lastHarvestRound, value.depleted.round); assert.equal(view.woodland?.eligible, true);
    assert.equal(activeParts(value.recovering, value).length, 0);
    assert.deepEqual(architecture(value.recovering, value), architecture(value.full, value));
    assert.ok(forestParts(value.recovering, value).some(part => part.id.includes(':sapling:')));
    const dom = inspect(value.recovering, value).content();
    assert.match(dom, /0 opening − 0 harvested \+ 1 recovered = 1 closing work-lots/);
    assert.match(dom, /Woodland needs a resting season/); assert.match(dom, /Paid that season: None/); assert.match(dom, /Made: None/);
    assert.match(dom, /recovery is not produced Materials or Energy/);
  });

  void test(`${id}: pause and synthetic resident shortage retain architecture and separate history from readiness`, () => {
    const value = fixture(id);
    assert.equal(result(value.pausedChoice, value).status, 'operated');
    assert.equal(site(value.pausedChoice, value).woodland?.productive, false);
    assert.match(inspect(value.pausedChoice, value).content(), /Built · Paused now/);
    for (const [state, status, reason] of [[value.paused, 'paused', null], [value.resident, 'blocked', 'resident-shortage']] as const) {
      const receipt = result(state, value);
      assert.equal(receipt.status, status); assert.equal(receipt.blockedReason, reason);
      assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents.allocated, 0);
      assert.deepEqual(receipt.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: value.tileId, required: 1, opening: 7, harvested: 0, recovered: 1, closing: 8 });
      assert.equal(site(state, value).woodland?.productive, false); assert.equal(activeParts(state, value).length, 0);
      assert.deepEqual(architecture(state, value), architecture(value.full, value));
      assert.match(inspect(state, value).content(), /7 opening − 0 harvested \+ 1 recovered = 8 closing work-lots/);
    }
    assert.equal(site(value.residentOpening, value).woodland?.eligible, false);
    assert.match(site(value.residentOpening, value).woodland!.reason!, /No remaining local resident/);
  });

  void test(`${id}: explicit stale, terminal, missing and invalid observer sources never invent active work`, () => {
    const value = fixture(id);
    const stale = structuredClone(value.paid); stale.round++;
    const terminal = structuredClone(value.paid); terminal.outcome = { kind: 'economic', winners: [value.civId], round: terminal.round, reason: 'Explicit observer-only terminal fixture, not an earned outcome' };
    const missing = structuredClone(value.paid); delete missing.woodlands;
    const invalid = structuredClone(value.paid); invalid.woodlands!.stands[String(value.tileId)]!.stock = 9;
    for (const state of [stale, terminal, missing, invalid]) {
      const before = structuredClone(state); const view = site(state, value);
      assert.notEqual(view.woodland?.productive, true); assert.equal(activeParts(state, value).length, 0);
      assert.deepEqual(architecture(state, value), architecture(value.full, value));
      assert.equal(view.status, 'built'); assert.deepEqual(view.completion, site(value.paid, value).completion);
      assert.ok(!forestParts(state, value).some(part => part.id.includes(':sapling:')));
      const dom = inspect(state, value).content();
      assert.match(dom, /Last record · Round/); assert.match(dom, /8 opening − 1 harvested \+ 0 recovered = 7 closing work-lots/);
      if (state === terminal) assert.match(dom, /world has ended; no future operation is scheduled/);
      else { assert.equal(view.woodland, null); assert.doesNotMatch(dom, /Woodland work-lots:|Next-opening forecast:/); }
      assert.deepEqual(state, before);
    }
  });
}

void test('Charcoal synthetic empty opening Materials lead to actual input refusal, not harvest or smoke', () => {
  const value = fixture('charcoal-clearing'); assert.ok(value.input);
  const receipt = result(value.input, value);
  assert.equal(receipt.status, 'blocked'); assert.equal(receipt.blockedReason, 'input-shortage');
  assert.deepEqual(receipt.shortages, [{ resource: 'materials', required: 1, available: 0 }]);
  assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents.allocated, 0);
  assert.deepEqual(receipt.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: value.tileId, required: 1, opening: 7, harvested: 0, recovered: 1, closing: 8 });
  assert.equal(site(value.inputOpening, value).woodland?.eligible, false);
  assert.match(site(value.inputOpening, value).woodland!.reason!, /Complete opening operating inputs are unavailable/);
  assert.equal(site(value.input, value).woodland?.productive, false); assert.equal(activeParts(value.input, value).length, 0);
  const dom = inspect(value.input, value).content();
  assert.match(dom, /Not enough Materials/); assert.match(dom, /Materials needed 1 · Available then 0/);
  assert.match(dom, /Paid that season: None/); assert.match(dom, /Made: None/);
});

void test('paid zero-output: synthetic productivity loss still spends each whole recipe and lot without an active cue', () => {
  for (const id of ['lumber-mill', 'charcoal-clearing'] as const) {
    const value = fixture(id); const opening = structuredClone(value.full);
    opening.cities.find(city => city.id === value.cityId)!.damage = 100;
    assert.ok(isWorldState(opening), 'Synthetic damage100 branch isolates zero productivity, not a naturally earned disaster');
    const before = structuredClone(opening);
    const transition = catchUpStrategy(opening, at(((opening.independentTurns?.strategyTicks ?? 0) + 1) * 60));
    assert.ok(transition.ok, transition.error); assert.ok(isWorldState(transition.state)); assert.deepEqual(opening, before);
    const state = transition.state; const receipt = result(state, value);
    assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.produced, {});
    assert.deepEqual(receipt.paid, id === 'charcoal-clearing' ? { materials: 1 } : {});
    assert.equal(receipt.residents.allocated, 1);
    assert.deepEqual(receipt.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: value.tileId, required: 1, opening: 8, harvested: 1, recovered: 0, closing: 7 });
    assert.equal(site(state, value).woodland?.productive, false); assert.equal(activeParts(state, value).length, 0);
    assert.deepEqual(architecture(state, value), architecture(value.full, value));
    const dom = inspect(state, value).content();
    assert.match(dom, /Worked with no output/); assert.match(dom, /Made: None/); assert.match(dom, /Assigned: 1 resident/);
    assert.match(dom, /8 opening − 1 harvested \+ 0 recovered = 7 closing work-lots/);
    assert.match(dom, id === 'charcoal-clearing' ? /Paid that season: 1 Materials/ : /Paid that season: None/);
  }
});
