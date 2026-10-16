import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { TRADE_RECIPES } from '../core/content.ts';
import type { Route } from '../core/types.ts';
import { projectRoutePath, routePathPoints, visibleRoutePaths, routeTilePage, ROUTE_EDGE_LIMIT, ROUTE_TOTAL_EDGE_LIMIT } from '../visuals/route-paths.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { routeLineMeshes } from '../web/renderer.ts';
import { flatRoutePoints } from '../web/flat-renderer.ts';
import { routeMapPositions, routeMapAnchor, hexPosition } from '../web/atlas.ts';
import { routeInspectionCity, routeMapLabel, routeVisual } from '../visuals/route-visuals.ts';
import { retainedRoutePathInspection, routeInspectionIdentity } from '../web/route-inspection.ts';

function fixture() {
  const state = createWorld(1701);
  const origin = state.cities[0];
  const destination = state.cities[1];
  const recipe = TRADE_RECIPES[0];
  assert.ok(origin && destination && recipe);
  const ids = [19, 20, 38, 37, 55, 56, 74];
  origin.tileId = 19;
  destination.tileId = 74;
  for (const id of ids) { const tile = state.tiles.find(entry => entry.id === id); assert.ok(tile); tile.terrain = 'grassland'; }
  const terms = structuredClone(recipe.terms);
  terms.transport = { mode: 'land', ruleVersion: 1, tileIds: ids, edges: ids.length - 1 };
  terms.cadenceRounds = 5;
  const route: Route = { id: 'route-fixture', from: origin.id, to: destination.id, owner: origin.civId, partner: destination.civId,
    active: true, damage: 0, volume: 7, agreement: { offerId: 'offer-fixture', terms, enabled: true, acceptedRound: 2,
      nextDeliveryRound: 12, lastAttemptRound: 7, lastDeliveryRound: 7, deliveryCount: 1, blockedBy: null, blockedReason: null, closedRound: null } };
  state.routes = [route];
  return { state, route, ids };
}

await test('retained multi-bend path keeps every tile in stored order and detached map coordinates', () => {
  const { state, route, ids } = fixture();
  const before = structuredClone(state);
  const path = projectRoutePath(route, state);
  assert.equal(path.kind, 'land');
  assert.deepEqual(path.points.map(point => point.tileId), ids);
  assert.deepEqual(path.points.map(({ q, r }) => [q, r]), ids.map(id => [id % state.width - (state.width - 1) / 2, Math.floor(id / state.width) - (state.height - 1) / 2]));
  assert.equal(path.currentBlock, null);
  assert.deepEqual(state, before);
  assert.ok(path.points[2]);
  path.points[2].q = 999;
  assert.deepEqual(state, before);
});

await test('current ocean blockage retains all quoted positions and historical successful delivery', () => {
  const { state, ids } = fixture();
  const tile = state.tiles.find(entry => entry.id === ids[3]);
  assert.ok(tile);
  tile.terrain = 'ocean';
  const before = structuredClone(state);
  const world = projectWorld(state);
  const projected = world.routes[0];
  assert.ok(projected?.path);
  assert.equal(projected.path.kind, 'land');
  assert.deepEqual(projected.path.points.map(point => point.tileId), ids);
  assert.match(projected.path.currentBlock ?? '', /impassable ocean/);
  assert.equal(world.tiles.some(entry => entry.id === tile.id), false);
  assert.equal(projected.agreement?.lastDeliveryRound, 7);
  assert.equal(projected.agreement?.blockedReason, null);
  assert.deepEqual(state, before);
});

await test('older accepted links stay schematic without changing their retained schedule', () => {
  const { state, route } = fixture();
  assert.ok(route.agreement);
  delete route.agreement.terms.transport;
  route.agreement.nextDeliveryRound = 8;
  const before = structuredClone(state);
  const path = projectRoutePath(route, state);
  assert.equal(path.kind, 'schematic');
  assert.equal(path.points.length, 2);
  assert.equal(path.currentBlock, null);
  assert.deepEqual(state, before);
});

