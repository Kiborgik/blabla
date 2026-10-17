import assert from 'node:assert/strict';
import { test } from 'node:test';
import { depositLabel, extractionFacts, strategicResourceAmounts } from '../visuals/strategic-resource-visuals.ts';
import { renderRouteCard, retainedRoutePathInspection, routeAmounts, routeInspectionIdentity, steamRoutePresentation } from '../web/route-inspection.ts';
import { railWorkRows, renderStrategicInspection } from '../web/settlement-inspection.ts';
import { projectRoutePath, routeTilePage, ROUTE_TILE_PAGE_SIZE } from '../visuals/route-paths.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import type { City, RailConstructionOrder, RailCompletion, SteamTransportQuote, WorldState } from '../core/types.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { projectWorld } from '../web/live-world.ts';
import { civicProgressPresentation } from '../web/civic-progress.ts';
import { industrialSteamJourney } from './fixtures/industrial-steam-journey.ts';

await test('strategic amounts retain exact separate Iron and Coal values', () => {
  assert.deepEqual(strategicResourceAmounts({ iron: 4, coal: 1.25 }), [
    { resource: 'iron', label: 'Iron', amount: 4 },
    { resource: 'coal', label: 'Coal', amount: 1.25 },
  ]);
  assert.deepEqual(strategicResourceAmounts({ iron: 0 }), [{ resource: 'iron', label: 'Iron', amount: 0 }]);
  assert.deepEqual(strategicResourceAmounts(undefined), []);
});

await test('finite Coal site labels do not misname the resource or replace retained reserve values', () => {
  assert.equal(depositLabel({ tileId: 14, resource: 'coal', remaining: 297, initialReserve: 300 }), 'Coal · Tile 14 · 297 / 300 left');
  assert.equal(depositLabel({ tileId: 12, resource: 'iron', remaining: 238, initialReserve: 240 }), 'Iron · Tile 12 · 238 / 240 left');
});

await test('Coal extraction is historical and distinguishes storage-full from exhausted', () => {
  const receipt = { ruleVersion: 1 as const, tileId: 14, round: 8, resource: 'coal' as const, quantity: 2, reserveBefore: 300, reserveAfter: 298, stockBefore: 1, stockAfter: 3, capacity: 60, status: 'extracted' as const };
  const before = structuredClone(receipt);
  assert.deepEqual(extractionFacts(receipt), ['Round 8 · Extracted 2 Coal', 'Deposit at Tile 14: 300 → 298 left', 'Stored Coal then: 1 → 3 / 60 capacity', 'Historical extraction. Ordinary materials and later trade are separate.']);
  assert.match(extractionFacts({ ...receipt, status: 'storage-full', quantity: 0 })[0] ?? '', /No Coal extracted · Storage full/);
  assert.match(extractionFacts({ ...receipt, status: 'exhausted', quantity: 0 })[0] ?? '', /No Coal extracted · Deposit exhausted/);
  assert.deepEqual(receipt, before);
});

await test('route payment formatting includes Coal separately from ordinary Energy', () => {
  assert.deepEqual(routeAmounts('Paid', { energy: 2 }, { coal: 1, iron: 3 }), [
    { resource: 'energy', label: 'Paid: 2 Energy', amount: 2 },
    { resource: 'iron', label: 'Paid: 3 Iron', amount: 3 },
    { resource: 'coal', label: 'Paid: 1 Coal', amount: 1 },
  ]);
});

function syntheticSteamRoute(): RouteView {
  const transport: SteamTransportQuote = { mode: 'steam', ruleVersion: 1, tileIds: [0, 1, 2, 3, 4, 5], edges: 5, edgeWeights: [.25, .25, 1, 1, 1], railEdges: [{ edgeId: '0:1', completionEventId: '8:0' }, { edgeId: '1:2', completionEventId: '8:1' }], weightedDistance: 3.5, baseCadence: 1, unrailedEdges: 5, unrailedCadence: 3, proposerFuel: { coal: 1 } };
  return { id: 'steam-fixture', from: 'home', to: 'partner', owner: 0, partner: 1, active: true, damage: 0, volume: 0, ownerName: 'Aster', partnerName: 'Verdant', fromTown: { id: 'home', name: 'Home', civilization: 'Aster', color: '#ffffff', q: 0, r: 0 }, toTown: { id: 'partner', name: 'Partner', civilization: 'Verdant', color: '#ffffff', q: 5, r: 0 },
    agreement: { offerId: 'consent-fixture', terms: { recipeId: 'fixture', recipeVersion: 1, transport, constructionCost: { materials: 4 }, proposerCargo: { food: 3 }, recipientCargo: { energy: 2 }, proposerUpkeep: { energy: 1 }, recipientUpkeep: {}, proposerYield: { credits: 2 }, recipientYield: { credits: 2 }, cadenceRounds: 2, damageDisableAt: 50 }, enabled: true, acceptedRound: 4, nextDeliveryRound: 6, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null, lastSteamDelivery: null } };
}

