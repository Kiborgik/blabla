import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
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

await test('published manifests are honest preview records with matching history', () => {
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
