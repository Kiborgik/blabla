import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { BUILDINGS, IMPROVEMENTS, WONDERS } from '../core/content.ts';
import type { ConstructionOrder, GameEvent } from '../core/types.ts';
import { civilizationSummary, constructionCommitment, ongoingCommitments, renderOngoingCommitments, installedTownEvidence, spectatorChronicle, spectatorEventDestination, spectatorActionLabel, renderRecordedPolicyChoice, renderSpectatorChronicle } from '../web/spectator-hud.ts';
import { civicBootstrapJourney } from './fixtures/civic-bootstrap-journey.ts';

const event = (round: number, type = 'research-completed'): GameEvent => ({ id: `story-${round}`, round, type, title: `Discovery ${round}`, detail: '', actor: 0, target: null, tileId: null, cause: '', effects: [], importance: 2 });

void test('the chronicle is a bounded newest-first sequence of real major events, not routine output', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  state.events = [event(1), event(2), event(3, 'settlement-production'), event(4), event(5), event(6, 'strategy-beat'), event(7, 'hold-position'), event(8, 'calm'), event(9, 'release-applied'), event(10, 'building-operation-changed'), event(11, 'improvement-operation-changed')];
  const before = structuredClone(state);
  assert.deepEqual(spectatorChronicle(state).map(story => story.event.round), [5, 4, 2]);
  assert.deepEqual(state, before);
  state.events = [event(1, 'settlement-production'), event(2, 'hold-position'), event(3, 'calm'), event(4, 'release-applied')];
  assert.deepEqual(spectatorChronicle(state), []);
});

void test('event navigation uses exact towns and routes and clearly distinguishes civilization context', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  const city = state.cities[0]; const other = state.cities[1]; const civ = state.civilizations[0];
  assert.ok(city && other && civ);
  assert.deepEqual(spectatorEventDestination(state, { ...event(1), tileId: city.tileId }), { kind: 'city', id: city.id, label: city.name });
  assert.deepEqual(spectatorEventDestination(state, event(2)), { kind: 'civilization', id: civ.id, label: civ.name });
  state.routes.push({ id: 'exact-route', from: city.id, to: other.id, owner: city.civId, partner: other.civId, active: true, damage: 0, volume: 1 });
  assert.deepEqual(spectatorEventDestination(state, { ...event(3, 'trade-delivered'), detail: 'exact-route' }), { kind: 'route', id: 'exact-route', label: `${city.name} ↔ ${other.name}` });
  assert.equal(spectatorEventDestination(state, { ...event(4), actor: null, tileId: -900 }), null);
});

void test('civilization summary uses only its own committed towns and people', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  const city = state.cities[0]; assert.ok(city);
  city.population = 12;
  assert.equal(civilizationSummary(state, city.civId), '1 town · 12 people');
  state.cities.push({ ...city, id: 'second-town', population: 4 });
  assert.equal(civilizationSummary(state, city.civId), '2 towns · 16 people');
  assert.equal(civilizationSummary(state, 90), '0 towns · 0 people');
});

void test('the HUD keeps map-first observer chrome, visible history and existing settings without world commands', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/spectator-hud.css', import.meta.url), 'utf8');
  assert.match(main, /spectatorChronicle/);
  assert.match(main, /id="major-event-list"/);
  assert.match(main, /data-open-events/);
  assert.match(main, /id="settings-open"/);
  assert.match(css, /\.live-observatory[^{]*\{[^}]*height: 100dvh/s);
  assert.match(css, /\.civilization-list[^}]*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 1000px\)/);
  assert.doesNotMatch(main, /fetch\([^)]*method:\s*['"]POST/);
  assert.match(main, /panel\.insertBefore\(commitments, resources\)/);
  assert.match(main, /record\.append\(researchSection\)/);
  assert.ok(main.indexOf('panel.insertBefore(commitments, resources)') < main.indexOf('panel.insertBefore(renderRecordedPolicyChoice(localChoice)'));
  assert.match(main, /aria-label="Civilization Earth stores"/);
  assert.doesNotMatch(main, /↗/);
  assert.match(main, /No major changes in recent history/);
});

