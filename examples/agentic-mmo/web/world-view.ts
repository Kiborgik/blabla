export const WORLD_SOURCES = ['local', 'shared'] as const;
export type WorldSource = typeof WORLD_SOURCES[number];
export const WORLD_BODIES = ['earth', 'mars'] as const;
export type WorldBody = typeof WORLD_BODIES[number];
export const MAP_ZOOM = { minimum: .25, maximum: 4 } as const;
export const MAX_WORLD_VIEWS = 12;

export interface WorldCamera {
  zoom: number;
  x: number;
  z: number;
  selected: number;
  selectedCity: string | null;
}

export interface WorldViewIdentity {
  source: WorldSource;
  identity: string;
  body: string;
}

export interface SavedWorldView extends WorldViewIdentity { camera: WorldCamera }
export interface WorldViewPreferences extends WorldCamera { worldSource?: WorldSource; worldBody?: WorldBody; worldViews?: SavedWorldView[] }
export const DEFAULT_WORLD_CAMERA: WorldCamera = { zoom: 1, x: 0, z: 0, selected: 0, selectedCity: null };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function parseWorldSource(value: unknown): WorldSource | null {
  return value === 'local' || value === 'shared' ? value : null;
}

export function parseWorldBody(value: unknown): WorldBody | null {
  return value === 'earth' || value === 'mars' ? value : null;
}

export function worldSourceHref(href: string, source: WorldSource): string {
  const url = new URL(href); url.searchParams.set('world', source); url.searchParams.delete('sample'); return url.href;
}

export function parseWorldCamera(value: unknown): WorldCamera {
  const data = record(value);
  const selected = data?.['selected'];
  const city = data?.['selectedCity'];
  return {
    zoom: bounded(data?.['zoom'], 1, MAP_ZOOM.minimum, MAP_ZOOM.maximum),
    x: bounded(data?.['x'], 0, -100, 100),
    z: bounded(data?.['z'], 0, -100, 100),
    selected: typeof selected === 'number' && Number.isInteger(selected) && selected >= 0 && selected < 5 ? selected : 0,
    selectedCity: typeof city === 'string' && city.length > 0 && city.length <= 160 ? city : null,
  };
}

export function worldViewKey(view: WorldViewIdentity): string {
  return JSON.stringify([view.source, view.identity, view.body]);
}

export function parseWorldViews(value: unknown): SavedWorldView[] {
  if (!Array.isArray(value)) return [];
  const result: SavedWorldView[] = [];
  for (const entry of value.slice(-MAX_WORLD_VIEWS)) {
    const data = record(entry);
    const source = parseWorldSource(data?.['source']);
    const identity = data?.['identity'];
    const body = data?.['body'];
    const camera = record(data?.['camera']);
    if (!source || typeof identity !== 'string' || !identity.length || identity.length > 512
      || typeof body !== 'string' || !body.length || body.length > 160 || !camera) continue;
    const view = { source, identity, body, camera: parseWorldCamera(camera) };
    const previous = result.findIndex(candidate => worldViewKey(candidate) === worldViewKey(view));
    if (previous >= 0) result.splice(previous, 1);
    result.push(view);
  }
  return result;
}

export function saveWorldView<T extends WorldViewPreferences>(preferences: T, identity: WorldViewIdentity, camera: WorldCamera): T {
  const retained = parseWorldViews(preferences.worldViews).filter(view => worldViewKey(view) !== worldViewKey(identity));
  const worldViews = [...retained, { ...identity, camera: parseWorldCamera(camera) }].slice(-MAX_WORLD_VIEWS);
  const body = parseWorldBody(identity.body);
  return { ...preferences, ...parseWorldCamera(camera), worldSource: identity.source, ...(body ? { worldBody: body } : {}), worldViews };
}

export function createWorldViewSession() {
  let active: WorldViewIdentity | null = null;
  return {
    identity: (): WorldViewIdentity | null => active ? { ...active } : null,
    capture<T extends WorldViewPreferences>(preferences: T, camera: WorldCamera): T {
      return active ? saveWorldView(preferences, active, camera) : { ...preferences };
    },
    release(): void { active = null; },
    observe<T extends WorldViewPreferences>(preferences: T, identity: WorldViewIdentity): { preferences: T; changed: boolean; restored: boolean } {
      if (active && worldViewKey(active) === worldViewKey(identity)) return { preferences, changed: false, restored: true };
      const views = parseWorldViews(preferences.worldViews);
      const saved = views.find(view => worldViewKey(view) === worldViewKey(identity));
      active = { ...identity };
      const body = parseWorldBody(identity.body);
      return { preferences: { ...preferences, ...(saved?.camera ?? DEFAULT_WORLD_CAMERA), worldSource: identity.source, ...(body ? { worldBody: body } : {}) }, changed: true, restored: Boolean(saved) };
    },
  };
}
