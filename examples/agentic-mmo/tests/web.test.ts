import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, resolveCitySelection, selectedCity, retainedReceiptBuilding } from '../web/city-selection.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { cameraShiftForAnchor, createInspectionSession, inspectionAnchor } from '../web/inspection-camera.ts';
import * as THREE from 'three';
import { cityScreenMetrics } from '../web/flat-renderer.ts';
import { ERAS, RESOURCE_IDS } from '../core/content.ts';
import { VIEWER_PALETTES, resolveAppearance, resourceGuide } from '../web/viewer-appearance.ts';
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
  MAP_ZOOM,
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
  assert.equal(preferences.zoom, MAP_ZOOM.maximum);
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

await test('published manifests match meaningful current history and sample mode stays explicit', () => {
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
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /Sample atlas/);
  assert.match(main, /ILLUSTRATIVE MAP/);
  assert.ok(Array.isArray(first.changes));
  assert.ok(
    first.changes.length > 0 && first.changes.every((change: unknown) => typeof change === 'string' && change.trim().length > 0),
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
  assert.deepEqual(world.routes.map((route) => [route.id, route.from, route.to]), [['route-live', 'second-hearth', second.id], ['route-blocked', first.id, second.id]]);
  assert.equal(world.routes[0]?.fromTown?.name, 'Second Hearth');
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
  city.buildings = ['farm', 'workshop', 'irrigation', 'kiln'];
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

await test('viewer appearance preserves old saves and safely parses explicit choices', () => {
  const old = parsePreferences({ schemaVersion: 1, zoom: 1.5, selected: 3, paused: true, routes: false });
  assert.equal(old.theme, 'system');
  assert.equal(old.effects, 'calm');
  assert.equal(old.zoom, 1.5);
  assert.equal(old.selected, 3);
  assert.equal(old.routes, false);
  assert.equal(parsePreferences({ schemaVersion: 1, effects: 'unknown', theme: '<script>' }).theme, 'system');
  assert.equal(parsePreferences({ schemaVersion: 1, effects: 'unknown' }).effects, 'rich');
  for (const theme of ['system', 'light', 'dark'] as const) {
    for (const effects of ['calm', 'rich', 'cinematic'] as const) {
      const preferences = { ...DEFAULT_PREFERENCES, theme, effects, x: 4, z: -3, borders: false };
      assert.deepEqual(parsePreferences(JSON.parse(JSON.stringify(preferences))), preferences);
    }
  }
});

await test('system theme follows the device and reduced motion overrides every effects level', () => {
  for (const systemDark of [false, true]) {
    for (const theme of ['system', 'light', 'dark'] as const) {
      for (const effects of ['calm', 'rich', 'cinematic'] as const) {
        const expected = theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
        assert.deepEqual(resolveAppearance({ theme, effects }, systemDark, false), {
          theme: expected, effects, motion: effects !== 'calm',
        });
        assert.deepEqual(resolveAppearance({ theme, effects }, systemDark, true), {
          theme: expected, effects: 'calm', motion: false,
        });
      }
    }
  }
});

function luminance(color: string): number {
  const values = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return (values[0] ?? 0) * .2126 + (values[1] ?? 0) * .7152 + (values[2] ?? 0) * .0722;
}

function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

await test('both shared palettes meet text and key control contrast targets', () => {
  for (const palette of Object.values(VIEWER_PALETTES)) {
    for (const background of [palette.paper, palette.panel, palette.surface, palette.selection]) {
      assert.ok(contrastRatio(palette.ink, background) >= 4.5, `${palette.ink} on ${background}`);
      assert.ok(contrastRatio(palette.muted, background) >= 4.5, `${palette.muted} on ${background}`);
      assert.ok(contrastRatio(palette.gold, background) >= 3, `focus on ${background}`);
      assert.ok(contrastRatio(palette.border, background) >= 3, `control edge on ${background}`);
    }
    assert.ok(contrastRatio(palette.positive, palette['positive-surface']) >= 4.5);
    assert.ok(contrastRatio(palette.negative, palette['negative-surface']) >= 4.5);
    assert.ok(contrastRatio(palette['cue-ink'], palette['cue-paper']) >= 4.5);
    assert.ok(contrastRatio(palette['cue-border'], palette['cue-paper']) >= 3);
  }
});

await test('each current resource has one short plain-language guide and shared label', () => {
  for (const resource of RESOURCE_IDS) {
    const guide = resourceGuide(resource);
    assert.equal(guide.label.toLowerCase(), resource);
    assert.ok(guide.explanation.length > 20 && guide.explanation.length < 100);
    assert.ok(!/[<>]/.test(guide.explanation));
  }
});


await test('production quantities are not formatted as net stock gains', () => {
  const production = eventVisual({ id: 'production:1', type: 'settlement-production', round: 1, actor: 0, target: null, tileId: null, importance: 1, title: 'Working season', cause: 'Production', detail: 'Production', effects: ['Produced 13.28 food'] });
  const fact = production?.deltas[0];
  assert.ok(fact);
  assert.equal(fact.kind, 'production');
  assert.equal(deltaNumber(fact), '13.28');
  assert.equal(fact.qualifier, 'produced before costs');
});


await test('a frontier town keeps its canonical selection without adding a civilization dock row', () => {
  const state = createWorld(1701);
  const first = state.cities[0];
  const tile = state.tiles.find((entry) => entry.terrain !== 'ocean' && !state.cities.some((city) => city.tileId === entry.id));
  assert.ok(first && tile);
  state.cities.push({ ...first, id: 'frontier-town', name: 'Riverbend', tileId: tile.id });
  const world = projectWorld(state);
  const town = world.cities.find((city) => city.cityId === 'frontier-town');
  assert.ok(town);
  const preferences = { ...DEFAULT_PREFERENCES, selectedCity: cityKey(town) };
  assert.equal(selectedCity(world, preferences), town);
  assert.deepEqual(resolveCitySelection(world, preferences), { selected: first.civId, selectedCity: 'frontier-town' });
  assert.equal(uniqueCivilizations(world).length, 5);
  assert.notDeepEqual(hexPosition(town.q, town.r), hexPosition(world.cities[0]?.q ?? 0, world.cities[0]?.r ?? 0));
  const labels = world.cities.map((city) => ({ id: cityKey(city), x: 100, y: 100, width: 80, height: 14 }));
  const visible = mapLabelVisibility(labels, cityKey(town), 'far', 500, 700);
  assert.equal(visible[5], true);
  assert.equal(visible[0], false);
  assert.deepEqual(parsePreferences(JSON.parse(JSON.stringify(preferences))), preferences);
  assert.equal(resolveCitySelection(world, { selected: first.civId, selectedCity: 'removed-town' }).selectedCity, first.id);
  assert.equal(resolveCitySelection(world, { selected: 99, selectedCity: null }).selectedCity, first.id);
  assert.deepEqual(resolveCitySelection({ cities: [], tiles: [], routes: [] }, preferences), { selected: 0, selectedCity: null });
  assert.equal(parsePreferences({ schemaVersion: 1, selectedCity: 77 }).selectedCity, null);
  assert.equal(parsePreferences({ schemaVersion: 1, selectedCity: 'x'.repeat(161) }).selectedCity, null);
  const preview = createPreviewWorld();
  assert.equal(resolveCitySelection(preview, { selected: 2, selectedCity: first.id }).selectedCity, 'sample:2');
});

await test('operation projection deeply copies optional historical receipts and exact resource values', () => {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  city.buildings.push('irrigation');
  city.buildingOperations = { irrigation: { enabled: false, lastResult: { round: 9, status: 'blocked', paid: {}, produced: {}, shortages: [{ resource: 'materials', required: 1, available: .75 }] } } };
  const projected = projectWorld(state).cities[0]?.settlement?.buildingOperations;
  assert.deepEqual(projected, city.buildingOperations);
  assert.notEqual(projected, city.buildingOperations);
  const receipt = projected?.['irrigation']?.lastResult;
  assert.ok(receipt && receipt.shortages[0]);
  receipt.shortages[0].available = 99;
  assert.equal(city.buildingOperations['irrigation']?.lastResult?.shortages[0]?.available, .75);
});

await test('paid input chips cannot be mistaken for produced goods or a net resource gain', () => {
  const visual = eventVisual({ id: 'operation', round: 9, type: 'building-operation', title: 'Kiln operated', detail: 'hearth/kiln at strategic round 9', actor: 0, target: 0, tileId: 1, cause: 'Recipe paid', effects: ['Paid 2 energy', 'Produced 3.5 materials'], importance: 1 });
  assert.ok(visual?.deltas[0] && visual.deltas[1]);
  assert.equal(deltaNumber(visual.deltas[0]), '2');
  assert.equal(visual.deltas[0].kind, 'payment');
  assert.equal(deltaNumber(visual.deltas[1]), '3.5');
  assert.equal(visual.deltas[1].kind, 'production');
});


await test('receipt keyboard focus is retained by building only within the same selected town', () => {
  assert.equal(retainedReceiptBuilding('frontier-town', 'frontier-town', 'kiln'), 'kiln');
  assert.equal(retainedReceiptBuilding('frontier-town', 'frontier-town', 'irrigation'), 'irrigation');
  assert.equal(retainedReceiptBuilding('capital', 'frontier-town', 'kiln'), null);
  assert.equal(retainedReceiptBuilding('frontier-town', 'capital', 'kiln'), null);
  assert.equal(retainedReceiptBuilding(null, null, 'kiln'), null);
  assert.equal(retainedReceiptBuilding('frontier-town', 'frontier-town', undefined), null);
});


await test('damage labels retain readable screen metrics and real repair cues anchor to the exact town', () => {
  assert.equal(damageMapLabel('New Haven', 10.25), 'New Haven · 10.25% damage');
  const world = projectWorld(createWorld(1701));
  const city = world.cities[1];
  const tile = world.tiles.find((entry) => entry.q === city?.q && entry.r === city?.r);
  assert.ok(city && tile && tile.id !== undefined);
  const repaired = eventVisual({ id: 'repair', round: 9, type: 'city-repaired', title: 'City repaired', detail: 'Exact town', actor: 0, target: 0, tileId: tile.id, cause: 'Paid recovery', effects: ['City damage 10 → 0', 'Paid 5 materials', 'Paid 2 energy'], importance: 3 });
  assert.ok(repaired?.deltas[0]);
  assert.equal(deltaNumber(repaired.deltas[0]), '−10');
  assert.equal(eventAnchor(world, repaired)?.key, `tile:${tile.id}`);
  for (const scale of [6, 12, 24, 48]) {
    const metrics = cityScreenMetrics(scale);
    assert.ok(metrics.targetRadius * scale * 2 >= 44);
    assert.ok(metrics.labelFont * scale >= 12);
  }
  assert.ok(contrastRatio('#ffe0b5', '#1c3738') >= 4.5);
  assert.ok(contrastRatio('#efaa79', '#153d54') >= 3);
});

await test('compact desktop story is height-scoped and retains scrolling numbers and a large history target', () => {
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  const compactStart = css.indexOf('@media (min-width: 1001px) and (max-height: 850px)');
  const compact = css.slice(compactStart, css.indexOf('\n}', compactStart) + 2);
  const declarations = (selector: string): Map<string, string> => {
    const start = compact.indexOf(`${selector} {`);
    assert.ok(start >= 0);
    const block = compact.slice(compact.indexOf('{', start) + 1, compact.indexOf('}', start));
    return new Map(block.split(';').filter((entry) => entry.trim()).map((entry) => {
      const colon = entry.indexOf(':');
      return [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()];
    }));
  };
  assert.ok(compact.startsWith('@media (min-width: 1001px) and (max-height: 850px)'));
  const card = declarations('.live-observatory .chronicle');
  assert.equal(card.get('overflow'), 'auto');
  assert.equal(Number.parseInt(card.get('max-height') ?? ''), 126);
  assert.equal(Number.parseInt(card.get('bottom') ?? ''), 28);
  const history = declarations('.live-observatory #events-open');
  assert.ok(Number.parseInt(history.get('min-height') ?? '') >= 44);
  assert.ok(Number.parseInt(history.get('min-width') ?? '') >= 44);
  assert.equal(history.get('grid-row'), '1 / 3');
  assert.equal(declarations('.live-observatory .chronicle .story-deltas').get('grid-column'), '1 / -1');
  assert.ok(Number.parseInt(declarations('.live-observatory .chronicle #event-title').get('font-size') ?? '') >= 16);
  assert.ok(!compact.includes('.inspection'));
});

await test('the committed inspector wires canonical exact-town capability projection and semantic history', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(main, /projectCapabilities\(snapshot\.state, civilization\.id, preferences\.selectedCity, observedAt\)/);
  assert.match(main, /runId: snapshot\.identity/);
  assert.match(main, /towns: snapshot\.state\.cities\.filter\(city => city\.civId === civilization\.id\)/);
  assert.match(main, /if \(!snapshot \|\| mode === 'sample' \|\| !observedAt\) return null/);
  assert.match(main, /capabilityTree\.observe\(input\)/);
  assert.match(main, /capabilityTree\.open\(input, treeOpener\)/);
  assert.match(main, /renderEventLog\(element\('#event-list'\), events/);
  assert.doesNotMatch(main, /element\('#event-list'\)\.innerHTML/);
  assert.match(main, /if \(dialogs\.get\('events'\)\?\.open && !eventHistoryCaptured\) renderEventHistory\(\)/);
  assert.match(main, /const quiet = document\.hidden \|\| dialogs\.get\('events'\)\?\.open \|\| capabilityDialog\?\.open/);
  assert.match(html, /web\/event-log\.css/);
  assert.match(html, /web\/capability-tree\.css/);
});

await test('Events remains a primary navigation control and returns focus to its actual opener', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const navigation = main.slice(main.indexOf('<nav class="top-nav"'), main.indexOf('</nav>'));
  assert.match(navigation, /id="events-nav"[^>]*data-open-events[^>]*>Events</);
  assert.match(main, /querySelectorAll<HTMLButtonElement>\('\[data-open-events\]'\)/);
  assert.match(main, /eventHistoryOpener = button/);
  assert.match(main, /eventHistoryOpener\?\.focus\(\{ preventScroll: true \}\)/);
});

await test('small spectator layout keeps named dock and all story facts reachable without vertical clipping', () => {
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  const responsive = css.slice(css.indexOf('@media (max-width: 1000px)', css.indexOf('.events-nav:focus-visible')));
  assert.match(responsive, /\.civilization-row\s*\{[^}]*flex-direction: column/);
  assert.match(responsive, /\.civilization-row strong\s*\{[^}]*white-space: nowrap/);
  assert.match(responsive, /\.chronicle \.story-deltas\s*\{[^}]*flex-wrap: nowrap[^}]*overflow-x: auto/);
  assert.match(responsive, /\.map-tools\s*\{[^}]*flex-direction: row/);
  assert.match(responsive, /\.layer-controls\s*\{[^}]*display: none/);
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /class="settings-layers"[\s\S]*?data-layer="borders"[\s\S]*?data-layer="routes"/);
});