await test('invalid retained topology is unavailable instead of an invented schematic shortcut', () => {
  for (const kind of ['missing-tile', 'nonadjacent', 'reversed-endpoints', 'unsupported-version', 'duplicate', 'missing-town'] as const) {
    const { state, route } = fixture();
    const quote = route.agreement?.terms.transport;
    assert.ok(quote);
    if (kind === 'missing-tile') state.tiles = state.tiles.filter(tile => tile.id !== 38);
    if (kind === 'nonadjacent') quote.tileIds[2] = 100;
    if (kind === 'reversed-endpoints') quote.tileIds.reverse();
    if (kind === 'unsupported-version') Reflect.set(quote, 'ruleVersion', 99);
    if (kind === 'duplicate') quote.tileIds[2] = 19;
    if (kind === 'missing-town') state.cities = state.cities.filter(city => city.id !== route.from);
    const path = projectRoutePath(route, state);
    assert.equal(path.kind, 'unavailable', kind);
    assert.equal(path.points.length, 0, kind);
    assert.ok(path.reason, kind);
  }
});

function view(edges: number, id = 'route-fixture'): RouteView {
  const { state, route } = fixture();
  const projected = projectWorld(state).routes[0];
  assert.ok(projected);
  return { ...projected, ...route, id, path: { kind: 'land', currentBlock: null, reason: null,
    points: Array.from({ length: edges + 1 }, (_, index) => ({ tileId: index, q: index, r: index % 2, height: 0.4 })) } };
}

await test('map budget allocates entire paths selected-first without truncating a single corner', () => {
  const routes = Array.from({ length: 12 }, (_, index) => view(512, `route-${index.toString().padStart(2, '0')}`));
  const before = structuredClone(routes);
  const chosen = visibleRoutePaths(routes, 'route-11');
  assert.equal(chosen[0]?.id, 'route-11');
  assert.equal(chosen.length, 8);
  assert.ok(chosen.reduce((total, route) => total + routePathPoints(route).length - 1, 0) <= ROUTE_TOTAL_EDGE_LIMIT);
  assert.ok(chosen.every(route => routePathPoints(route).length === ROUTE_EDGE_LIMIT + 1));
  assert.deepEqual(visibleRoutePaths(routes.toReversed(), 'route-11'), chosen);
  assert.deepEqual(routes, before);
});

await test('an over-budget or unprojected quoted route never falls back to an endpoint chord', () => {
  const route = view(513);
  assert.equal(visibleRoutePaths([route], route.id).length, 0);
  delete route.path;
  assert.deepEqual(routePathPoints(route), []);
  assert.equal(visibleRoutePaths([route], route.id).length, 0);
});

await test('all retained tile identities remain reachable through bounded detached pages', () => {
  const route = view(513);
  const quote = route.agreement?.terms.transport;
  assert.ok(quote);
  quote.tileIds = Array.from({ length: 514 }, (_, index) => index);
  quote.edges = 513;
  const before = structuredClone(route);
  const first = routeTilePage(route, 0);
  assert.equal(first.pages, 17);
  assert.equal(first.total, 514);
  const all = Array.from({ length: first.pages }, (_, page) => routeTilePage(route, page).ids).flat();
  assert.deepEqual(all, quote.tileIds);
  assert.equal(routeTilePage(route, 999).page, 16);
  assert.equal(routeTilePage(route, Number.NaN).page, 0);
  assert.equal(routeTilePage(route, -4).page, 0);
  assert.equal(first.ids.length, 32);
  first.ids[0] = 999;
  assert.deepEqual(route, before);
});

await test('Three creates every retained corner instead of one schematic chord', () => {
  const { state, route, ids } = fixture();
  const projected = projectWorld(state).routes[0];
  assert.ok(projected);
  const pair = routeLineMeshes(projected, true);
  assert.ok(pair);
  try { assert.equal(pair[1].geometry.getAttribute('instanceStart').count, ids.length - 1); }
  finally { pair[0].geometry.dispose(); pair[0].material.dispose(); pair[1].material.dispose(); }
  assert.equal(route.agreement?.terms.cadenceRounds, 5);
});

