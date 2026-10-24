import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { HexTile, WorldState } from '../core/types.ts';
import type { DrainageLayerV1 } from '../core/drainage.ts';
import { projectDrainage } from '../visuals/drainage-visuals.ts';
import { hexPosition, projectTerrainSurface, projectLandscape, DRAINAGE_STYLE, LANDSCAPE_COLORS } from '../visuals/landscape.ts';
import type { LandscapeTile, TerrainPoint } from '../visuals/landscape.ts';
import { mapTileHeight } from '../visuals/route-paths.ts';
import { createTerrainMeshes } from '../web/landscape-three.ts';
import { createFlatTerrainLayer } from '../web/flat-renderer.ts';
import { flatMapPoint } from '../web/settlement-parts.ts';

const steps = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

function fixture(): Pick<WorldState, 'tiles' | 'width' | 'height' | 'drainage'> {
  const width = 11; const height = 19;
  const tiles: HexTile[] = Array.from({ length: width * height }, (_, id) => {
    const q = id % width; const r = Math.floor(id / width);
    return { id, q, r, terrain: q === width - 1 ? 'ocean' : 'grassland', elevation: q === width - 1 ? 5 : 40 + 9 - q + Math.abs(r - 9) * 2, owner: null, resource: null };
  });
  const downstreamTileIds = tiles.map(tile => tile.terrain === 'ocean' ? null : tiles.filter(other => steps.some(([q, r]) => other.q === tile.q + q && other.r === tile.r + r) && other.elevation < tile.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id)[0]!.id);
  const drainage: DrainageLayerV1 = { ruleVersion: 1, width, height, terrainBasis: tiles.map(tile => [tile.terrain, tile.elevation * 4096]), downstreamTileIds };
  return { tiles, width, height, drainage };
}

function atlasTiles(state: ReturnType<typeof fixture>): LandscapeTile[] {
  return state.tiles.flatMap(tile => tile.terrain === 'ocean' ? [] : [{ id: tile.id, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, owner: tile.owner, terrain: tile.terrain, height: mapTileHeight(tile.elevation) }]);
}

function pointKey(point: TerrainPoint): string { return point.map(value => value.toFixed(12)).join(','); }

await test('retained drainage projects exact bent and joining edges and real sea mouths without mutation', () => {
  const state = fixture(); const before = structuredClone(state);
  const view = projectDrainage(state);
  assert.equal(view?.kind, 'retained'); assert.ok(view && view.kind === 'retained');
  const counts = Array.from({ length: state.tiles.length }, () => 0);
  for (const tile of state.tiles) {
    if (tile.terrain === 'ocean') continue;
    let id = tile.id;
    while (state.tiles[id]!.terrain !== 'ocean') { counts[id]!++; id = state.drainage!.downstreamTileIds[id]!; }
  }
  const expected = state.tiles.filter(tile => tile.terrain !== 'ocean' && counts[tile.id]! >= 8).map(tile => `drainage:1:${tile.id}:${state.drainage!.downstreamTileIds[tile.id]}`);
  assert.deepEqual(view.edges.map(edge => edge.id), expected);
  const bend = [7 * 11 + 2, 8 * 11 + 2, 9 * 11 + 2, 9 * 11 + 3];
  for (let index = 0; index < bend.length - 1; index++) assert.ok(view.edges.some(edge => edge.fromTileId === bend[index] && edge.toTileId === bend[index + 1]));
  assert.ok(view.edges.filter(edge => edge.toTileId === 9 * 11 + 3).length >= 2);
  for (const edge of view.edges) {
    const from = state.tiles[edge.fromTileId]!; const to = state.tiles[edge.toTileId]!;
    const a = hexPosition(from.q - 5, from.r - 9); const b = hexPosition(to.q - 5, to.r - 9);
    assert.deepEqual(edge.points[0], [a.x, mapTileHeight(from.elevation), a.z]);
    assert.deepEqual(edge.points[1], to.terrain === 'ocean' ? [(a.x + b.x) / 2, 0, (a.z + b.z) / 2] : [b.x, mapTileHeight(to.elevation), b.z]);
    assert.equal(edge.contributingLandTiles, counts[from.id]);
    let outlet = from.id;
    while (state.tiles[outlet]!.terrain !== 'ocean') outlet = state.drainage!.downstreamTileIds[outlet]!;
    assert.equal(edge.outletTileId, outlet);
    assert.ok(edge.points[0][1] > edge.points[1][1]);
  }
  assert.ok(view.edges.some(edge => edge.mouth));
  assert.ok(view.edges.length <= state.tiles.length);
  assert.deepEqual(projectDrainage(state), view); assert.deepEqual(state, before);
});