await test('explicit selected-town zoom reuses inspection framing while direct pan remains manual', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const zoom = main.slice(main.indexOf("for (const [id, factor]"), main.indexOf("element('#reset-camera')"));
  assert.match(zoom, /atlas\?\.zoom\(factor\); frameInspection\(\);/);
  assert.doesNotMatch(zoom, /inspectionCamera\.release/);
  assert.match(main, /Math\.hypot[\s\S]*?inspectionCamera\.release\(\)/);
});

await test('overview and close zoom bounds persist with old compatible preferences', () => {
  for (const zoom of [.25, .65, 1, 2.2, 4]) assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, zoom }).zoom, zoom);
  assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, zoom: -5 }).zoom, MAP_ZOOM.minimum);
  assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, zoom: Infinity }).zoom, 1);
});

await test('shared map hierarchy keeps exact town, constructed site and selected civilization reveal identity', async () => {
  const { mapHierarchyAnchors } = await import('../web/map-labels.ts');
  const world = createPreviewWorld();
  const first = world.cities[0]; assert.ok(first);
  world.cities[0] = { ...first, cityId: 'exact-town', population: 12 };
  world.pastoralSites = [{ id: 'horses:5', tileId: 5, q: 0, r: 0, height: 0, revealedTo: [1] }];
  const before = structuredClone(world);
  const anchors = mapHierarchyAnchors(world, 'exact-town', null, (q, r) => ({ x: q, y: r }));
  assert.equal(anchors.find(item => item.id === 'exact-town')?.selected, true);
  assert.equal(anchors.find(item => item.id === 'horses:5')?.revealed, false);
  assert.deepEqual(world, before);
});