await test('synthetic steam inspection uses retained cadence, comparison, exact edge records and fuel', () => {
  const route = syntheticSteamRoute(); const before = structuredClone(route);
  const view = steamRoutePresentation(route); assert.ok(view);
  assert.ok(view.terms.includes('Stored exchange interval · 2 rounds'));
  assert.ok(view.terms.includes('Unrailed comparison at proposal · 3 rounds · 5 steps'));
  assert.ok(view.terms.some(line => line.includes('shorter stored interval')));
  assert.ok(view.terms.includes('Proposer fuel each successful delivery · 1 Coal'));
  assert.match(view.edges[0] ?? '', /Tiles 0 ↔ 1 · Rail · Completion 8:0 · Recorded weight 0.25/);
  assert.match(view.edges[2] ?? '', /Unrailed · Recorded weight 1/);
  assert.equal(view.last, null); assert.deepEqual(route, before);
  assert.ok(route.agreement?.terms.transport?.mode === 'steam');
  route.agreement.terms.transport.unrailedEdges = 4;
  route.agreement.terms.transport.unrailedCadence = 2;
  assert.ok(steamRoutePresentation(route)?.terms.includes('No shorter interval is recorded for this agreement.'));
});

await test('malformed steam quotes stay unavailable instead of supplying invented path facts', () => {
  const route = syntheticSteamRoute(); assert.ok(route.agreement?.terms.transport?.mode === 'steam');
  route.agreement.terms.transport.weightedDistance = 999;
  assert.equal(steamRoutePresentation(route), null);
  assert.equal(routeTilePage(route, 0).total, 0);
});

await test('a later blocked attempt preserves the exact earlier successful steam payment', () => {
  const route = syntheticSteamRoute(); const agreement = route.agreement; assert.ok(agreement);
  agreement.lastSteamDelivery = { ruleVersion: 1, routeId: route.id, offerId: agreement.offerId, proposer: 0, recipient: 1, acceptedRound: 4, round: 6, eventId: 'paid-6', terms: structuredClone(agreement.terms), proposerPaid: { food: 3, energy: 1 }, recipientPaid: { energy: 2 }, proposerStrategicPaid: { coal: 1 }, recipientStrategicPaid: {} };
  Object.assign(agreement, { lastAttemptRound: 8, lastDeliveryRound: 6, deliveryCount: 1, blockedReason: 'Proposer lacks Coal', blockedBy: 0 });
  const before = structuredClone(route); const view = steamRoutePresentation(route); assert.ok(view?.last);
  assert.equal(view.last.heading, 'Last successful steam payment · Round 6');
  assert.deepEqual(view.last.proposerPaid, { food: 3, energy: 1 });
  assert.deepEqual(view.last.proposerStrategicPaid, { coal: 1 });
  assert.match(view.last.identity, /Event paid-6/); assert.deepEqual(route, before);
});