void test('compact commitments use active canonical work and the exact selected town, not its inventory or policy intent', () => {
  const journey = civicBootstrapJourney(); const state = structuredClone(journey.selected);
  const city = state.cities.find(item => item.id === journey.cityId); assert.ok(city);
  const projection = projectCapabilities(state, journey.seat, city.id, journey.time());
  projection.decisions = { research: { kind: 'research', cityId: null, status: 'active', targetId: 'writing', progress: { done: 7.5, required: 24 }, availableIds: [], blockers: [] }, construction: [] };
  city.construction = { active: { ruleVersion: 1, id: 'real-work', cityId: city.id, buildingId: 'workshop', startedRound: 3, paid: { materials: 4 }, workDone: 2, workRequired: 6 }, lastCompleted: null };
  assert.ok(projection.governance?.government);
  projection.governance.government.pending = { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: 4, completionRound: 6, paidCredits: 10, spentCompletionEventId: null };
  const before = structuredClone({ projection, city }); const entries = ongoingCommitments(projection, city);
  assert.deepEqual(entries.map(item => item.kind), ['research', 'civic', 'construction', 'government']);
  assert.equal(entries[0]?.amount, '7.5 / 24 Science work'); assert.equal(entries[2]?.name, BUILDINGS.find(item => item.id === 'workshop')?.name); assert.equal(entries[2]?.detail, 'Not built yet.');
  assert.equal(entries[3]?.progress, null); assert.equal(entries[3]?.amount, 'Scheduled round 6'); assert.match(entries[3]?.detail ?? '', /current government still applies/);
  assert.deepEqual({ projection, city }, before);
  assert.equal(ongoingCommitments(projection, { ...city, id: 'different-town' }).some(item => item.kind === 'construction'), false);
  assert.equal(ongoingCommitments(projection, { ...city, civId: 99 }).some(item => item.kind === 'construction'), false);
  projection.decisions.research.status = 'required'; projection.governance.civics!.active = null; projection.governance.government.pending = null; city.construction.active = null;
  assert.deepEqual(ongoingCommitments(projection, city), []);
});

void test('installed town evidence excludes queued work and distinguishes buildings from exact improved tiles', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z'); const city = state.cities[0]; assert.ok(city);
  city.buildings = ['farm', 'workshop'];
  const improvement = IMPROVEMENTS[0]; assert.ok(improvement);
  city.improvements = { '7': { improvementId: improvement.id, tileId: 7, completion: { kind: 'improvement', orderId: 'finished-land', cityId: city.id, improvementId: improvement.id, tileId: 7, startedRound: 1, completedRound: 2, paid: { materials: 3 }, workRequired: 4, eventId: 'completed-land' }, operation: { enabled: false, lastResult: null } } };
  city.construction = { active: { ruleVersion: 1, id: 'unfinished', cityId: city.id, buildingId: 'launchpad', startedRound: 3, paid: {}, workRequired: 24, workDone: 23 }, lastCompleted: null };
  const before = structuredClone(city); const installed = installedTownEvidence(city);
  assert.equal(installed.length, 3); assert.equal(installed.some(item => item.name === 'Launch complex'), false);
  assert.deepEqual(installed.at(-1), { name: improvement.name, tileId: 7 }); assert.equal(installed[0]?.tileId, null); assert.deepEqual(city, before);
});