await test('SVG and Three consume the same complete recorded vertex sequence', () => {
  const { state, ids } = fixture();
  const route = projectWorld(state).routes[0];
  assert.ok(route);
  const points = routeMapPositions(route);
  assert.equal(points.length, ids.length);
  assert.deepEqual(flatRoutePoints(route).split(' ').map(value => value.split(',').map(Number)), points.map(point => [point.x, point.z]));
  const pair = routeLineMeshes(route, true);
  assert.ok(pair);
  try {
    const starts = pair[1].geometry.getAttribute('instanceStart');
    const ends = pair[1].geometry.getAttribute('instanceEnd');
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      assert.ok(start && end);
      assert.ok(Math.abs(starts.getX(index) - start.x) < 0.00001);
      assert.ok(Math.abs(starts.getY(index) - start.y) < 0.00001);
      assert.ok(Math.abs(starts.getZ(index) - start.z) < 0.00001);
      assert.ok(Math.abs(ends.getX(index) - end.x) < 0.00001);
      assert.ok(Math.abs(ends.getY(index) - end.y) < 0.00001);
      assert.ok(Math.abs(ends.getZ(index) - end.z) < 0.00001);
    }
  } finally { pair[0].geometry.dispose(); pair[0].material.dispose(); pair[1].material.dispose(); }
});

await test('selected label starts at the retained path midpoint instead of the endpoint chord', () => {
  const { state } = fixture();
  const route = projectWorld(state).routes[0];
  assert.ok(route?.path);
  const middle = route.path.points[3];
  const first = route.path.points[0];
  const last = route.path.points.at(-1);
  const anchor = routeMapAnchor(route);
  assert.ok(middle && first && last && anchor);
  const expected = hexPosition(middle.q, middle.r);
  assert.ok(Math.abs(anchor.x - expected.x) < 0.000001);
  assert.ok(Math.abs(anchor.z - expected.z) < 0.000001);
  const chord = hexPosition((first.q + last.q) / 2, (first.r + last.r) / 2);
  assert.ok(Math.hypot(anchor.x - chord.x, anchor.z - chord.z) > 0.5);
});

await test('retained frontier endpoint and current blockage do not overwrite exact town or prior result', () => {
  const { state, route } = fixture();
  const capital = state.cities[0];
  assert.ok(capital);
  state.cities.push({ ...structuredClone(capital), id: 'frontier', name: 'Far Hearth' });
  capital.tileId = 81;
  route.from = 'frontier';
  const blocked = state.tiles.find(tile => tile.id === 38);
  assert.ok(blocked);
  blocked.terrain = 'mountain';
  const projected = projectWorld(state).routes[0];
  assert.ok(projected);
  assert.equal(routeInspectionCity(projected), 'frontier');
  assert.equal(projected.fromTown?.name, 'Far Hearth');
  assert.equal(projected.path?.points[0]?.tileId, 19);
  assert.equal(routeVisual(projected).status, 'path-blocked');
  assert.match(routeVisual(projected).lastDelivery, /round 7/);
  assert.match(routeMapLabel(projected), /Path cannot pass now/);
  assert.equal(projected.agreement?.blockedReason, null);
});

await test('explicit malformed transport never takes the absent-transport compatibility branch', () => {
  for (const transport of [undefined, null, {}, { mode: 'sea', ruleVersion: 1, tileIds: [19, 20], edges: 1 }]) {
    const { state, route } = fixture();
    assert.ok(route.agreement);
    Reflect.set(route.agreement.terms, 'transport', transport);
    assert.equal(projectRoutePath(route, state).kind, 'unavailable');
  }
});

await test('tile disclosure state stays with the same route and agreement only', () => {
  const route = view(513);
  const quote = route.agreement?.terms.transport;
  assert.ok(quote && route.agreement);
  quote.tileIds = Array.from({ length: 514 }, (_, index) => index);
  quote.edges = 513;
  const identity = routeInspectionIdentity(route);
  assert.deepEqual(retainedRoutePathInspection(identity, route, true, 4), { open: true, page: 4 });
  assert.deepEqual(retainedRoutePathInspection(identity, route, true, 99), { open: true, page: 16 });
  assert.deepEqual(retainedRoutePathInspection(undefined, route, true, 4), { open: false, page: 0 });
  route.agreement.offerId = 'different-consent';
  assert.deepEqual(retainedRoutePathInspection(identity, route, true, 4), { open: false, page: 0 });
  assert.equal(visibleRoutePaths([route], route.id).length, 0);
  assert.equal(routeTilePage(route, 4).ids[0], 128);
});