await test('absent layers are absent and malformed or stale layers never invent rivers', () => {
  const state = fixture(); const absent = { tiles: state.tiles, width: state.width, height: state.height };
  assert.equal(projectDrainage(absent), null);
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.tiles[0]!.elevation += 1 / 4096; },
    (value: ReturnType<typeof fixture>) => { value.drainage!.downstreamTileIds[0] = 0; },
    (value: ReturnType<typeof fixture>) => { value.drainage!.terrainBasis.pop(); },
  ]) {
    const invalid = structuredClone(state); mutate(invalid);
    const view = projectDrainage(invalid);
    assert.equal(view?.kind, 'unavailable'); assert.deepEqual(view?.edges, []); assert.ok(view?.reason);
    assert.deepEqual(projectTerrainSurface(atlasTiles(invalid), view), projectTerrainSurface(atlasTiles(invalid)));
  }
});

await test('shared cuts replace uphill averaged rims, join bends and confluences, and open the real shoreline', () => {
  const state = fixture(); const tiles = atlasTiles(state); const before = structuredClone(tiles); const view = projectDrainage(state)!;
  assert.equal(view.kind, 'retained');
  const surfaces = projectTerrainSurface(tiles, view); const byId = new Map(tiles.map(tile => [tile.id, surfaces.find(surface => surface.key === `${tile.q},${tile.r}`)!]));
  for (const edge of view.edges) {
    const from = byId.get(edge.fromTileId)!; const to = byId.get(edge.toTileId);
    const sourceWater = edge.points[0][1] - DRAINAGE_STYLE.depth;
    const endWater = edge.mouth ? 0 : edge.points[1][1] - DRAINAGE_STYLE.depth;
    const seamWater = edge.mouth ? 0 : (sourceWater + endWater) / 2;
    const water = from.faces.filter(face => face.kind === 'channel' && face.drainageEdgeId === edge.id);
    assert.ok(water.length > 0, edge.id);
    assert.ok(water.every(face => face.points.every(point => point[1] <= sourceWater + 1e-12 && point[1] >= seamWater - 1e-12)));
    const seamX = edge.mouth ? edge.points[1][0] : (edge.points[0][0] + edge.points[1][0]) / 2;
    const seamZ = edge.mouth ? edge.points[1][2] : (edge.points[0][2] + edge.points[1][2]) / 2;
    const seam = from.edgeRims.find(points => points.length > 2 && Math.abs((points[2]![0] + points[3]![0]) / 2 - seamX) < 1e-10 && Math.abs((points[2]![2] + points[3]![2]) / 2 - seamZ) < 1e-10);
    if (seam) {
      assert.ok(Math.abs(seam[2]![1] - seamWater) < 1e-12);
      assert.ok(seam[1]![1] > seam[2]![1] && seam[4]![1] > seam[3]![1]);
      const width = Math.hypot(seam[3]![0] - seam[2]![0], seam[3]![2] - seam[2]![2]) / 2;
      assert.ok(width >= DRAINAGE_STYLE.minHalfWidth - 1e-10 && width <= DRAINAGE_STYLE.maxHalfWidth + 1e-10);
    }
    assert.ok(seam, edge.id);
    if (to) {
      const destination = to.edgeRims.find(points => pointKey(points[0]!) === pointKey(seam.at(-1)!) && pointKey(points.at(-1)!) === pointKey(seam[0]!));
      assert.ok(destination, edge.id); assert.deepEqual(destination.toReversed(), seam);
      assert.ok(to.faces.some(face => face.kind === 'channel' && face.drainageEdgeId === edge.id));
    } else {
      assert.equal(edge.mouth, true);
      const mouthPoints = seam.filter(point => point[1] === 0);
      assert.ok(mouthPoints.length >= 2);
      const opening = { x: (mouthPoints[0]![0] + mouthPoints[1]![0]) / 2, z: (mouthPoints[0]![2] + mouthPoints[1]![2]) / 2 };
      assert.ok(!projectLandscape(tiles, [], 'far', view).coast.some(edge => {
        const a = Math.hypot(edge.from[0] - opening.x, edge.from[1] - opening.z);
        const b = Math.hypot(edge.to[0] - opening.x, edge.to[1] - opening.z);
        const length = Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
        return Math.abs(a + b - length) < 1e-10;
      }));
      assert.ok(!from.cliffs.some(face => mouthPoints.every(point => face.points.some(vertex => pointKey(vertex) === pointKey(point)))));
    }
  }
  for (const surface of surfaces) {
    const water = surface.faces.filter(face => face.kind === 'channel');
    if (!water.length) continue;
    const center = water.find(face => face.key.endsWith(':join:0'));
    assert.ok(center);
    const channelVertices = new Set(water.flatMap(face => face.points.map(pointKey)));
    assert.ok(surface.faces.filter(face => face.kind === 'bank').every(face => face.points.some(point => channelVertices.has(pointKey(point)))));
    assert.ok(surface.faces.length <= 66);
    const area = surface.faces.reduce((total, face) => total + Math.abs(face.points.reduce((sum, point, index) => { const next = face.points[(index + 1) % face.points.length]!; return sum + point[0] * next[2] - next[0] * point[2]; }, 0)) / 2, 0);
    assert.ok(Math.abs(area - 3 * Math.sqrt(3) / 2) < 1e-9, `${surface.key}: partition covers the original hex once`);
  }
  assert.deepEqual(tiles, before);
  for (const detail of ['far', 'mid', 'close'] as const) assert.deepEqual(projectLandscape(tiles, [], detail, view).coast, projectLandscape(tiles, [], 'far', view).coast);
});

