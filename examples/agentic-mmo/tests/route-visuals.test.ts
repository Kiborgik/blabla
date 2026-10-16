import { routeVisual, visibleRoutes, routeInspectionCity, routeLabelKey, routeLabelPlacement, ROUTE_LIMIT } from '../visuals/route-visuals.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { renderRouteCard, renderRouteList, routePage, routeAmounts } from '../web/route-inspection.ts';
import { mapLabelVisibility } from '../web/map-labels.ts';
import { DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import type { Route, TradeTerms } from '../core/types.ts';

void test('selected route label avoids town targets with bounded deterministic placement', () => {
  const town = { x: 560, y: 320, width: 76, height: 70 };
  const before = structuredClone(town);
  const label = routeLabelPlacement({ x: 560, y: 350 }, [town], 1188, 650);
  assert.ok(label);
  assert.ok(label.y + label.height + 6 <= town.y || label.y >= town.y + town.height + 6 || Math.abs(label.x - town.x) >= (label.width + town.width) / 2 + 6);
  assert.deepEqual(routeLabelPlacement({ x: 560, y: 350 }, [town], 1188, 650), label);
  assert.deepEqual(town, before);
  assert.equal(routeLabelPlacement({ x: 250, y: 300 }, [{ x: 250, y: 0, width: 501, height: 761 }], 501, 761), null);
  assert.equal(routeLabelPlacement({ x: 50, y: 50 }, [], 100, 100), null);
  const clear = routeLabelPlacement({ x: 250, y: 300 }, [], 501, 761);
  assert.deepEqual(clear, { x: 250, y: 278, width: 180, height: 44 });
});

const terms: TradeTerms = {
  recipeId: 'fixture-exchange', recipeVersion: 1, constructionCost: { materials: 4 },
  proposerCargo: { food: 3 }, recipientCargo: { energy: 2 }, proposerUpkeep: { credits: 1 },
  recipientUpkeep: {}, proposerYield: { credits: 2 }, recipientYield: { credits: 2 },
  cadenceRounds: 4, damageDisableAt: 60,
};

function fixtureRoute(id = 'route-a'): Route {
  return { id, from: 'frontier', to: 'partner-town', owner: 0, partner: 1, active: false,
    damage: 0, volume: 0, agreement: { offerId: `offer-${id}`, terms: structuredClone(terms),
      enabled: true, acceptedRound: 2, nextDeliveryRound: 6, lastAttemptRound: null,
      lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } };
}

await test('route projection retains inactive agreed and missing-endpoint identities without mutating state', () => {
  const state = createWorld(1701);
  const home = state.cities[0];
  const partner = state.cities[1];
  assert.ok(home && partner);
  state.cities.push({ ...structuredClone(home), id: 'frontier', name: 'Far Hearth' });
  partner.id = 'partner-town';
  state.routes = [fixtureRoute(), { ...fixtureRoute('missing'), from: 'gone-town' }];
  const before = structuredClone(state);
  const world = projectWorld(state);
  assert.equal(world.routes.length, 2);
  assert.deepEqual(state, before);
});

await test('route projection uses the exact frontier town and clones immutable trade terms', () => {
  const state = createWorld(1701);
  const first = state.cities[0];
  const second = state.cities[1];
  assert.ok(first && second);
  state.cities.push({ ...structuredClone(first), id: 'frontier', name: 'Far Hearth' });
  second.id = 'partner-town';
  state.routes = [fixtureRoute()];
  const projected = projectWorld(state).routes[0];
  assert.ok(projected?.agreement);
  assert.equal(projected.from, 'frontier');
  assert.equal(projected.fromTown?.name, 'Far Hearth');
  assert.equal(projected.toTown?.id, second.id);
  projected.agreement.terms.proposerCargo.food = 100;
  assert.equal(state.routes[0]?.agreement?.terms.proposerCargo.food, 3);
});

await test('pending offers alone never become agreed map routes', () => {
  const state = createWorld(1701);
  state.tradeOffers = [{ id: 'offer', proposer: 0, recipient: 1, from: 'frontier', to: 'partner-town', createdRound: 2, expiresRound: 6, status: 'pending', terms, routeId: null }];
  assert.equal(projectWorld(state).routes.length, 0);
});

function fixtureView(id = 'route-a'): RouteView {
  return { ...fixtureRoute(id), ownerName: 'Aster', partnerName: 'Pelagos',
    fromTown: { id: 'frontier', name: 'Far Hearth', civilization: 'Aster', color: '#aabbcc', q: 2, r: 3 },
    toTown: { id: 'partner-town', name: 'Tidehaven', civilization: 'Pelagos', color: '#ccbbaa', q: 6, r: 1 } };
}

await test('consent before first delivery is visible and does not claim production or travel', () => {
  const route = fixtureView();
  const visual = routeVisual(route);
  assert.equal(visual.status, 'agreed');
  assert.equal(visual.lastDelivery, 'No recorded delivery');
  assert.equal(visual.nextDue, 'First due round 6');
  assert.deepEqual(visibleRoutes([route], null), [route]);
  assert.deepEqual(routeVisual({ ...route, active: true, volume: 500 }), visual);
  assert.ok(!('motion' in visual));
});

await test('current damage and the last blocked attempt remain separate after repair', () => {
  const route = fixtureView();
  assert.ok(route.agreement);
  route.agreement.lastAttemptRound = 6;
  route.agreement.blockedReason = 'Aster lacks food';
  route.agreement.blockedBy = 0;
  route.damage = 65;
  assert.equal(routeVisual(route).status, 'damaged');
  assert.match(routeVisual(route).lastAttempt, /round 6: Aster lacks food/);
  route.damage = 0;
  assert.equal(routeVisual(route).status, 'blocked');
  assert.match(routeVisual(route).lastAttempt, /Last attempt blocked/);
  assert.equal(visibleRoutes([route], null).length, 1);
});

await test('stopping preserves exact delivery history while disabling future scheduling', () => {
  const route = fixtureView();
  assert.ok(route.agreement);
  Object.assign(route.agreement, { enabled: false, closedRound: 9, lastAttemptRound: 6, lastDeliveryRound: 6, deliveryCount: 1 });
  const visual = routeVisual(route);
  assert.equal(visual.status, 'stopped');
  assert.equal(visual.lastDelivery, 'Last delivered round 6 · 1 completed delivery');
  assert.equal(visual.nextDue, 'No future deliveries while stopped');
  assert.equal(visibleRoutes([route], null).length, 0);
  assert.equal(visibleRoutes([route], route.id)[0]?.id, route.id);
});

await test('legacy and missing endpoints remain inspectable without guessed consent or towns', () => {
  const route = fixtureView();
  delete route.agreement;
  assert.equal(routeVisual(route).consent, 'Agreement not recorded');
  assert.equal(visibleRoutes([route], null).length, 0);
  assert.equal(routeInspectionCity(route), 'frontier');
  route.fromTown = null;
  assert.equal(routeInspectionCity(route), 'partner-town');
  assert.equal(visibleRoutes([route], route.id).length, 0);
  route.toTown = null;
  assert.equal(routeInspectionCity(route), null);
});

await test('at most twelve stable links survive with selected stopped route first', () => {
  const routes = Array.from({ length: 40 }, (_, index) => fixtureView(`route-${String(index).padStart(2, '0')}`));
  const last = routes.at(-1);
  assert.ok(last?.agreement);
  last.agreement.enabled = false;
  const before = structuredClone(routes);
  const selected = visibleRoutes(routes, last.id);
  assert.equal(selected.length, ROUTE_LIMIT);
  assert.equal(selected[0]?.id, last.id);
  assert.deepEqual(selected, visibleRoutes(routes.toReversed(), last.id));
  assert.deepEqual(routes, before);
  assert.ok(!visibleRoutes(routes, 'missing-selection').includes(last));
});

await test('route pages are bounded and every exact identity stays reachable', () => {
  const routes = Array.from({ length: 37 }, (_, index) => fixtureView(`route-${index}`));
  const pages = routePage(routes, 0).pages;
  const ids = Array.from({ length: pages }, (_, page) => routePage(routes, page).rows).flat().map((route) => route.id);
  assert.equal(new Set(ids).size, routes.length);
  assert.equal(routePage(routes, 999).page, pages - 1);
  assert.equal(routePage(routes, -1).page, 0);
  assert.equal(routePage(routes, Number.NaN).page, 0);
  assert.ok(Array.from({ length: pages }, (_, page) => routePage(routes, page).rows.length).every((count) => count <= ROUTE_LIMIT));
});

await test('terms keep exact positive resources separate without calculating net stock', () => {
  const before = structuredClone(terms);
  assert.deepEqual(routeAmounts('Sends', terms.proposerCargo).map(({ resource, amount }) => ({ resource, amount })), [{ resource: 'food', amount: 3 }]);
  assert.deepEqual(routeAmounts('Transport cost', terms.proposerUpkeep).map(({ resource, amount }) => ({ resource, amount })), [{ resource: 'credits', amount: 1 }]);
  assert.deepEqual(routeAmounts('Commerce received', terms.proposerYield).map(({ resource, amount }) => ({ resource, amount })), [{ resource: 'credits', amount: 2 }]);
  assert.deepEqual(terms, before);
});

await test('selected route label shares each existing label cap while the selected town stays primary', () => {
  const route = { id: routeLabelKey('a'), x: 80, y: 40, width: 180, height: 44 };
  const cities = Array.from({ length: 20 }, (_, index) => ({ id: `town-${index}`, x: 80 + index % 5 * 200, y: 140 + Math.floor(index / 5) * 100, width: 80, height: 44 }));
  for (const detail of ['far', 'mid', 'close'] as const) {
    const labels = [route, ...cities];
    const visible = mapLabelVisibility(labels, 'town-0', detail, 1200, 800);
    assert.equal(visible[1], true);
    assert.equal(visible[0], true);
    assert.ok(visible.filter(Boolean).length <= DETAIL_BUDGETS[detail].labels);
    const overlap = mapLabelVisibility([{ ...route, y: 140 }, ...cities], 'town-0', detail, 1200, 800);
    assert.equal(overlap[1], true);
    assert.equal(overlap[0], false);
  }
});

await test('Three route adapters create one static shared segment and retain CSS-pixel contrast widths', async () => {
  const { routeLineMeshes } = await import('../web/renderer.ts');
  const { hexPosition } = await import('../web/atlas.ts');
  for (const blocked of [false, true]) {
    const route = fixtureView();
    assert.ok(route.agreement && route.fromTown);
    if (blocked) { route.agreement.blockedReason = 'Supplies unavailable'; route.agreement.lastAttemptRound = 6; }
    const pair = routeLineMeshes(route, true);
    assert.ok(pair);
    const [backing, line] = pair;
    assert.equal(backing.geometry, line.geometry);
    assert.equal(line.geometry.getAttribute('instanceStart').count, 1);
    const origin = hexPosition(route.fromTown.q, route.fromTown.r);
    assert.ok(Math.abs(line.geometry.getAttribute('instanceStart').getX(0) - origin.x) < 0.00001);
    assert.equal(line.userData['routeId'], route.id);
    assert.equal(line.material.worldUnits, false);
    assert.equal(line.material.linewidth, 3);
    assert.equal(backing.material.linewidth, 7);
    assert.equal(line.material.dashed, blocked);
    assert.equal(line.material.dashOffset, 0);
    line.geometry.dispose(); line.material.dispose(); backing.material.dispose();
  }
  assert.equal(routeLineMeshes({ ...fixtureView(), fromTown: null }, true), null);
});

class RecordedNode {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  disabled = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: RecordedNode[] = [];
  click: (() => void) | undefined;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: RecordedNode[]): void { this.children.push(...nodes); }
  prepend(...nodes: RecordedNode[]): void { this.children.unshift(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { if (name === 'click') this.click = listener; }
  content(): string { return [this.textContent, ...this.children.map((child) => child.content())].join(' '); }
}

await test('route card DOM output keeps exact town callbacks and terms separate from recorded delivery facts', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: RecordedNode[] = [];
  const make = (tag: string): RecordedNode => { const node = new RecordedNode(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag),
    createTextNode: (value: string) => { const node = make('#text'); node.textContent = value; return node; },
  } });
  try {
    const chosen: string[] = [];
    const route = fixtureView();
    assert.ok(route.agreement);
    route.agreement.lastAttemptRound = 6;
    route.agreement.blockedReason = 'Aster lacks food';
    const host = document.createElement('section');
    renderRouteCard(host, route, (id) => chosen.push(id));
    const content = nodes[0]?.content() ?? '';
    assert.match(content, /Far Hearth.*Aster · frontier/);
    assert.match(content, /Damage now: 0%/);
    assert.match(content, /Last attempt blocked · round 6: Aster lacks food/);
    assert.match(content, /No recorded delivery/);
    assert.match(content, /These are not new gains/);
    assert.match(content, /Sends:.*3 Food/);
    const buttons = nodes.filter((node) => node.tag === 'button');
    assert.deepEqual(buttons.map((node) => node.textContent), ['Show Far Hearth', 'Show Tidehaven']);
    for (const button of buttons) button.click?.();
    assert.deepEqual(chosen, ['frontier', 'partner-town']);
    nodes.length = 0;
    const missingHost = document.createElement('section');
    renderRouteCard(missingHost, { ...route, fromTown: null, toTown: null }, (id) => chosen.push(id));
    assert.match(nodes[0]?.content() ?? '', /Endpoint unavailable · frontier/);
    assert.equal(nodes.filter((node) => node.tag === 'button').length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

await test('route list DOM output exposes native buttons, stable focus keys and bounded page actions', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: RecordedNode[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => { const node = new RecordedNode(tag); nodes.push(node); return node; } } });
  try {
    const routes = Array.from({ length: 25 }, (_, index) => fixtureView(`route-${String(index).padStart(2, '0')}`));
    const chosen: string[] = [];
    const pages: number[] = [];
    renderRouteList(document.createElement('section'), routes, 'route-13', 1, (id) => chosen.push(id), (page) => pages.push(page));
    const rows = nodes.filter((node) => node.tag === 'button' && node.dataset['routeFocus']?.startsWith('route:'));
    assert.equal(rows.length, 12);
    assert.equal(rows[1]?.attributes.get('aria-pressed'), 'true');
    assert.ok(rows.every((node) => node.type === 'button'));
    rows[1]?.click?.();
    assert.deepEqual(chosen, ['route-13']);
    nodes.find((node) => node.dataset['routeFocus'] === 'next')?.click?.();
    assert.deepEqual(pages, [2]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

await test('land route inspection separates stored schedule, current passability and prior delivery', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: RecordedNode[] = [];
  const make = (tag: string): RecordedNode => { const node = new RecordedNode(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag),
    createTextNode: (value: string) => { const node = make('#text'); node.textContent = value; return node; },
  } });
  try {
    const route = fixtureView();
    assert.ok(route.agreement);
    route.agreement.terms.transport = { mode: 'land', ruleVersion: 1, tileIds: [19, 20, 38], edges: 2 };
    route.agreement.terms.cadenceRounds = 5;
    route.agreement.nextDeliveryRound = 12;
    route.agreement.lastDeliveryRound = 7;
    route.agreement.lastAttemptRound = 7;
    route.agreement.deliveryCount = 1;
    route.path = { kind: 'land', points: [{ tileId: 19, q: 1, r: 1, height: 0.4 }, { tileId: 20, q: 2, r: 1, height: 0.4 }, { tileId: 38, q: 2, r: 2, height: 0.4 }], currentBlock: 'Land quote tile 20 is impassable ocean', reason: null };
    renderRouteCard(document.createElement('section'), route, () => undefined);
    const content = nodes[0]?.content() ?? '';
    assert.match(content, /Recorded land path · 2 steps/);
    assert.match(content, /Exchange interval: 5 rounds/);
    assert.match(content, /Next due round 12/);
    assert.match(content, /Last delivered round 7/);
    assert.match(content, /Path now: Land quote tile 20 is impassable ocean/);
    assert.doesNotMatch(content, /No travel time or terrain path is recorded/);
    assert.match(content, /19 → 20 → 38/);
    assert.equal(routeVisual(route).status, 'path-blocked');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

await test('recorded tile disclosure pages complete immutable order through stable native controls', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: RecordedNode[] = [];
  const make = (tag: string): RecordedNode => { const node = new RecordedNode(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag),
    createTextNode: (value: string) => { const node = make('#text'); node.textContent = value; return node; },
  } });
  try {
    const route = fixtureView();
    assert.ok(route.agreement);
    const ids = Array.from({ length: 70 }, (_, index) => index + 1);
    route.agreement.terms.transport = { mode: 'land', ruleVersion: 1, tileIds: ids, edges: 69 };
    const before = structuredClone(route);
    renderRouteCard(document.createElement('section'), route, () => undefined, { open: true, page: 1 });
    const details = nodes.find(node => node.tag === 'details');
    const values = nodes.find(node => node.className === 'route-tile-ids');
    const next = nodes.find(node => node.dataset['routeFocus'] === 'path-next');
    const back = nodes.find(node => node.dataset['routeFocus'] === 'path-previous');
    assert.ok(details && values && next && back);
    assert.equal(details.dataset['page'], '1');
    assert.equal(values.textContent, ids.slice(32, 64).join(' → '));
    assert.equal(next.type, 'button');
    assert.equal(back.type, 'button');
    assert.equal(next.disabled, false);
    next.click?.();
    assert.equal(details.dataset['page'], '2');
    assert.equal(values.textContent, ids.slice(64).join(' → '));
    assert.equal(next.disabled, true);
    back.click?.();
    back.click?.();
    assert.equal(details.dataset['page'], '0');
    assert.equal(values.textContent, ids.slice(0, 32).join(' → '));
    assert.equal(back.disabled, true);
    assert.equal(nodes.find(node => node.dataset['routeFocus'] === 'path-next'), next);
    assert.deepEqual(route, before);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

await test('route terms show ordinary and strategic cargo separately without changing upkeep', () => {
  assert.deepEqual(routeAmounts('Sends', { food: 5 }, { iron: 2 }), [
    { resource: 'food', label: 'Sends: 5 Food', amount: 5 },
    { resource: 'iron', label: 'Sends: 2 Iron', amount: 2 },
  ]);
  assert.deepEqual(routeAmounts('Transport cost', { energy: 1 }), [{ resource: 'energy', label: 'Transport cost: 1 Energy', amount: 1 }]);
});
