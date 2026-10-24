import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { PUBLIC_PROJECT_RECIPES, TRADE_RECIPES } from '../core/content.ts';
import type { GameEvent, PublicProjectResult } from '../core/types.ts';
import { eventLogEntries, recordedPublicProjectResult, renderEventLog } from '../web/event-log.ts';
import { spectatorChronicle, spectatorEventDestination, developingTowns, renderDevelopingTowns, renderSpectatorChronicle } from '../web/spectator-hud.ts';

const epoch = '2026-10-16T00:00:00Z';
const event = (patch: Partial<GameEvent> = {}): GameEvent => ({ id: '1:0', round: 1, type: 'trade-proposed', title: 'Recorded trade offer', detail: 'offer-1', actor: 0, target: 1, tileId: null, cause: 'The recorded policy chose an exact partner', effects: [], importance: 3, ...patch });
const result = (patch: Partial<PublicProjectResult> = {}): PublicProjectResult => ({ projectId: 'project-1', routeId: 'route-1', agreementOfferId: 'offer-1', outcome: 'completed', reason: 'Both complete contributions paid after ordinary production, upkeep and trade', proposer: 0, recipient: 1, proposerPaid: { materials: 1.125, credits: 2.5 }, recipientPaid: { energy: 3.75 }, damageBefore: 42.75, damageAfter: 12.25, ...patch });
const finalEvent = (receipt: PublicProjectResult): GameEvent => event({ id: '4:0', round: 4, type: `public-project-${receipt.outcome}`, detail: receipt.projectId, publicProjectResult: receipt });

function world() {
  const state = createWorld(1701, epoch);
  const from = state.cities[0]; const to = state.cities[1]; const recipe = TRADE_RECIPES[0]; const repair = PUBLIC_PROJECT_RECIPES[0];
  assert.ok(from && to && recipe && repair);
  state.routes = [{ id: 'route-1', from: from.id, to: to.id, owner: 0, partner: 1, active: true, damage: 0, volume: 999,
    agreement: { offerId: 'offer-1', terms: structuredClone(recipe.terms), enabled: true, acceptedRound: 2, nextDeliveryRound: 5, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } }];
  state.publicProjects = [{ id: 'project-1', routeId: 'route-1', agreementOfferId: 'offer-1', proposer: 0, recipient: 1, terms: structuredClone(repair.terms), proposedRound: 1, status: 'pending', expiresRound: 5 }];
  state.events = [];
  return state;
}

void test('partnership phases separate consent delivery blocked trade and exact joint repair payment', () => {
  const state = world(); const options = { civilizations: state.civilizations };
  const records = [event(), event({ type: 'trade-accepted' }), event({ type: 'public-project-proposed' }), event({ type: 'public-project-committed' }), event({ type: 'trade-delivered', effects: ['7.125 cargo exchanged atomically'] }), event({ type: 'trade-blocked', cause: 'Both transport obligations were not supplied' }), finalEvent(result())];
  const rows = records.map(record => eventLogEntries([record], options)[0]);
  assert.match(rows[0]?.summary ?? '', /No cargo was delivered/);
  assert.match(rows[1]?.summary ?? '', /No cargo was delivered/);
  assert.match(rows[2]?.summary ?? '', /No stock paid, damage repaired or cargo delivered/);
  assert.match(rows[3]?.summary ?? '', /No stock paid yet/);
  assert.match(rows[4]?.summary ?? '', /7\.125 cargo exchanged atomically/);
  assert.match(rows[5]?.summary ?? '', /No cargo delivered.*No partial/);
  assert.equal(rows[5]?.cause, 'Both transport obligations were not supplied');
  assert.match(rows[6]?.summary ?? '', /42\.75 → 12\.25/);
  assert.match(rows[6]?.summary ?? '', /1\.125 Materials/); assert.match(rows[6]?.summary ?? '', /2\.5 Credits/); assert.match(rows[6]?.summary ?? '', /3\.75 Energy/);
  assert.match(rows[6]?.summary ?? '', /No shipment created/);
  assert.equal(rows[6]?.deltas[0]?.value, -30.5);
});