await test('actual SVG and Three terrain consumers receive the identical retained water and bank vertices', () => {
  const state = fixture(); const tiles = atlasTiles(state); const drainage = projectDrainage(state)!;
  const surfaces = projectTerrainSurface(tiles, drainage);
  const faces = surfaces.flatMap(tile => [...tile.faces, ...tile.cliffs]);
  const expected = faces.flatMap(face => Array.from({ length: face.points.length - 2 }, (_, index) => [face.points[0]!, face.points[index + 2]!, face.points[index + 1]!]).flat()).map(point => point.map(Math.fround).join(',')).sort();
  const meshes = createTerrainMeshes(tiles, drainage);
  const received = meshes.children.flatMap(child => {
    assert.ok(child instanceof THREE.Mesh);
    const position = child.geometry.getAttribute('position');
    return Array.from({ length: position.count }, (_, index) => [position.getX(index), position.getY(index), position.getZ(index)].join(','));
  }).sort();
  assert.deepEqual(received, expected);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  class Element {
    attributes: Record<string, string> = {}; children: Element[] = [];
    setAttribute(name: string, value: string): void { this.attributes[name] = value; }
    append(...children: Element[]): void { this.children.push(...children); }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: () => new Element() } });
  try {
    const layer = createFlatTerrainLayer(tiles, drainage) as unknown as Element;
    assert.ok(layer.children.every(child => child.attributes['stroke'] === undefined || child.attributes['stroke'] === 'none'));
    const svgFaces = new Map(layer.children.filter(child => child.attributes['data-terrain-face']).map(child => [child.attributes['data-terrain-face'], child.attributes['points']]));
    assert.equal(svgFaces.size, faces.length);
    for (const face of faces) assert.equal(svgFaces.get(face.key), face.points.map(([x, y, z]) => { const flat = flatMapPoint(x, z, y); return `${flat.x},${flat.z}`; }).join(' '));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    for (const child of meshes.children) { assert.ok(child instanceof THREE.Mesh); child.geometry.dispose(); if (child.material instanceof THREE.Material) child.material.dispose(); }
  }
});

