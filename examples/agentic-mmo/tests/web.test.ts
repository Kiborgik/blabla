import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { cameraShiftForAnchor, createInspectionSession, inspectionAnchor } from '../web/inspection-camera.ts';
import * as THREE from 'three';
import { cityScreenMetrics } from '../web/flat-renderer.ts';
import { ERAS } from '../core/content.ts';
import type { GameEvent } from '../core/types.ts';
import { createSettlementMeshes } from '../web/settlement-three.ts';
import { flatPartFaces, shapeTriangles, transformedVertices } from '../web/settlement-parts.ts';
import { mapLabelVisibility } from '../web/map-labels.ts';
import { deltaNumber, eventAnchor } from '../web/world-cues.ts';
import { eventVisual, settlementVisual } from '../visuals/world-visuals.ts';
import { acceptsSnapshot, activityLabel, capabilityName, formatYear, latestMeaningfulEvent, parseWorldRead, presentationColor, projectWorld, uniqueCivilizations } from '../web/live-world.ts';
import { CIVILIZATIONS, createPreviewWorld, hexPosition } from '../web/atlas.ts';
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  parseRelease,
  shouldReload,
} from '../web/viewer-state.ts';

await test('preview atlas is deterministic and contains five inspectable civilizations', () => {
  const first = createPreviewWorld();
  assert.deepEqual(first, createPreviewWorld());
  assert.equal(CIVILIZATIONS.length, 5);
  assert.equal(first.cities.length, 5);
  assert.ok(first.tiles.length > 100);
  for (const city of first.cities) {
    assert.ok(first.tiles.some((tile) => tile.q === city.q && tile.r === city.r));
  }
  assert.equal(new Set(first.tiles.map((tile) => `${tile.q},${tile.r}`)).size, first.tiles.length);
});

await test('hex coordinates share a consistent geometry', () => {
  assert.deepEqual(hexPosition(0, 0), { x: 0, z: 0 });
  assert.equal(hexPosition(0, 1).z, 1.5);
  assert.equal(hexPosition(1, 0).x, Math.sqrt(3));
});

await test('viewer preferences reject incompatible and malformed persisted values', () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences({ schemaVersion: 8, zoom: 3 }), DEFAULT_PREFERENCES);
  const preferences = parsePreferences({
    schemaVersion: 1,
    zoom: 200,
    x: 4,
    z: -2,
    selected: 2,
    speed: 2,
    paused: true,
  });
  assert.equal(preferences.zoom, 2.2);
  assert.equal(preferences.x, 4);
  assert.equal(preferences.selected, 2);
  assert.equal(preferences.paused, true);
  assert.equal(parsePreferences({ schemaVersion: 1, x: Number.NaN, selected: -1 }).x, 0);
  assert.equal(parsePreferences({ schemaVersion: 1, selected: 99 }).selected, 0);
  assert.ok(!('world' in parsePreferences({ schemaVersion: 1, world: { round: 900 } })));
});

await test('release polling reloads only for a valid newer unattempted deployment', () => {
  const current = parseRelease({
    schemaVersion: 1,
    version: '0.1.0',
    buildId: 'one',
    publishedAt: '2026-10-16T07:14:00Z',
  });
  const newer = parseRelease({
    schemaVersion: 1,
    version: '0.1.1',
    buildId: 'two',
    publishedAt: '2026-10-16T07:15:00Z',
  });
  assert.ok(current && newer);
  assert.equal(shouldReload(current, newer, []), true);
  assert.equal(shouldReload(current, newer, ['two']), false);
  assert.equal(shouldReload(current, current, []), false);
  assert.equal(shouldReload(newer, current, []), false);
  assert.equal(shouldReload(current, null, []), false);
  assert.equal(
    parseRelease({ schemaVersion: 1, version: 'x', buildId: 'x', publishedAt: 'invalid' }),
    null,
  );
});

await test('published manifests match the current history entry and distinguish the sample preview', () => {
  const release: unknown = JSON.parse(
    readFileSync(new URL('../public/version.json', import.meta.url), 'utf8'),
  );
  const parsed = parseRelease(release);
  assert.ok(parsed);
  const history: unknown = JSON.parse(
    readFileSync(new URL('../public/changelog.json', import.meta.url), 'utf8'),
  );
  assert.ok(Array.isArray(history));
  const first: unknown = history[0];
  assert.ok(
    first !== null && typeof first === 'object' && 'version' in first && 'changes' in first,
  );
  assert.equal(first.version, parsed.version);
  assert.ok(Array.isArray(first.changes));
  assert.ok(
    first.changes.some((change: unknown) => typeof change === 'string' && /preview/i.test(change)),
  );
});