void test('canonical public-project result overrides stale display effects and does not infer success from current route state', () => {
  const state = world(); const before = structuredClone(state);
  for (const outcome of ['failed', 'no-work-needed', 'declined', 'cancelled', 'expired'] as const) {
    const receipt = result({ outcome, reason: `Recorded ${outcome}`, proposerPaid: {}, recipientPaid: {}, damageBefore: 0, damageAfter: 0 });
    const record = { ...finalEvent(receipt), cause: 'Not the canonical result reason', effects: ['Route damage 99 → 0', 'Proposer paid: materials 999'] };
    const [row] = eventLogEntries([record], { civilizations: state.civilizations }); assert.ok(row);
    assert.equal(row.cause, `Recorded ${outcome}`); assert.equal(row.deltas[0]?.value, 0);
    assert.match(row.summary, /Recorded damage 0 → 0/); assert.match(row.summary, /paid None/); assert.doesNotMatch(row.summary, /999|99|completed/);
    assert.deepEqual(row.receiptDetails, [row.summary, receipt.reason]);
    assert.equal(spectatorEventDestination(state, record)?.kind, 'route');
  }
  assert.deepEqual(state, before);
  const missing = finalEvent(result({ outcome: 'failed', proposerPaid: {}, recipientPaid: {}, damageBefore: null, damageAfter: null }));
  assert.match(eventLogEntries([missing], { civilizations: state.civilizations })[0]?.summary ?? '', /damage unavailable/);
  assert.equal(recordedPublicProjectResult({ ...missing, detail: 'wrong-project' }), null);
  assert.equal(recordedPublicProjectResult({ ...missing, type: 'public-project-completed' }), null);
});

void test('project navigation follows exact project or retained final receipt bindings and never a nearby town', () => {
  const state = world(); const proposal = event({ type: 'public-project-proposed', detail: 'project-1' });
  assert.deepEqual(spectatorEventDestination(state, proposal), { kind: 'route', id: 'route-1', label: `${state.cities[0]?.name} ↔ ${state.cities[1]?.name}` });
  const committed = { ...proposal, type: 'public-project-committed', actor: 1, target: 0 };
  assert.equal(spectatorEventDestination(state, committed)?.kind, 'route');
  state.publicProjects = []; state.events = [finalEvent(result())];
  assert.equal(spectatorEventDestination(state, proposal)?.kind, 'route');
  state.events = []; const nearby = { ...proposal, tileId: state.cities[0]?.tileId ?? null };
  assert.equal(spectatorEventDestination(state, nearby)?.kind, 'civilization');
  state.events = [finalEvent(result())]; state.routes[0]!.agreement!.offerId = 'different-agreement';
  assert.equal(spectatorEventDestination(state, proposal)?.kind, 'civilization');
  state.routes = [];
  assert.equal(spectatorEventDestination(state, { ...finalEvent(result()), tileId: state.cities[0]?.tileId ?? null })?.kind, 'civilization');
  assert.equal(spectatorEventDestination(state, event({ type: 'trade-blocked', detail: 'missing-route', tileId: state.cities[0]?.tileId ?? null }))?.kind, 'civilization');
});

void test('Chronicle chooses diverse recent families and participants from its actual bounded projection in source order', () => {
  const state = world();
  state.events = [event({ id: 'old-research', type: 'research-completed', actor: 2, target: 2 }), event({ id: 'repair', type: 'public-project-failed', actor: 3, target: 4 }), ...Array.from({ length: 8 }, (_, index) => event({ id: `building-${index}`, type: 'building-completed', actor: 0, target: 0 }))];
  const before = structuredClone(state);
  assert.deepEqual(spectatorChronicle(state).map(story => story.event.id), ['building-7', 'repair', 'old-research']);
  assert.deepEqual(state, before);
  state.events = [event({ id: 'old-person', type: 'research-completed', actor: 4, target: 4 }), event({ id: 'same-person', type: 'research-completed', actor: 0, target: 0 }), event({ id: 'newest', type: 'research-completed', actor: 0, target: 0 }), event({ id: 'latest', type: 'research-completed', actor: 0, target: 0 })];
  assert.deepEqual(spectatorChronicle(state).map(story => story.event.id), ['latest', 'newest', 'old-person']);
  state.events = [event({ id: 'outside-projection', type: 'research-completed', actor: 4 }), ...Array.from({ length: 24 }, (_, index) => event({ id: `trade-${index}`, type: 'trade-delivered' }))];
  assert.equal(spectatorChronicle(state).some(story => story.event.id === 'outside-projection'), false);
});

void test('Developing towns projects only exact active work with terminal and archive wording and no hidden later orders', () => {
  const state = world(); const city = state.cities[0]; assert.ok(city);
  city.construction = { active: { ruleVersion: 1, id: 'order-1', cityId: city.id, buildingId: 'workshop', startedRound: 1, paid: { materials: 6 }, workDone: 2.125, workRequired: 6.5 }, lastCompleted: null };
  const before = structuredClone(state); const rows = developingTowns(state);
  assert.equal(rows.length, 1); assert.equal(rows[0]?.cityId, city.id); assert.equal(rows[0]?.orderId, 'order-1'); assert.equal(rows[0]?.amount, '2.125 / 6.5 work'); assert.equal(rows[0]?.status, 'Under construction · not built yet');
  assert.deepEqual(state, before); assert.equal(developingTowns(state, { archived: true })[0]?.status, 'Recorded unfinished work');
  state.outcome = { kind: 'mars', winners: [0], round: 4, reason: 'Recorded ending' };
  assert.equal(developingTowns(state)[0]?.status, 'Recorded unfinished work');
  const active = city.construction.active; assert.ok(active);
  active.cityId = 'another-city'; assert.deepEqual(developingTowns(state), []);
  active.cityId = city.id;
  for (let index = 0; index < 8; index += 1) state.cities.push({ ...structuredClone(city), id: `extra-${index}`, construction: { active: { ...active, cityId: `extra-${index}`, id: `order-${index + 2}` }, lastCompleted: null } });
  assert.equal(developingTowns(state).length, 9);
  city.construction.active = null;
  assert.equal(developingTowns(state).some(row => row.cityId === city.id), false);
});