void test('the history opener has explicit contrasting frame colors independent of the page theme', () => {
  const css = readFileSync(new URL('../web/spectator-hud.css', import.meta.url), 'utf8');
  const rule = css.match(/#app #events-open\s*\{([^}]*)\}/s)?.[1]; assert.ok(rule);
  const foreground = css.match(/--hud-ink:\s*(#[a-f\d]{6})/i)?.[1]; assert.ok(foreground);
  const background = rule.match(/background:\s*(#[a-f\d]{6})/i)?.[1]; assert.ok(background);
  assert.match(rule, /color: var\(--hud-ink\)/);
  const luminance = (hex: string): number => [.2126, .7152, .0722].reduce((sum, weight, index) => {
    const channel = parseInt(hex.slice(index * 2 + 1, index * 2 + 3), 16) / 255;
    return sum + weight * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  }, 0);
  assert.ok((Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05) >= 4.5);
});

void test('construction commitments show the exact active order rather than completed assets or an invented plan', () => {
  const building = BUILDINGS[0]; const improvement = IMPROVEMENTS[0]; const wonder = WONDERS[0]; assert.ok(building && improvement && wonder);
  const common = { ruleVersion: 1 as const, id: 'order-1', cityId: 'city-1', tileId: 7, startedRound: 3, paid: { materials: 12 }, workRequired: 42, workDone: 17.5 };
  const orders: Array<[ConstructionOrder, string]> = [
    [{ ...common, buildingId: building.id }, building.name],
    [{ ...common, kind: 'improvement', improvementId: improvement.id }, improvement.name],
    [{ ...common, kind: 'wonder', wonderId: wonder.id }, wonder.name],
    [{ ...common, kind: 'rail', edgeId: '7:8', toTileId: 8, strategicPaid: { iron: 2 } }, 'Railway'],
  ];
  for (const [active, name] of orders) {
    const city = { construction: { active, lastCompleted: null } }; const before = structuredClone(city);
    assert.deepEqual(constructionCommitment(city), { name, done: 17.5, required: 42 });
    assert.deepEqual(city, before);
  }
  assert.equal(constructionCommitment(undefined), null);
  assert.equal(constructionCommitment({ construction: { active: null, lastCompleted: { orderId: 'old', cityId: 'city-1', buildingId: building.id, startedRound: 0, completedRound: 1, paid: {}, workRequired: 42, eventId: 'old-completion' } } }), null);
});

void test('recorded policy choices are labeled as concrete actions rather than invented model reasoning', () => {
  assert.equal(spectatorActionLabel({ type: 'research', technology: 'writing' }), 'Research · Writing');
  assert.equal(spectatorActionLabel({ type: 'focus', focus: 'growth' }), 'Town focus · growth');
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /renderRecordedPolicyChoice\(localChoice\)/);
  assert.match(main, /not live AI-model play/);
  assert.match(main, /localSaveBlocked/);
  assert.match(main, /localWorldStorage\.save\(\(\) => localSimulation\)/);
  assert.match(main, /if \(!localWasObserved \|\| localSaveBlocked \|\| localEphemeral\) return/);
  assert.match(main, /navigator\.locks\.request/);
  assert.match(main, /mode !== 'local' \|\| document\.hidden/);
});

void test('an unrelated receipt cannot supply an exact event location', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  const city = state.cities[1]; const civ = state.civilizations[0]; assert.ok(city && civ);
  const source = { ...event(1), populationGrowth: { ruleVersion: 1 as const, cityId: city.id, civId: city.civId, round: 1, eventId: 'other-event', populationBefore: 8, populationAfter: 9, capacity: 10, foodPaid: 20 } };
  assert.deepEqual(spectatorEventDestination(state, source), { kind: 'civilization', id: civ.id, label: civ.name });
});

void test('chronicle rendering keeps event text inert and its location action observer-only', () => {
  class ElementRecord {
    tag: string;
    textContent = '';
    className = '';
    max = 0;
    value = 0;
    dataset: Record<string, string> = {};
    children: ElementRecord[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    constructor(tag: string) { this.tag = tag; }
    set innerHTML(_value: string) { throw new Error('Event text must never become HTML'); }
    append(...children: ElementRecord[]): void { this.children.push(...children); }
    replaceChildren(...children: ElementRecord[]): void { this.children = children; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
    contains(): boolean { return false; }
    focus(): void { return; }
    all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const originals = new Map(['document', 'HTMLElement', 'HTMLButtonElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null, createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_ns: string, tag: string) => new ElementRecord(tag) } });
  try {
    const state = createWorld(1701, '2026-10-16T00:00:00Z');
    state.events = [{ ...event(1), title: '<img src=x onerror=alert(1)>' }];
    const host = new ElementRecord('ol'); let destination = '';
    renderSpectatorChronicle(host as unknown as HTMLElement, spectatorChronicle(state), target => { destination = target.kind; });
    const button = host.all().find(node => node.tag === 'button'); assert.ok(button);
    assert.ok(host.all().some(node => node.textContent === '<img src=x onerror=alert(1)>'));
    assert.match(button.attributes.get('aria-label') ?? '', /Inspect civilization/);
    button.listeners.get('click')?.(); assert.equal(destination, 'civilization');
    assert.equal(host.all().some(node => node.tag === 'img'), false);
    const choice = renderRecordedPolicyChoice({ action: { type: 'wait' }, reason: '<img src=x> Actual recorded reason' }) as unknown as ElementRecord;
    assert.equal(choice.tag, 'details');
    assert.equal(choice.children[0]?.tag, 'summary');
    assert.equal(choice.children[0]?.textContent, 'Last choice: Wait');
    assert.equal(choice.attributes.has('open'), false);
    assert.equal(choice.dataset['townDisclosure'], 'policy-choice');
    assert.equal(choice.dataset['inspectionSection'], 'overview');
    assert.ok(choice.all().some(node => node.textContent === 'BUILT-IN POLICY · LAST CHOICE'));
    assert.ok(choice.all().some(node => node.textContent === '<img src=x> Actual recorded reason'));
    assert.equal(choice.all().some(node => node.tag === 'img' || node.tag === 'button'), false);
    assert.equal(renderOngoingCommitments([]), null);
    const work = renderOngoingCommitments([
      { kind: 'research', name: '<b>Writing</b>', amount: '7.5 / 24 Science work', detail: 'Produced Science, not inventory.', progress: { done: 7.5, required: 24 } },
      { kind: 'government', name: 'Chiefdom', amount: 'Scheduled round 6', detail: 'Current government still applies.', progress: null },
    ]) as unknown as ElementRecord;
    const meters = work.all().filter(node => node.tag === 'progress'); assert.equal(meters.length, 1); assert.equal(meters[0]?.max, 24); assert.equal(meters[0]?.value, 7.5);
    assert.equal(work.attributes.get('aria-label'), 'Ongoing commitments'); assert.equal(work.dataset['inspectionSection'], 'overview');
    assert.match(meters[0]?.attributes.get('aria-label') ?? '', /7.5 \/ 24 Science work/);
    assert.equal(work.all().some(node => ['button', 'form', 'input', 'b'].includes(node.tag)), false);
    assert.ok(work.all().some(node => node.textContent === '<b>Writing</b>'));
  } finally {
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