await test('compatible viewer preferences round-trip both map layers without world state', () => {
  const changed = {
    ...DEFAULT_PREFERENCES,
    borders: false,
    routes: false,
    selected: 3,
    paused: true,
    x: 2,
    z: -4,
    zoom: 1.5,
  };
  const stored: unknown = JSON.parse(JSON.stringify(changed));
  assert.deepEqual(parsePreferences(stored), changed);
  const oldSchema = parsePreferences({ schemaVersion: 1, zoom: 1.5 });
  assert.equal(oldSchema.borders, true);
  assert.equal(oldSchema.routes, true);
  const malformed = parsePreferences({ schemaVersion: 1, borders: 'false', routes: 0 });
  assert.equal(malformed.borders, true);
  assert.equal(malformed.routes, true);
});

await test('only a verified authoritative envelope becomes a live snapshot', () => {
  const state = createWorld(1701, '2026-10-16T08:14:00Z');
  const envelope = { ok: true, authoritative: true, initial: state, state };
  const read = parseWorldRead(envelope);
  assert.equal(read.kind, 'live');
  assert.deepEqual(parseWorldRead({ ...envelope, authoritative: false }), { kind: 'offline' });
  assert.deepEqual(parseWorldRead(state), { kind: 'offline' });
  assert.deepEqual(parseWorldRead({ ...envelope, initial: null }), { kind: 'offline' });
  assert.deepEqual(parseWorldRead({ ...envelope, state: { ...state, revision: -1 } }), { kind: 'offline' });
  assert.deepEqual(parseWorldRead({ ok: false, error: 'world_not_initialized' }), { kind: 'uninitialized' });
  assert.deepEqual(parseWorldRead(null), { kind: 'offline' });
});

await test('same-world reads cannot roll back a committed revision', () => {
  const state = createWorld(1701, '2026-10-16T08:14:00Z');
  const current = { identity: 'run-a', state: { ...state, revision: 4 } };
  assert.equal(acceptsSnapshot(null, current), true);
  assert.equal(acceptsSnapshot(current, current), true);
  assert.equal(acceptsSnapshot(current, { ...current, state: { ...state, revision: 3 } }), false);
  assert.equal(acceptsSnapshot(current, { identity: 'run-b', state }), true);
});

await test('live projection uses committed cities, terrain, ownership and buildings without sample routes', () => {
  const state = createWorld(1701, '2026-10-16T08:14:00Z');
  const city = state.cities[0];
  const civ = state.civilizations[0];
  assert.ok(city && civ);
  city.name = 'First Hearth';
  city.population = 9;
  city.buildings = ['farm'];
  const before = structuredClone(state);
  const world = projectWorld(state);
  assert.equal(world.illustrative, false);
  assert.equal(world.routes.length, 0);
  assert.equal(world.cities.length, state.cities.length);
  const projected = world.cities.find((entry) => entry.cityId === city.id);
  assert.ok(projected);
  assert.equal(projected.name, civ.name);
  assert.equal(projected.capital, city.name);
  assert.equal(projected.population, 9);
  assert.deepEqual(projected.buildings, ['farm']);
  assert.equal(projected.color, civ.color);
  assert.equal(world.tiles.length, state.tiles.filter((tile) => tile.terrain !== 'ocean').length);
  const tile = state.tiles.find((entry) => entry.id === city.tileId);
  assert.ok(tile);
  assert.ok(world.tiles.some((entry) => entry.q === projected.q && entry.r === projected.r && entry.owner === city.civId && entry.terrain === tile.terrain));
  assert.deepEqual(state, before);
  assert.equal(createPreviewWorld().illustrative, true);
});

await test('route endpoints follow city IDs while multiple cities retain one civilization row', () => {
  const state = createWorld(1701);
  const first = state.cities[0];
  const second = state.cities[1];
  assert.ok(first && second);
  state.cities.push({ ...first, id: 'second-hearth', name: 'Second Hearth' });
  state.routes.push({ id: 'route-live', from: 'second-hearth', to: second.id, owner: first.civId, partner: second.civId, active: true, damage: 0, volume: 2 });
  state.routes.push({ id: 'route-blocked', from: first.id, to: second.id, owner: first.civId, partner: second.civId, active: false, damage: 0, volume: 0 });
  const world = projectWorld(state);
  assert.deepEqual(world.routes, [[5, 1]]);
  assert.equal(uniqueCivilizations(world).length, 5);
  assert.equal(uniqueCivilizations(world)[0]?.capital, first.name);
});

