import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import type { GameEvent } from '../core/types.ts';
import { projectWorld } from '../web/live-world.ts';
import { spectatorChronicle } from '../web/spectator-hud.ts';
import { presentChronicleStories, type ChronicleStory } from '../web/chronicle-presentation.ts';
import { createSpectatorCameraMotion, createSpectatorFollowSession, spectatorDestinationPoint, spectatorFollowTarget, type SpectatorFollowObservation } from '../web/spectator-follow.ts';
import { hexPosition, routeMapAnchor } from '../web/atlas.ts';

function fixture() {
  const state = createWorld(1701); const city = state.cities[0]; assert.ok(city);
  const world = projectWorld(state);
  const story = (round: number): ChronicleStory => {
    const source: GameEvent = { id: `story-${round}`, round, type: 'building-completed', title: `${city.name} built a workshop`, detail: '', actor: city.civId, target: city.civId,
      tileId: city.tileId, cause: '', effects: [], importance: 4 };
    state.events = [source]; const result = presentChronicleStories(state, spectatorChronicle(state))[0]; assert.ok(result); return result;
  };
  const observation = (revision: number, now: number, stories = [story(revision)]): SpectatorFollowObservation => ({ identity: 'local/world-one/earth', revision, now, stories, world });
  return { state, city, world, story, observation };
}

void test('follow starts off, sees committed events once, and never replays the loaded history on opt-in', () => {
  const { observation } = fixture(); const session = createSpectatorFollowSession(); const camera = { x: 3, z: 4, zoom: 1.2 };
  assert.equal(session.status(), 'off'); assert.equal(session.observe(observation(1, 0)), null);
  session.resume(camera); assert.equal(session.status(), 'following'); assert.equal(session.observe(observation(1, 1)), null);
  assert.equal(session.observe(observation(2, 2))?.eventId, 'story-2');
  assert.equal(session.observe(observation(2, 20_000)), null);
  assert.deepEqual(session.savedCamera({ x: 99, z: 99, zoom: 2 }), camera);
});

void test('follow has one short-lived pending target, a reading interval, and no per-tick teleport or stale history catch-up', () => {
  const { observation, story } = fixture(); const session = createSpectatorFollowSession();
  session.observe(observation(0, 0)); session.resume({ x: 0, z: 0, zoom: 1 });
  assert.equal(session.observe(observation(1, 100))?.eventId, 'story-1');
  assert.equal(session.observe(observation(2, 500)), null);
  assert.equal(session.observe(observation(3, 1000)), null);
  assert.equal(session.observe(observation(3, 12_100))?.eventId, 'story-3');
  assert.equal(session.observe(observation(4, 12_200)), null);
  assert.equal(session.observe(observation(4, 28_201)), null);
  assert.equal(session.observe(observation(5, 30_000, [story(5), story(4), story(3)]))?.eventId, 'story-5');
});

void test('historical events newly exposed by Chronicle diversity do not become fresh camera destinations', () => {
  const { observation, story } = fixture(); const session = createSpectatorFollowSession();
  session.observe({ ...observation(10, 0), eventIds: ['story-10', 'story-4', 'story-2'] });
  session.resume({ x: 0, z: 0, zoom: 1 });
  assert.equal(session.observe({ ...observation(11, 10, [story(4)]), eventIds: ['story-10', 'story-4', 'story-2'] }), null);
  assert.equal(session.observe({ ...observation(12, 20, [story(12), story(2)]), eventIds: ['story-12', 'story-10', 'story-4', 'story-2'] })?.eventId, 'story-12');
});

void test('manual inspection, pan or zoom pauses until explicit resume and preserves the newly chosen manual camera', () => {
  const { observation } = fixture(); const session = createSpectatorFollowSession();
  session.observe(observation(0, 0)); session.resume({ x: 0, z: 0, zoom: 1 }); session.observe(observation(1, 1));
  session.interrupt(); assert.equal(session.status(), 'paused'); assert.equal(session.observe(observation(2, 20_000)), null);
  const manual = { x: -4, z: 9, zoom: 2 }; assert.deepEqual(session.savedCamera(manual), manual);
  session.resume(manual); assert.equal(session.observe(observation(2, 20_001)), null);
  assert.equal(session.observe(observation(3, 20_002))?.eventId, 'story-3');
  session.stop(); assert.equal(session.status(), 'off');
});

void test('source, body, world and revision rollback isolate events and saved cameras', () => {
  const { observation } = fixture();
  for (const identity of ['shared/world-one/earth', 'local/world-two/earth', 'local/world-one/mars']) {
    const session = createSpectatorFollowSession(); session.observe(observation(1, 0)); session.resume({ x: 1, z: 2, zoom: 1 });
    assert.equal(session.observe({ ...observation(2, 1), identity }), null); assert.equal(session.status(), 'off');
    assert.deepEqual(session.savedCamera({ x: 7, z: 8, zoom: 2 }), { x: 7, z: 8, zoom: 2 });
  }
  const session = createSpectatorFollowSession(); session.observe(observation(3, 0)); session.resume({ x: 0, z: 0, zoom: 1 });
  assert.equal(session.observe(observation(1, 1)), null); assert.equal(session.status(), 'off');
});