await test('retained atlas tile identities carry only a uniform projection recentering', async () => {
  const { atlasCoordinateShift } = await import('../web/atlas.ts');
  const before = createPreviewWorld(); before.tiles.forEach((tile, index) => { tile.id = index; });
  const after = structuredClone(before); after.tiles.forEach(tile => { tile.r -= 6; });
  const shift = atlasCoordinateShift(before, after); assert.ok(shift);
  assert.ok(Math.abs(shift.x + Math.sqrt(3) * 3) < 1e-8); assert.equal(shift.z, -9);
  const first = after.tiles[0]; assert.ok(first); assert.equal(before.tiles[0]?.r, first.r + 6);
});

await test('the version-labelled Changelog control opens the existing history dialog', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /id="world-info-open"[^>]*data-open-changelog/);
  assert.doesNotMatch(main, /id="changelog-open"/);
  assert.match(main, /releaseHistoryOpener\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(main, /querySelectorAll<HTMLButtonElement>\('\[data-open-changelog\]'\)/);
  assert.doesNotMatch(main, /element\('#world-info-open'\)\.addEventListener\('click', \(\) => \{ window.location.hash = 'about'/);
});

await test('release history keeps six newest-first records per page without mutating or losing older entries', async () => {
  const { releaseHistoryPage } = await import('../web/viewer-state.ts');
  const entries = Array.from({ length: 23 }, (_, index) => ({ version: 23 - index }));
  const before = structuredClone(entries);
  assert.deepEqual(releaseHistoryPage(entries, 0).entries.map(entry => entry.version), [23, 22, 21, 20, 19, 18]);
  assert.deepEqual(releaseHistoryPage(entries, 1).entries.map(entry => entry.version), [17, 16, 15, 14, 13, 12]);
  const last = releaseHistoryPage(entries, 100);
  assert.equal(last.page, 3);
  assert.deepEqual(last.entries.map(entry => entry.version), [5, 4, 3, 2, 1]);
  assert.equal(releaseHistoryPage(entries, -5).page, 0);
  assert.equal(releaseHistoryPage(entries, NaN).page, 0);
  assert.deepEqual(releaseHistoryPage([], 9), { page: 0, pages: 1, total: 0, start: 0, end: 0, entries: [] });
  assert.deepEqual(entries, before);
});

await test('narrow Work leaves a selected-town window and culled site geometry is not a phantom control', () => {
  const css = readFileSync(new URL('../web/spectator-hud.css', import.meta.url), 'utf8');
  const responsive = css.slice(css.indexOf('@media (max-width: 1000px) {'));
  const work = /#app \.inspection, #app \.inspection\[data-inspection-view='work'\] \{([^}]+)\}/.exec(responsive)?.[1];
  assert.ok(work);
  const viewportBound = /max-height: min\((\d+)dvh/.exec(work)?.[1];
  assert.ok(viewportBound && Number(viewportBound) <= 48);
  assert.match(work, /bottom: 118px/);
  assert.match(responsive, /#app \.live-observatory\[data-inspection='true'\] \.chronicle \{ display: none/);
  assert.match(responsive, /#app \.live-observatory\[data-inspection='true'\] \.world-heading \{ display: block/);
  const flat = readFileSync(new URL('../web/flat-renderer.ts', import.meta.url), 'utf8');
  assert.match(flat, /entry\.element\.setAttribute\('aria-hidden', String\(!mark\)\)/);
});