await test('legacy land terms stay unchanged and gain no steam claim', () => {
  const route = syntheticSteamRoute(); assert.ok(route.agreement);
  route.agreement.terms.transport = { mode: 'land', ruleVersion: 1, tileIds: [0, 1, 2, 3, 4, 5], edges: 5 };
  const before = structuredClone(route);
  assert.equal(steamRoutePresentation(route), null);
  assert.deepEqual(routeTilePage(route, 0).ids, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(route, before);
});

await test('rail Work rows preserve active versus completed identities and both payment vectors', () => {
  const active: RailConstructionOrder = { kind: 'rail', ruleVersion: 1, id: 'active-rail', cityId: 'home', edgeId: '0:1', tileId: 0, toTileId: 1, startedRound: 3, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, workDone: .75 };
  const { id, workDone, ...base } = active;
  const completed: RailCompletion = { ...base, edgeId: '1:2', tileId: 1, toTileId: 2, orderId: 'completed-rail', civId: 0, completedRound: 4, eventId: 'built-rail' };
  const city = { id: 'home', civId: 0, construction: { active, lastCompleted: completed } };
  const rail = { cityId: 'home', active, completed: [completed, { ...completed, cityId: 'other' }], available: [], blocker: null };
  const before = structuredClone({ city, rail }); const rows = railWorkRows(city, rail);
  assert.equal(rows.length, 2); assert.equal(rows[0]?.state, 'Under construction · Not built yet');
  assert.equal(rows[0]?.progress, '0.75 / 2 work'); assert.equal(rows[1]?.state, 'Completed Rail');
  assert.equal(rows[1]?.key, 'rail:1:2:completed-rail'); assert.deepEqual(rows[0]?.record.strategicPaid, { iron: 1, coal: 1 });
  assert.deepEqual({ city, rail }, before); assert.ok(id && workDone);
});

await test('steam path projection uses the canonical validator and retains a missing-rail current block', () => {
  const route = syntheticSteamRoute();
  const state = { tiles: Array.from({ length: 6 }, (_, id) => ({ id, q: id, r: 0, terrain: 'grassland' as const, elevation: 0, owner: 0, resource: null })), cities: [{ id: 'home', civId: 0, tileId: 0 }, { id: 'partner', civId: 1, tileId: 5 }] as City[], width: 6, height: 1, railEdges: {} } satisfies Pick<WorldState, 'tiles' | 'cities' | 'width' | 'height' | 'railEdges'>;
  const path = projectRoutePath(route, state);
  assert.equal(path.kind, 'land'); assert.equal(path.points.length, 6); assert.match(path.currentBlock ?? '', /rail/i);
  assert.deepEqual(routeTilePage(route, 0).ids, [0, 1, 2, 3, 4, 5]);
});

await test('steam disclosure state is retained only for the same agreement', () => {
  const route = syntheticSteamRoute();
  assert.deepEqual(retainedRoutePathInspection(routeInspectionIdentity(route), route, true, 0, true), { open: true, page: 0, steamOpen: true });
  assert.deepEqual(retainedRoutePathInspection('other-agreement', route, true, 0, true), { open: false, page: 0, steamOpen: false });
});

class ElementRecord {
  tag: string; textContent = ''; className = ''; dataset: Record<string, string> = {}; children: ElementRecord[] = []; attributes = new Map<string, string>(); click?: () => void;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: ElementRecord[]): void { this.children.push(...nodes); }
  prepend(...nodes: ElementRecord[]): void { this.children.unshift(...nodes); }
  replaceChildren(...nodes: ElementRecord[]): void { this.children = nodes; }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  addEventListener(event: string, callback: () => void): void { if (event === 'click') this.click = callback; }
  content(): string { return [this.textContent, ...this.children.map(node => node.content())].join(' '); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(node => node.all())]; }
}

function render(callback: (host: HTMLElement) => void): ElementRecord {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try { const host = createElement('section'); callback(host as unknown as HTMLElement); return host; }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
}

await test('strategic stock rendering uses each canonical capacity and keeps unrevealed Coal empty', () => {
  const host = render(node => renderStrategicInspection(node, { strategicCapacity: 40, strategicCapacities: { iron: 40, coal: 60 }, strategicResources: { iron: 7, coal: 0 }, revealedDeposits: [{ resource: 'iron', tileId: 3, initialReserve: 240, remaining: 238 }] }));
  assert.match(host.content(), /Iron.*7.*40 capacity.*Coal.*0.*60 capacity/);
  assert.match(host.content(), /Known Coal sites · 0.*No deposits are revealed/);
  assert.equal(host.all().filter(node => node.tag === 'details').length, 2);
});

await test('synthetic steam route DOM preserves native inspection and historical payment labels', () => {
  const route = syntheticSteamRoute();
  const host = render(node => renderRouteCard(node, route, () => undefined));
  assert.match(host.content(), /Stored steam path & fuel/);
  assert.match(host.content(), /No successful steam payment recorded yet/);
  assert.match(host.content(), /Periodic shipments/);
  assert.equal(host.all().filter(node => node.tag === 'details').every(node => node.children[0]?.tag === 'summary'), true);
  assert.equal(host.all().filter(node => node.tag === 'button').every(node => /^Show /.test(node.textContent)), true);
  assert.equal(host.all().filter(node => node.className === 'route-edge-records').flatMap(node => node.children).length, 5);
});

await test('long steam edge records page through native buttons without exceeding the existing budget', () => {
  const route = syntheticSteamRoute(); assert.ok(route.agreement?.terms.transport?.mode === 'steam');
  route.agreement.terms.transport = { mode: 'steam', ruleVersion: 1, tileIds: Array.from({ length: 41 }, (_, index) => index), edges: 40, edgeWeights: Array(40).fill(1), railEdges: [], weightedDistance: 40, baseCadence: 1, unrailedEdges: 40, unrailedCadence: 20, proposerFuel: { coal: 1 } };
  route.agreement.terms.cadenceRounds = 20;
  const before = structuredClone(route);
  render(node => {
    renderRouteCard(node, route, () => undefined);
    const root = node as unknown as ElementRecord;
    const edges = root.all().find(item => item.className === 'route-edge-records'); assert.ok(edges);
    assert.equal(edges.children.length, ROUTE_TILE_PAGE_SIZE);
    assert.match(edges.content(), /Tiles 0 ↔ 1/); assert.doesNotMatch(edges.content(), /Tiles 32 ↔ 33/);
    const next = root.all().find(item => item.textContent === 'Next tiles'); assert.ok(next?.click); next.click();
    assert.equal(edges.children.length, 8); assert.match(edges.content(), /Tiles 32 ↔ 33/); assert.match(edges.content(), /Tiles 39 ↔ 40/);
    const previous = root.all().find(item => item.textContent === 'Previous tiles'); assert.ok(previous?.click); previous.click();
    assert.equal(edges.children.length, ROUTE_TILE_PAGE_SIZE);
  });
  assert.deepEqual(route, before);
});