await test('presentation labels format history and restrict colors to literal hex values', () => {
  assert.equal(formatYear(-10000), '10,000 BCE');
  assert.equal(formatYear(2030), '2,030 CE');
  assert.equal(capabilityName(0), ERAS[0]?.name);
  assert.equal(presentationColor('#aBc123'), '#aBc123');
  assert.equal(presentationColor('red;background:url(https://example.invalid)'), '#b9c9d6');
});


await test('city labels and hit areas retain a readable screen size at narrow zoom levels', () => {
  for (const scale of [4, 6, 9.8, 14, 25, 40]) {
    const metrics = cityScreenMetrics(scale);
    assert.ok(metrics.targetRadius * scale * 2 >= 44);
    assert.ok(metrics.labelFont * scale >= 12 - 1e-9);
    assert.ok(metrics.markerFont * scale >= 12 - 1e-9);
    assert.ok(metrics.labelY > metrics.markerRadius);
  }
});

await test('inspection anchor clears the heading and details at phone widths', () => {
  for (const width of [360, 390, 430, 500]) {
    const anchor = inspectionAnchor({ x: 0, y: 54, width, height: 665 }, 131, 232, width - 56);
    assert.ok(anchor.x * width > 44);
    assert.ok(anchor.x * width + 44 < width - 56);
    const y = 54 + anchor.y * 665;
    assert.ok(y - 22 > 131);
    assert.ok(y + 30 < 232);
  }
});

await test('one camera-plane shift places both flat and tilted 3D cities at the safe anchor', () => {
  const anchor = { x: 0.42, y: 0.18 };
  for (const width of [360, 390, 430, 500]) {
    for (const zoom of [0.65, 1, 2.2]) {
      const height = 665;
      const worldHeight = 52 / zoom;
      const worldWidth = worldHeight * width / height;
      const current = { x: 0.75, y: 0.72 };
      const flat = cameraShiftForAnchor(current, anchor, { x: 1 / worldWidth, y: 0 }, { x: 0, y: 1 / worldHeight });
      assert.ok(Math.abs(current.x - flat.x / worldWidth - anchor.x) < 1e-9);
      assert.ok(Math.abs(current.y - flat.z / worldHeight - anchor.y) < 1e-9);
      const camera = new THREE.OrthographicCamera(-24 * width / height, 24 * width / height, 24, -24, 0.1, 160);
      camera.position.set(19, 29, 31);
      camera.zoom = zoom;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const point = new THREE.Vector3(8, 2, 6);
      const screen = (p: THREE.Vector3): { x: number; y: number } => { const n = p.clone().project(camera); return { x: (n.x + 1) / 2, y: (1 - n.y) / 2 }; };
      const start = screen(point);
      const unitX = screen(point.clone().add(new THREE.Vector3(1, 0, 0)));
      const unitZ = screen(point.clone().add(new THREE.Vector3(0, 0, 1)));
      const shift = cameraShiftForAnchor(start, anchor, { x: unitX.x - start.x, y: unitX.y - start.y }, { x: unitZ.x - start.x, y: unitZ.y - start.y });
      camera.position.add(new THREE.Vector3(shift.x, 0, shift.z));
      camera.updateMatrixWorld();
      assert.ok(Math.abs(screen(point).x - anchor.x) < 1e-9);
      assert.ok(Math.abs(screen(point).y - anchor.y) < 1e-9);
    }
  }
});

await test('inspection restores the original camera, but respects manual navigation', () => {
  const session = createInspectionSession();
  const original = { x: 2, z: -4, zoom: 1.2 };
  const focused = { x: 9, z: 12, zoom: 1.2 };
  session.begin(original);
  session.begin(focused);
  assert.deepEqual(session.savedCamera(focused), original);
  assert.deepEqual(session.end(), original);
  assert.equal(session.end(), null);
  session.begin(original);
  session.release();
  assert.deepEqual(session.savedCamera(focused), focused);
  assert.equal(session.end(), null);
});


await test('renderer projection carries exact committed settlement facts and normalized terrain height', () => {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  city.buildings = ['farm', 'workshop'];
  city.wellbeing = 34;
  city.damage = 12;
  const land = state.tiles.filter((tile) => tile.terrain !== 'ocean');
  assert.ok(land[0] && land[1]);
  land[0].elevation = 0;
  land[1].elevation = 99;
  const world = projectWorld(state);
  assert.deepEqual(world.cities[0]?.settlement, { id: city.id, civId: city.civId, tileId: city.tileId, name: city.name,
    population: city.population, wellbeing: 34, damage: 12, buildings: ['farm', 'workshop'] });
  assert.equal(world.tiles.find((tile) => tile.id === land[0]?.id)?.height, .25);
  assert.equal(world.tiles.find((tile) => tile.id === land[1]?.id)?.height, .25 + .99 * .22);
});

