import { hexPosition, routeMapAnchor, type AtlasWorld, type RouteMapPoint } from './atlas.ts';
import { cityKey } from './city-selection.ts';
import type { ChronicleDestination, ChronicleStory } from './chronicle-presentation.ts';
import type { CameraView } from './inspection-camera.ts';

export interface SpectatorFollowTarget {
  eventId: string;
  destination: ChronicleDestination;
  point: RouteMapPoint;
}

export function spectatorDestinationPoint(destination: ChronicleDestination, world: AtlasWorld): RouteMapPoint | null {
  if (destination.kind === 'civilization' || world.illustrative) return null;
  let point: RouteMapPoint | null = null;
  if (destination.kind === 'route') {
    const route = world.routes.find(candidate => candidate.id === destination.id && !candidate.illustrative);
    point = route ? routeMapAnchor(route) : null;
  } else if (destination.kind === 'site') {
    const city = world.cities.find(candidate => cityKey(candidate) === destination.cityId);
    const tile = city && world.tiles.find(candidate => candidate.id === destination.tileId);
    if (tile) point = { ...hexPosition(tile.q, tile.r), y: tile.height };
  } else {
    const city = world.cities.find(candidate => cityKey(candidate) === destination.id);
    const tile = city && world.tiles.find(candidate => candidate.q === city.q && candidate.r === city.r);
    if (city && tile) point = { ...hexPosition(city.q, city.r), y: tile.height };
  }
  return point && [point.x, point.y, point.z].every(Number.isFinite) ? point : null;
}

export function spectatorFollowTarget(story: ChronicleStory, world: AtlasWorld): SpectatorFollowTarget | null {
  const destination = story.destination;
  const point = destination && !story.event.routine ? spectatorDestinationPoint(destination, world) : null;
  return point && destination ? { eventId: story.event.id, destination, point } : null;
}

export interface SpectatorFollowObservation {
  identity: string;
  revision: number;
  stories: readonly ChronicleStory[];
  eventIds?: readonly string[];
  world: AtlasWorld;
  now: number;
  blocked?: boolean;
  reducedMotion?: boolean;
}

export type SpectatorFollowStatus = 'off' | 'following' | 'paused' | 'reduced-motion';

export function createSpectatorFollowSession() {
  let identity = '';
  let revision = -1;
  let mode: 'off' | 'following' | 'paused' = 'off';
  let reducedMotion = false;
  let original: CameraView | null = null;
  let seen = new Set<string>();
  let pending: { target: SpectatorFollowTarget; expires: number } | null = null;
  let lastMove = -Infinity;
  return {
    observe(input: SpectatorFollowObservation): SpectatorFollowTarget | null {
      reducedMotion = !!input.reducedMotion;
      const observedIds = input.eventIds ?? input.stories.map(story => story.event.id);
      if (identity !== input.identity || input.revision < revision) {
        identity = input.identity; revision = input.revision; mode = 'off'; original = null; pending = null; lastMove = -Infinity;
        seen = new Set(observedIds);
        return null;
      }
      if (input.revision > revision) {
        revision = input.revision;
        const fresh = input.stories.filter(story => !seen.has(story.event.id));
        seen = new Set([...seen].slice(-256).concat([...observedIds]));
        if (mode === 'following' && !input.blocked && !reducedMotion) {
          const target = fresh.map(story => spectatorFollowTarget(story, input.world)).find(candidate => candidate !== null);
          if (target) pending = { target, expires: input.now + 16_000 };
        }
      }
      if (mode !== 'following' || input.blocked || reducedMotion || !Number.isFinite(input.now)) { pending = null; return null; }
      if (pending && input.now > pending.expires) pending = null;
      if (!pending || input.now - lastMove < 12_000) return null;
      const story = input.stories.find(candidate => candidate.event.id === pending?.target.eventId);
      const target = story ? spectatorFollowTarget(story, input.world) : null;
      pending = null;
      if (target) lastMove = input.now;
      return target;
    },
    resume(camera: CameraView): void { if (identity) { original ??= { ...camera }; mode = 'following'; pending = null; lastMove = -Infinity; } },
    interrupt(): void { if (mode !== 'off') mode = 'paused'; pending = null; original = null; },
    stop(): void { mode = 'off'; pending = null; original = null; },
    status(): SpectatorFollowStatus { return mode === 'following' && reducedMotion ? 'reduced-motion' : mode; },
    savedCamera(camera: CameraView): CameraView { return { ...(original ?? camera) }; },
    translate(x: number, z: number): void {
      if (original) { original.x += x; original.z += z; }
      pending = null;
    },
  };
}

export function createSpectatorCameraMotion() {
  let movement: { from: CameraView; to: CameraView; started: number; duration: number } | null = null;
  return {
    start(from: CameraView, to: CameraView, now: number): boolean {
      if (![from.x, from.z, from.zoom, to.x, to.z, now].every(Number.isFinite) || from.zoom <= 0) { movement = null; return false; }
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      if (distance < 1e-6) { movement = null; return false; }
      movement = { from: { ...from }, to: { ...to, zoom: from.zoom }, started: now, duration: Math.min(1800, Math.max(1200, distance * from.zoom * 70)) };
      return true;
    },
    sample(now: number): CameraView | null {
      if (!movement || !Number.isFinite(now)) return null;
      const t = Math.max(0, Math.min(1, (now - movement.started) / movement.duration));
      const smooth = t * t * (3 - 2 * t);
      const camera = { x: movement.from.x + (movement.to.x - movement.from.x) * smooth,
        z: movement.from.z + (movement.to.z - movement.from.z) * smooth, zoom: movement.from.zoom };
      if (t === 1) movement = null;
      return camera;
    },
    cancel(): void { movement = null; },
    active(): boolean { return movement !== null; },
  };
}