await test('rendered blocked steam attempt does not turn a prior successful fuel payment into a new debit', () => {
  const route = syntheticSteamRoute(); const agreement = route.agreement; assert.ok(agreement);
  agreement.lastSteamDelivery = { ruleVersion: 1, routeId: route.id, offerId: agreement.offerId, proposer: 0, recipient: 1, acceptedRound: 4, round: 6, eventId: '9:0', terms: structuredClone(agreement.terms), proposerPaid: { food: 3, energy: 1 }, recipientPaid: { energy: 2 }, proposerStrategicPaid: { coal: 1 }, recipientStrategicPaid: {} };
  Object.assign(agreement, { lastAttemptRound: 8, lastDeliveryRound: 6, deliveryCount: 1, blockedReason: 'Proposer lacks Coal', blockedBy: 0 });
  const host = render(node => renderRouteCard(node, route, () => undefined));
  assert.match(host.content(), /Last attempt blocked · round 8: Proposer lacks Coal/);
  assert.match(host.content(), /Last successful steam payment · Round 6/);
  assert.match(host.content(), /Home paid:.*3 Food.*1 Energy.*1 Coal/);
  assert.match(host.content(), /A later blocked attempt does not replace them/);
});

await test('the legal source journey projects actual finite Coal, paid Rail and the faster funded delivery', () => {
  const journey = industrialSteamJourney();
  const mine = journey.coalReady.cities.find(city => city.id === journey.mineCityId)?.improvements?.[String(journey.mineTileId)];
  const extraction = mine?.operation.lastResult?.extraction; assert.ok(extraction);
  assert.equal(extraction.resource, 'coal'); assert.equal(extraction.status, 'extracted');
  assert.match(extractionFacts(extraction).join(' '), /Extracted 2 Coal/);
  const completion = Object.values(journey.beforeOffer.railEdges ?? {})[0]; assert.ok(completion);
  const city = journey.beforeOffer.cities.find(candidate => candidate.id === completion.cityId); assert.ok(city);
  const projection = projectCapabilities(journey.beforeOffer, journey.seat, city.id, '2026-10-17T00:00:00.000Z');
  const rail = railWorkRows(city, projection.rail).find(row => row.record.edgeId === completion.edgeId); assert.ok(rail);
  assert.equal(rail.state, 'Completed Rail'); assert.deepEqual(rail.record.strategicPaid, { iron: 1, coal: 1 });
  const activeStep = journey.steps.find(step => step.result.state.cities.some(candidate => candidate.construction?.active && 'kind' in candidate.construction.active && candidate.construction.active.kind === 'rail')); assert.ok(activeStep);
  const activeCity = activeStep.result.state.cities.find(candidate => candidate.construction?.active && 'kind' in candidate.construction.active && candidate.construction.active.kind === 'rail'); assert.ok(activeCity);
  const activeProjection = projectCapabilities(activeStep.result.state, activeCity.civId, activeCity.id, '2026-10-17T00:00:00.000Z');
  assert.match(civicProgressPresentation({ catalogue: capabilityCatalogue(), projection: activeProjection, city: activeCity })?.constructionRecord ?? '', /Rail · Tiles.*work recorded/);
  const route = projectWorld(journey.state).routes.find(candidate => candidate.agreement?.offerId === journey.offerId); assert.ok(route?.agreement?.terms.transport?.mode === 'steam');
  const view = steamRoutePresentation(route); assert.ok(view?.last);
  assert.equal(route.path?.kind, 'land'); assert.equal(route.path?.currentBlock, null);
  assert.equal(route.agreement.terms.cadenceRounds, 7); assert.equal(route.agreement.terms.transport.unrailedCadence, 8);
  assert.equal(view.last.proposerStrategicPaid.coal, 1); assert.match(view.last.identity, new RegExp(journey.state.industrialEvidence?.steamDelivery?.eventId ?? '^$'));
  assert.equal(new Set(projection.industrialEvidence?.foundryOperations.map(receipt => receipt.cityId)).size, 2);
  assert.equal(projection.industrialEvidence?.steamDelivery, null);
  assert.ok(journey.state.calendarMilestones.includes('industrial-world'));
});