await test('shared original solids have outward triangles and finite SVG faces', () => {
  for (const shape of ['box', 'gable', 'cylinder'] as const) {
    const triangles = shapeTriangles(shape);
    assert.equal(triangles.length % 9, 0);
    let volume = 0;
    for (let index = 0; index < triangles.length; index += 9) {
      const a = new THREE.Vector3().fromArray(triangles, index);
      const b = new THREE.Vector3().fromArray(triangles, index + 3);
      const c = new THREE.Vector3().fromArray(triangles, index + 6);
      volume += a.dot(b.cross(c)) / 6;
    }
    assert.ok(volume > 0, `${shape} must face outward`);
    const part = { id: shape, shape, material: 'plaster' as const, position: [2, 3, 4] as const, scale: [1, 2, 3] as const, rotation: Math.PI / 2 };
    assert.ok(transformedVertices(part).every((vertex) => vertex.every(Number.isFinite)));
    assert.ok(flatPartFaces(part).every((face) => face.points.length > 0 && !face.points.includes('NaN')));
  }
});

await test('Three settlement instances use only active detail and reuse their geometry', () => {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  city.buildings = ['farm', 'workshop'];
  city.population = 30;
  const world = projectWorld(state);
  const material = new THREE.MeshBasicMaterial();
  const meshes = createSettlementMeshes(world, () => material);
  assert.equal(meshes.update(60), 'close');
  const count = (): number => meshes.group.children.reduce((sum, child) => sum + (child instanceof THREE.InstancedMesh ? child.count : 0), 0);
  const closeCount = count();
  assert.equal(closeCount, state.cities.reduce((sum, entry) => sum + settlementVisual(entry, 'close').parts.length, 0));
  const first = meshes.group.children[0];
  meshes.update(58);
  assert.equal(meshes.group.children[0], first);
  assert.equal(meshes.update(18), 'far');
  assert.ok(count() < closeCount);
  assert.equal(count(), state.cities.reduce((sum, entry) => sum + settlementVisual(entry, 'far').parts.length, 0));
  assert.ok(meshes.group.children.every((child) => child instanceof THREE.InstancedMesh && child.boundingSphere !== null));
  meshes.dispose();
  assert.equal(meshes.group.children.length, 0);
  material.dispose();
});

await test('screen-space label budget prioritizes the selected city and avoids crowded names', () => {
  const crowded = Array.from({ length: 20 }, (_, id) => ({ id, x: 100 + id, y: 100, width: 80, height: 16 }));
  const result = mapLabelVisibility(crowded, 19, 'far', 500, 700);
  assert.equal(result[19], true);
  assert.equal(result.filter(Boolean).length, 1);
  const five = Array.from({ length: 5 }, (_, id) => ({ id, x: 50 + id * 95, y: 100, width: 60, height: 16 }));
  assert.equal(mapLabelVisibility(five, 3, 'far', 500, 700).filter(Boolean).length, 5);
});

await test('meaningful changes stay visible after clock bookkeeping and independent status uses its real beat', () => {
  const state = createWorld(1701);
  const building: GameEvent = { id: 'new-building', round: 2, type: 'building-completed', title: 'New farm', detail: 'Farm built', actor: 0, target: null, tileId: state.cities[0]?.tileId ?? null, cause: 'Paid construction', effects: ['Seasonal food +4'], importance: 3 };
  const clock: GameEvent = { ...building, id: 'clock', type: 'clock-advanced', title: 'Clock advances', effects: [] };
  assert.equal(latestMeaningfulEvent([building, clock]), building);
  assert.equal(latestMeaningfulEvent([clock]), clock);
  assert.equal(latestMeaningfulEvent([]), undefined);
  state.independentTurns = { epoch: '2026-10-16T10:00:00Z', strategyTicks: 7, lastActionWindow: [], actionsInWindow: [] };
  assert.equal(activityLabel(state), 'Economy beat 7 · Civilizations act independently');
  const visual = eventVisual(building);
  assert.ok(visual && visual.deltas[0]);
  assert.equal(deltaNumber(visual.deltas[0]), '+4 / season');
  const anchor = eventAnchor(projectWorld(state), visual);
  assert.ok(anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.z));
  assert.equal(eventAnchor(projectWorld(state), { ...visual, tileId: null, actor: 5, target: null }), null);
});