void test('reduced motion, hidden maps and open inspections suppress automatic motion without accumulating a queue', () => {
  const { observation } = fixture(); const session = createSpectatorFollowSession();
  session.observe(observation(0, 0)); session.resume({ x: 0, z: 0, zoom: 1 });
  assert.equal(session.observe({ ...observation(1, 1), reducedMotion: true }), null); assert.equal(session.status(), 'reduced-motion');
  assert.equal(session.observe(observation(1, 2)), null); assert.equal(session.status(), 'following');
  assert.equal(session.observe({ ...observation(2, 3), blocked: true }), null);
  assert.equal(session.observe(observation(2, 30_000)), null);
  assert.equal(session.observe(observation(3, 30_001))?.eventId, 'story-3');
});

void test('targets use actual town heights, exact work tiles and route midpoint, never civilization context or missing paths', () => {
  const { world, city, story } = fixture(); const source = story(1); const before = structuredClone(world);
  const town = world.cities.find(candidate => candidate.cityId === city.id); assert.ok(town);
  const tile = world.tiles.find(candidate => candidate.q === town.q && candidate.r === town.r); assert.ok(tile);
  assert.deepEqual(spectatorFollowTarget(source, world)?.point, { ...hexPosition(town.q, town.r), y: tile.height });
  const siteTile = world.tiles.find(candidate => candidate.id !== tile.id); assert.ok(siteTile && siteTile.id !== undefined);
  const exact: ChronicleStory = { ...source, destination: { kind: 'site', id: 'exact', cityId: city.id, tileId: siteTile.id, workId: String(siteTile.id), label: 'Mine' } };
  assert.deepEqual(spectatorFollowTarget(exact, world)?.point, { ...hexPosition(siteTile.q, siteTile.r), y: siteTile.height });
  assert.ok(exact.destination);
  assert.deepEqual(spectatorDestinationPoint(exact.destination, world), { ...hexPosition(siteTile.q, siteTile.r), y: siteTile.height });
  assert.equal(spectatorFollowTarget({ ...source, destination: { kind: 'civilization', id: city.civId, label: 'Context only' } }, world), null);
  assert.equal(spectatorFollowTarget({ ...exact, destination: { ...exact.destination, kind: 'site', id: 'missing', cityId: city.id, tileId: -1, workId: null, label: 'Missing' } }, world), null);
  assert.deepEqual(world, before);
  const route = { id: 'route-exact', from: city.id, to: 'other', owner: 0, partner: 1, active: true, damage: 0, volume: 1,
    ownerName: 'First', partnerName: 'Second', fromTown: null, toTown: null,
    path: { kind: 'land' as const, points: [{ tileId: 1, q: 0, r: 0, height: .4 }, { tileId: 2, q: 2, r: 0, height: .5 }, { tileId: 3, q: 2, r: 3, height: .6 }], currentBlock: null, reason: null } };
  const routeStory: ChronicleStory = { ...source, destination: { kind: 'route', id: route.id, label: 'Actual route' } };
  assert.deepEqual(spectatorFollowTarget(routeStory, { ...world, routes: [route] })?.point, routeMapAnchor(route));
  assert.equal(spectatorFollowTarget(routeStory, { ...world, routes: [] }), null);
  assert.equal(spectatorFollowTarget(source, { ...world, illustrative: true }), null);
});

void test('world coordinate growth translates the retained manual view and clears an old point', () => {
  const { observation } = fixture(); const session = createSpectatorFollowSession(); session.observe(observation(0, 0));
  session.resume({ x: 2, z: 3, zoom: 1.5 }); session.observe(observation(1, 1)); session.observe(observation(2, 2));
  session.translate(4, -2); assert.deepEqual(session.savedCamera({ x: 9, z: 9, zoom: 3 }), { x: 6, z: 1, zoom: 1.5 });
  assert.equal(session.observe(observation(2, 20_000)), null);
});

void test('camera movement eases once without changing zoom, overshoot or continuing after interruption', () => {
  const motion = createSpectatorCameraMotion(); const from = { x: -4, z: 3, zoom: 1.4 }; const to = { x: 10, z: -8, zoom: 2 };
  assert.equal(motion.start(from, to, 100), true); assert.deepEqual(motion.sample(100), from);
  const half = motion.sample(700); assert.ok(half && half.x > from.x && half.x < to.x && half.z < from.z && half.z > to.z); assert.equal(half.zoom, from.zoom);
  assert.deepEqual(motion.sample(2000), { ...to, zoom: from.zoom }); assert.equal(motion.active(), false); assert.equal(motion.sample(3000), null);
  motion.start(from, to, 1); motion.cancel(); assert.equal(motion.sample(700), null);
  assert.equal(motion.start(from, { ...to, x: NaN }, 1), false); assert.equal(motion.start(from, from, 1), false);
});