await test('a true uphill averaged rim is cut and one-unit slopes retain non-uphill shared channel heights', () => {
  const raised = fixture(); raised.tiles[8 * 11 + 1]!.elevation = 80;
  raised.drainage!.terrainBasis = raised.tiles.map(tile => [tile.terrain, tile.elevation * 4096]);
  raised.drainage!.downstreamTileIds = raised.tiles.map(tile => tile.terrain === 'ocean' ? null : raised.tiles.filter(other => steps.some(([q, r]) => other.q === tile.q + q && other.r === tile.r + r) && other.elevation < tile.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id)[0]!.id);
  const drainage = projectDrainage(raised)!;
  assert.equal(drainage.kind, 'retained');
  const tiles = atlasTiles(raised); const source = tiles.find(tile => tile.id === 7 * 11 + 2)!;
  const original = projectTerrainSurface(tiles).find(surface => surface.key === `${source.q},${source.r}`)!;
  assert.ok(original.edgeRims[1]!.some(point => point[1] > source.height));
  const cut = projectTerrainSurface(tiles, drainage).find(surface => surface.key === original.key)!;
  assert.ok(cut.edgeRims[1]![2]![1] < source.height - DRAINAGE_STYLE.depth);
  const minimal = fixture();
  for (const tile of minimal.tiles) if (tile.terrain !== 'ocean') tile.elevation = 40 + (tile.elevation - 40) / 4096;
  minimal.drainage!.terrainBasis = minimal.tiles.map(tile => [tile.terrain, tile.elevation * 4096]);
  const thin = projectDrainage(minimal)!;
  assert.equal(thin.kind, 'retained');
  const surfaces = projectTerrainSurface(atlasTiles(minimal), thin);
  for (const edge of thin.edges.filter(edge => !edge.mouth)) {
    assert.ok(edge.points[0][1] > edge.points[1][1]);
    const high = edge.points[0][1] - DRAINAGE_STYLE.depth; const low = edge.points[1][1] - DRAINAGE_STYLE.depth;
    const channel = surfaces.flatMap(surface => surface.faces).filter(face => face.kind === 'channel' && face.drainageEdgeId === edge.id);
    assert.ok(channel.length === 2 && channel.every(face => face.points.every(point => point[1] <= high && point[1] >= low)));
  }
});

await test('river junctions stay within channel width and decorative forest footprints leave the exact recessed corridor clear', () => {
  const state = fixture(); const drainage = projectDrainage(state)!;
  const mouth = drainage.edges.filter(edge => edge.mouth).sort((a, b) => b.contributingLandTiles - a.contributingLandTiles)[0]!;
  const source = state.tiles[mouth.fromTileId]!;
  const forestIds = new Set([0, source.id, ...state.tiles.filter(tile => tile.terrain !== 'ocean' && steps.some(([q, r]) => tile.q === source.q + q && tile.r === source.r + r)).map(tile => tile.id)]);
  for (const id of forestIds) { state.tiles[id]!.terrain = 'forest'; state.drainage!.terrainBasis[id]![0] = 'forest'; }
  const tiles = atlasTiles(state); const view = projectDrainage(state)!; const surfaces = projectTerrainSurface(tiles, view);
  const corridor = surfaces.flatMap(surface => surface.faces.filter(face => face.kind === 'channel' || face.kind === 'bank'));
  const overlaps = (x: number, z: number, radius: number, polygon: TerrainPoint[]): boolean => {
    const signs = polygon.map((point, index) => { const next = polygon[(index + 1) % polygon.length]!; return (next[0] - point[0]) * (z - point[2]) - (next[2] - point[2]) * (x - point[0]); });
    if (signs.every(sign => sign >= -1e-12) || signs.every(sign => sign <= 1e-12)) return true;
    return polygon.some((a, index) => {
      const b = polygon[(index + 1) % polygon.length]!; const dx = b[0] - a[0]; const dz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t) <= radius;
    });
  };
  for (const detail of ['far', 'mid', 'close'] as const) {
    const before = projectLandscape(tiles, [], detail); const after = projectLandscape(tiles, [], detail, view);
    const canopies = after.parts.filter(part => (part.shape === 'canopy' || part.shape === 'broadleaf'));
    assert.ok(canopies.length > 0);
    assert.ok(canopies.every(part => !corridor.some(face => overlaps(part.position[0], part.position[2], Math.max(part.scale[0], part.scale[2]) / 2 + DRAINAGE_STYLE.forestSetback - 1e-10, face.points))));
    const originals = new Map(before.parts.map(part => [part.id, part]));
    for (const part of canopies) {
      const original = originals.get(part.id);
      if (!original || original.position[0] === part.position[0] && original.position[2] === part.position[2]) continue;
      const tile = tiles.find(candidate => part.id.startsWith(`forest:${candidate.q},${candidate.r}:`))!;
      assert.equal(tile.terrain, 'forest');
      const center = hexPosition(tile.q, tile.r); const radius = Math.max(part.scale[0], part.scale[2]) / 2;
      assert.ok(steps.every((_, direction) => (part.position[0] - center.x) * Math.cos(direction * Math.PI / 3) + (part.position[2] - center.z) * Math.sin(direction * Math.PI / 3) + radius <= Math.sqrt(3) / 2 + 1e-10));
    }
    assert.notDeepEqual(after.parts, before.parts);
    const unaffected = tiles.find(tile => tile.id === 0)!;
    const prefix = `forest:${unaffected.q},${unaffected.r}:`;
    assert.deepEqual(after.parts.filter(part => part.id.startsWith(prefix)), before.parts.filter(part => part.id.startsWith(prefix)));
    assert.deepEqual(projectLandscape(tiles, [], detail, view), after);
  }
  for (const surface of surfaces) {
    const joins = surface.faces.filter(face => face.key.includes(':join:'));
    for (const point of joins.flatMap(face => face.points)) assert.ok(Math.hypot(point[0] - surface.center[0], point[2] - surface.center[2]) <= DRAINAGE_STYLE.maxHalfWidth + 1e-10);
  }
});