class ElementRecord {
  tag: string; textContent = ''; className = ''; type = ''; disabled = false; dataset: Record<string, string> = {};
  children: ElementRecord[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>(); focused = false;
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_value: string) { throw new Error('Recorded facts must stay inert'); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...nodes: ElementRecord[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: ElementRecord[]): void { this.children = nodes; }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  contains(node: ElementRecord): boolean { return this.all().includes(node); }
  focus(): void { this.focused = true; }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(node => node.all())]; }
  content(): string { return this.all().map(node => node.textContent).join(' '); }
}

void test('visible causal facts and developing town navigation are inert and cannot retain focus across world identities', () => {
  const original = new Map(['document', 'HTMLElement', 'HTMLButtonElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = { activeElement: null as ElementRecord | null, createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_ns: string, tag: string) => new ElementRecord(tag) };
  for (const key of ['HTMLElement', 'HTMLButtonElement']) Object.defineProperty(globalThis, key, { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom });
  try {
    const state = world(); state.events = [event({ cause: '<img src=x> recorded cause', effects: ['<script> recorded consequence'], type: 'future-event' })];
    const host = new ElementRecord('ol');
    renderSpectatorChronicle(host as unknown as HTMLElement, spectatorChronicle(state), () => {}, 'local:one');
    assert.match(host.content(), /Why: <img src=x> recorded cause/); assert.match(host.content(), /Result: <script> recorded consequence/);
    dom.activeElement = host.all().find(node => node.tag === 'button') ?? null;
    renderSpectatorChronicle(host as unknown as HTMLElement, spectatorChronicle(state), () => {}, 'local:one');
    assert.equal(host.all().some(node => node.focused), true);
    dom.activeElement = host.all().find(node => node.tag === 'button') ?? null;
    renderSpectatorChronicle(host as unknown as HTMLElement, spectatorChronicle(state), () => {}, 'archive:two');
    assert.equal(host.all().some(node => node.focused), false);
    const city = state.cities[0]; assert.ok(city);
    city.name = '<b>Exact town</b>'; city.construction = { active: { ruleVersion: 1, id: 'same-order', cityId: city.id, buildingId: 'kiln', startedRound: 1, paid: {}, workDone: 1.25, workRequired: 4 }, lastCompleted: null };
    const towns = new ElementRecord('ol'); let selected = '';
    renderDevelopingTowns(towns as unknown as HTMLElement, developingTowns(state), id => { selected = id; }, 'local:one');
    const button = towns.all().find(node => node.tag === 'button'); assert.ok(button); button.listeners.get('click')?.(); assert.equal(selected, city.id);
    assert.match(towns.content(), /<b>Exact town<\/b>/); assert.match(towns.content(), /1\.25 \/ 4 work/);
    dom.activeElement = button;
    renderDevelopingTowns(towns as unknown as HTMLElement, developingTowns(state), () => {}, 'local:one');
    assert.equal(towns.all().some(node => node.focused), true);
    dom.activeElement = towns.all().find(node => node.tag === 'button') ?? null;
    renderDevelopingTowns(towns as unknown as HTMLElement, developingTowns(state), () => {}, 'archive:two');
    assert.equal(towns.all().some(node => node.focused), false);
    assert.equal([...host.all(), ...towns.all()].some(node => ['img', 'script', 'b', 'input', 'form'].includes(node.tag)), false);
    const rows = Array.from({ length: 9 }, (_, index) => ({ ...developingTowns(state)[0]!, cityId: `town-${index}`, orderId: `order-${index}` }));
    renderDevelopingTowns(towns as unknown as HTMLElement, rows, id => { selected = id; }, 'local:pagination');
    assert.equal(towns.all().filter(node => node.dataset['cityId']).length, 4); assert.match(towns.content(), /1–4 of 9/);
    let next = towns.all().find(node => node.dataset['townPage'] === 'next'); assert.ok(next); dom.activeElement = next; next.listeners.get('click')?.();
    assert.match(towns.content(), /5–8 of 9/);
    next = towns.all().find(node => node.dataset['townPage'] === 'next'); assert.ok(next); dom.activeElement = next; next.listeners.get('click')?.();
    assert.match(towns.content(), /9–9 of 9/); assert.equal(towns.all().filter(node => node.dataset['cityId']).length, 1);
    towns.all().find(node => node.dataset['cityId'] === 'town-8')?.listeners.get('click')?.(); assert.equal(selected, 'town-8');
    renderDevelopingTowns(towns as unknown as HTMLElement, rows, () => {}, 'archive:pagination'); assert.match(towns.content(), /1–4 of 9/);
    renderDevelopingTowns(towns as unknown as HTMLElement, [], () => {}, 'archive:two'); assert.equal(towns.children.length, 0);
  } finally { for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

void test('new event outcomes show only recorded effects and a trade fair navigates to its exact town, not an invented delivery', () => {
  const state = world(); const city = state.cities[0]; assert.ok(city);
  const fair = event({ type: 'trade-fair', actor: 5, target: 0, tileId: city.tileId, detail: 'A paid gathering after an earlier shipment', cause: 'This exact endpoint recorded earlier cargo', effects: ['Aster food 10 → 6', 'Aster credits 3 → 9'] });
  const [row] = eventLogEntries([fair], { civilizations: state.civilizations }); assert.ok(row);
  assert.equal(row.family, 'culture'); assert.equal(row.category, 'Trade fair'); assert.equal(row.summary, fair.effects.join(' · '));
  assert.doesNotMatch(row.summary, /delivered|shipment|exchanged/);
  assert.equal(spectatorEventDestination(state, fair)?.kind, 'city'); assert.equal(spectatorEventDestination(state, fair)?.id, city.id);
  const migration = event({ type: 'internal-migration', actor: 5, target: 0, effects: ['Aster food 20 → 16', 'Aster credits 8 → 6', 'Source population 6 → 4', 'Destination population 3 → 5'] });
  const [move] = eventLogEntries([migration], { civilizations: state.civilizations }); assert.ok(move);
  assert.equal(move.family, 'population'); assert.match(move.summary, /Source population 6 → 4/); assert.match(move.summary, /Destination population 3 → 5/);
  assert.doesNotMatch(move.summary, /new residents|population grew/);
});

void test('compact display uses exact named facts while Events Details retains every original cause effect and proof', () => {
  const original = new Map(['document', 'HTMLElement', 'HTMLButtonElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = { activeElement: null as ElementRecord | null, createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_ns: string, tag: string) => new ElementRecord(tag) };
  for (const key of ['HTMLElement', 'HTMLButtonElement']) Object.defineProperty(globalThis, key, { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom });
  try {
    const state = world(); state.civilizations[0]!.name = '<strong>Exact partner</strong>';
    const receipt = result();
    const committed = { ...finalEvent(receipt), cause: receipt.reason, effects: ['Proposer paid: materials 1.125, credits 2.5', 'Recipient paid: energy 3.75', 'Route damage 42.75 → 12.25', 'No shipment is created by this charter outcome', '<proof> exact raw proof'] };
    state.events = [committed];
    const before = structuredClone(state);
    const stories = spectatorChronicle(state); const story = stories[0]; assert.ok(story);
    assert.deepEqual(story.event, eventLogEntries(state.events, { civilizations: state.civilizations })[0]);
    const compact = new ElementRecord('ol'); let selected = '';
    renderSpectatorChronicle(compact as unknown as HTMLElement, stories, destination => { selected = destination.id.toString(); }, 'archive:raw-proof');
    const button = compact.all().find(node => node.tag === 'button'); assert.ok(button);
    assert.equal(button.dataset['storyId'], committed.id);
    assert.match(compact.content(), /<strong>Exact partner<\/strong>/);
    assert.match(compact.content(), /42.75 → 12.25/); assert.match(compact.content(), /1.125 Materials/);
    assert.doesNotMatch(compact.content(), /project-1|route-1|<proof>/);
    assert.match(button.attributes.get('aria-label') ?? '', /No cargo delivered/);
    button.listeners.get('click')?.(); assert.equal(selected, 'route-1');
    const full = new ElementRecord('ol');
    renderEventLog(full as unknown as HTMLElement, state.events, { civilizations: state.civilizations });
    const details = full.all().find(node => node.tag === 'details'); assert.ok(details);
    assert.ok(details.all().some(node => node.textContent === `Cause: ${committed.cause}`));
    assert.ok(details.all().some(node => node.textContent === `Record: ${committed.detail}`));
    for (const effect of committed.effects) assert.ok(details.all().some(node => node.textContent === effect), effect);
    assert.equal([...compact.all(), ...full.all()].some(node => node.tag === 'proof'), false);
    assert.deepEqual(state, before);
  } finally { for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
