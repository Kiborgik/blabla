import assert from 'node:assert/strict';
import test from 'node:test';
import * as homes from '../visuals/settlement-homes.ts';
import { VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import * as landscape from '../visuals/landscape.ts';
import { landscapeSurface, projectTerrainSurface, projectLandscape } from '../visuals/landscape.ts';
import { settlementVisual, SETTLEMENT_RENDER_SCALE } from '../visuals/world-visuals.ts';
import { transformedVertices, shapeTriangles } from '../web/settlement-parts.ts';

const tile = { q: 0, r: 0, owner: null, terrain: 'grassland' as const, height: .2 };
const colorDistance = (a: string, b: string): number => Math.hypot(...[1, 3, 5].map(index => Number.parseInt(a.slice(index, index + 2), 16) - Number.parseInt(b.slice(index, index + 2), 16)));

await test('retained elevation affects earth tones without ownership or input-order repainting', () => {
  const high = { ...tile, height: .47 };
  assert.ok(colorDistance(landscapeSurface(tile), landscapeSurface(high)) > 12);
  assert.equal(landscapeSurface(tile), landscapeSurface({ ...tile, owner: 4 }));
  const surfaces = projectTerrainSurface([tile]);
  const surface = surfaces[0];
  assert.ok(surface);
  const colors = surface.faces.map(face => face.color);
  const first = colors[0];
  assert.ok(first);
  assert.ok(Math.max(...colors.map(color => colorDistance(first, color))) < 1);
  assert.deepEqual(surface.center, [0, .2, 0]);
  assert.deepEqual(projectTerrainSurface([tile, { ...high, q: 1 }]), projectTerrainSurface([{ ...high, q: 1 }, tile]));
});

await test('forests use stable distinct crown families while population still clears only its actual tile', () => {
  const tiles = Array.from({ length: 8 }, (_, q) => ({ ...tile, q, terrain: 'forest' as const }));
  const before = structuredClone(tiles);
  const parts = projectLandscape(tiles, [], 'far').parts;
  assert.ok(parts.some(part => part.shape === 'broadleaf'));
  assert.ok(parts.some(part => part.shape === 'canopy'));
  assert.deepEqual(parts, projectLandscape(tiles.toReversed(), [], 'far').parts);
  const cleared = projectLandscape(tiles, [{ q: 0, r: 0, population: 7 }], 'far').parts;
  assert.ok(!cleared.some(part => part.id.startsWith('forest:0,0:')));
  assert.ok(cleared.some(part => part.id.startsWith('forest:1,0:')));
  assert.deepEqual(tiles, before);
});

await test('default far towns retain exactly earned homes with readable roof width and tile-contained massing', () => {
  const city = { id: 'visible-town', worldSeed: 1701, civId: 0, tileId: 4, name: 'Town', population: 7, wellbeing: 67, damage: 0, buildings: [] };
  const town = settlementVisual(city, 'far');
  assert.equal(town.houses, 3);
  assert.equal(settlementVisual({ ...city, population: 1 }, 'far').houses, 1);
  assert.equal(town.development.stage, 'primitive');
  const roofs = town.parts.filter(part => /^home-\d+-roof$/.test(part.id));
  assert.equal(roofs.length, 3);
  assert.ok(roofs.every(part => part.scale[0] * SETTLEMENT_RENDER_SCALE * 16 >= 3.4));
  assert.ok(town.parts.every(part => part.id.startsWith('home-')));
  for (const part of town.parts) for (const [x, , z] of transformedVertices(part)) {
    assert.ok(Math.abs(x) * SETTLEMENT_RENDER_SCALE < Math.sqrt(3) / 2);
    assert.ok((Math.abs(z) + Math.abs(x) / Math.sqrt(3)) * SETTLEMENT_RENDER_SCALE < 1);
  }
});

await test('broadleaf geometry is original closed outward facing geometry distinct from pointed crowns', () => {
  const broad = shapeTriangles('broadleaf');
  assert.notDeepEqual(broad, shapeTriangles('canopy'));
  assert.ok(broad.length > shapeTriangles('canopy').length);
  let volume = 0;
  for (let index = 0; index < broad.length; index += 9) {
    const ax = broad[index] ?? Number.NaN; const ay = broad[index + 1] ?? Number.NaN; const az = broad[index + 2] ?? Number.NaN;
    const bx = broad[index + 3] ?? Number.NaN; const by = broad[index + 4] ?? Number.NaN; const bz = broad[index + 5] ?? Number.NaN;
    const cx = broad[index + 6] ?? Number.NaN; const cy = broad[index + 7] ?? Number.NaN; const cz = broad[index + 8] ?? Number.NaN;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  assert.ok(volume > .1);
});

await test('layered shallows follow only retained coastline segments with no invented land', () => {
  assert.equal(typeof landscape.projectShoreBands, 'function');
  const coast = projectLandscape([tile], [], 'far').coast;
  const bands = landscape.projectShoreBands(coast);
  assert.equal(bands.length, coast.length * 3);
  assert.equal(new Set(bands.map(band => band.color)).size, 3);
  assert.ok(bands.every(band => band.points.length === 4 && band.points.every(point => point.every(Number.isFinite))));
  assert.deepEqual(landscape.projectShoreBands([]), []);
});

await test('all earned local town families fit their real hex after uniform presentation enlargement', () => {
  for (const id of ['visible-town', 'earned-town', 'legible-farm', 'harbor', 'village']) for (const civId of [0, 1, 2, 3, 4]) {
    for (const buildings of [[], ['farm'], ['workshop', 'aqueduct', 'farm'], ['academy'], ['factory'], ['launchpad']]) {
      for (const detail of ['far', 'mid', 'close'] as const) {
        const visual = settlementVisual({ id, worldSeed: 1701, civId, tileId: 4, name: 'Town', population: 40, wellbeing: 67, damage: 0, buildings }, detail);
        for (const part of visual.parts) for (const [x, , z] of transformedVertices(part)) {
          assert.ok(Math.abs(x) * SETTLEMENT_RENDER_SCALE <= Math.sqrt(3) / 2, `${id}/${part.id}: east-west hex edge`);
          assert.ok((Math.abs(z) + Math.abs(x) / Math.sqrt(3)) * SETTLEMENT_RENDER_SCALE <= 1, `${id}/${part.id}: diagonal hex edge`);
        }
      }
    }
  }
});

await test('flat grass and desert have no six-face debug pattern while actual slopes retain relief', () => {
  for (const terrain of ['grassland', 'desert'] as const) {
    const flat = { ...tile, terrain, height: .3 };
    const surface = projectTerrainSurface([flat])[0]; assert.ok(surface);
    assert.equal(new Set(surface.faces.map(face => face.color)).size, 1);
    const slope = projectTerrainSurface([flat, { ...flat, q: 1, height: .47 }])[0]; assert.ok(slope);
    assert.ok(new Set(slope.faces.map(face => face.color)).size > 1);
    assert.ok(colorDistance(landscapeSurface(flat), landscapeSurface({ ...flat, q: 1 })) < 8);
    assert.ok(colorDistance(landscapeSurface(flat), landscapeSurface({ ...flat, q: 8 })) > 3);
  }
});

await test('shared residential roof contrast preserves identity hue and does not recolor walls or crops', () => {
  assert.equal(typeof homes.settlementPartColor, 'function');
  const roof = { id: 'home-0-roof', material: 'identity' as const };
  assert.equal(homes.settlementPartColor(roof, '#d8c58b'), '#a4966a');
  assert.equal(homes.settlementPartColor({ ...roof, id: 'home-0-wall' }, '#d8c58b'), '#d8c58b');
  assert.equal(homes.settlementPartColor({ id: 'farm-row-0', material: 'grain' }, '#d8c58b'), VISUAL_PALETTE.grain);
});