await test('shared SVG coverage fills only exact existing surface unions without crossing channel boundaries', () => {
  const state = fixture();
  for (const tile of state.tiles) if (tile.terrain !== 'ocean') tile.terrain = (['grassland', 'forest', 'desert', 'tundra'] as const)[tile.id % 4]!;
  for (const id of [0, 1]) { state.tiles[id]!.terrain = 'mountain'; state.tiles[id]!.elevation = 90 + id; }
  state.drainage!.terrainBasis = state.tiles.map(tile => [tile.terrain, tile.elevation * 4096]);
  state.drainage!.downstreamTileIds = state.tiles.map(tile => tile.terrain === 'ocean' ? null : state.tiles.filter(other => steps.some(([q, r]) => other.q === tile.q + q && other.r === tile.r + r) && other.elevation < tile.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id)[0]!.id);
  const tiles = atlasTiles(state); const drainage = projectDrainage(state)!;
  assert.equal(drainage.kind, 'retained');
  const surfaces = projectTerrainSurface(tiles, drainage);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  class Element {
    attributes: Record<string, string> = {}; children: Element[] = [];
    setAttribute(name: string, value: string): void { this.attributes[name] = value; }
    append(...children: Element[]): void { this.children.push(...children); }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: () => new Element() } });
  try {
    const layer = createFlatTerrainLayer(tiles, drainage) as unknown as Element;
    const coverage = layer.children.filter(child => child.attributes['data-terrain-coverage']);
    assert.equal(coverage.length, 8);
    assert.ok(layer.children.indexOf(coverage.at(-1)!) < layer.children.findIndex(child => child.attributes['data-terrain-face']));
    const faces = surfaces.flatMap(surface => surface.faces);
    const expected = new Map([
      ['bank', faces.filter(face => face.kind === 'bank')],
      ['channel', faces.filter(face => face.kind === 'channel')],
      ['cliff', surfaces.flatMap(surface => surface.cliffs)],
    ]);
    const terrainByKey = new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile.terrain]));
    for (const terrain of ['grassland', 'forest', 'desert', 'mountain', 'tundra'] as const) {
      expected.set(`ground:${terrain}`, surfaces.filter(surface => terrainByKey.get(surface.key) === terrain).flatMap(surface => surface.faces.filter(face => !face.kind || face.kind === 'ground')));
      const layer = coverage.find(path => path.attributes['data-terrain-coverage'] === `ground:${terrain}`)!;
      assert.equal(layer.attributes['fill'], LANDSCAPE_COLORS[terrain]);
    }
    for (const path of coverage) {
      const kind = path.attributes['data-terrain-coverage']!;
      assert.equal(path.attributes['fill-rule'], 'nonzero');
      assert.equal(path.attributes['stroke'], undefined);
      const actual = [...path.attributes['d']!.matchAll(/M([^Z]+)Z/g)].map(match => match[1]!.split('L').sort().join(' ')).sort();
      const wanted = expected.get(kind)!.map(face => face.points.map(([x, y, z]) => { const flat = flatMapPoint(x, z, y); return `${flat.x},${flat.z}`; }).sort().join(' ')).sort();
      assert.deepEqual(actual, wanted);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
