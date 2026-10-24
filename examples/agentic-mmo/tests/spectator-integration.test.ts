import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInspectionSession } from '../web/inspection-camera.ts';
import { createSpectatorFollowSession, createSpectatorCameraMotion } from '../web/spectator-follow.ts';
import { parsePreferences } from '../web/viewer-state.ts';

void test('follow presentation never overwrites the persisted overview or inspection restoration', () => {
  const follow = createSpectatorFollowSession();
  const inspection = createInspectionSession();
  const overview = { x: 2, z: 3, zoom: 1.2 };
  follow.observe({ identity: 'earth:one', revision: 1, stories: [], eventIds: [], world: { cities: [], tiles: [], routes: [] }, now: 0 });
  follow.resume(overview);
  const automatic = { x: 8, z: -4, zoom: 1.2 };
  assert.deepEqual(follow.savedCamera(inspection.savedCamera(automatic)), overview);
  follow.interrupt();
  inspection.begin(automatic);
  assert.deepEqual(follow.savedCamera(inspection.savedCamera({ x: 12, z: 1, zoom: 1.2 })), automatic);
  assert.deepEqual(inspection.end(), automatic);
  inspection.begin(automatic); inspection.release();
  assert.equal(inspection.end(), null);
});

void test('cancelling actual follow interpolation leaves the exact manual view available for persistence', () => {
  const motion = createSpectatorCameraMotion();
  assert.equal(motion.start({ x: 0, z: 0, zoom: 2 }, { x: 10, z: 4, zoom: 5 }, 0), true);
  const midway = motion.sample(600); assert.ok(midway);
  assert.equal(midway.zoom, 2);
  motion.cancel(); assert.equal(motion.sample(900), null);
  const saved = parsePreferences({ schemaVersion: 1, ...midway, theme: 'light' });
  assert.equal(saved.x, midway.x); assert.equal(saved.z, midway.z); assert.equal(saved.theme, 'light');
});

void test('the full-app integration binds exact Work requests, actual rectangles and viewer-only interruption', () => {
  const source = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(source, /id="map" class="map" role="region" tabindex="0" aria-label="World map/);
  assert.match(source, /Civilization stockpile/);
  assert.match(source, /Follow on · motion off/);
  const inspection = readFileSync(new URL('../web/settlement-inspection.ts', import.meta.url), 'utf8');
  assert.match(inspection, /residents.*Housing/);
  assert.match(source, /selectCity\(destination\.cityId, destination\.workId\)/);
  assert.match(source, /atlas\.framePoint\(point, measuredSpectatorAnchor/);
  assert.match(source, /inspectionDestination = \{ identity: observedWorldKey\(\), destination \}/);
  assert.match(source, /eventIds: state\.events\.map\(event => event\.id\)/);
  assert.match(source, /spectatorFollow\.savedCamera\(inspectionCamera\.savedCamera/);
  assert.match(source, /worldBody !== 'earth' \|\| document\.hidden/);
  assert.match(source, /addEventListener\('wheel', \(\) => \{ inspectionCamera\.release\(\); inspectionDestination = null; interruptFollow\(\);/);
  assert.match(source, /if \(!initialOverview \|\| observedWorldKey\(\) !== identity \|\| !atlas\) return/);
  assert.match(source, /organizeSpectatorInspection\(panel\)/);
  assert.match(source, /ribbon: ribbons\.get\(id\)/);
  const follow = source.slice(source.indexOf('function observeFollow()'), source.indexOf('const eventCues ='));
  assert.doesNotMatch(follow, /selectCity\(|selectRoute\(|changeWorldBody\(|advanceLocalSimulation|applyCommand/);
});
