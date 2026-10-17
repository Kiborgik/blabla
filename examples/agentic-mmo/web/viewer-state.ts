export interface Release {
  schemaVersion: 1;
  version: string;
  buildId: string;
  publishedAt: string;
}

export interface ViewerPreferences {
  schemaVersion: 1;
  zoom: number;
  x: number;
  z: number;
  selected: number;
  selectedCity: string | null;
  speed: number;
  paused: boolean;
  borders: boolean;
  routes: boolean;
  theme: 'light' | 'dark' | 'system';
  effects: 'calm' | 'rich' | 'cinematic';
}

export const MAP_ZOOM = { minimum: .25, maximum: 4 } as const;

export const DEFAULT_PREFERENCES: ViewerPreferences = {
  schemaVersion: 1,
  zoom: 1,
  x: 0,
  z: 0,
  selected: 0,
  selectedCity: null,
  speed: 1,
  paused: false,
  borders: true,
  routes: true,
  theme: 'system',
  effects: 'rich',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function object(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function parsePreferences(value: unknown): ViewerPreferences {
  const data = object(value);
  if (data?.['schemaVersion'] !== 1) return { ...DEFAULT_PREFERENCES };
  const selected = data['selected'];
  const selectedCity = data['selectedCity'];
  return {
    schemaVersion: 1,
    zoom: bounded(data['zoom'], 1, MAP_ZOOM.minimum, MAP_ZOOM.maximum),
    x: bounded(data['x'], 0, -100, 100),
    z: bounded(data['z'], 0, -100, 100),
    selected:
      typeof selected === 'number' && Number.isInteger(selected) && selected >= 0 && selected < 5
        ? selected
        : 0,
    selectedCity: typeof selectedCity === 'string' && selectedCity.length > 0 && selectedCity.length <= 160 ? selectedCity : null,
    speed: bounded(data['speed'], 1, 0.5, 4),
    paused: typeof data['paused'] === 'boolean' ? data['paused'] : false,
    borders: typeof data['borders'] === 'boolean' ? data['borders'] : true,
    routes: typeof data['routes'] === 'boolean' ? data['routes'] : true,
    theme: data['theme'] === 'light' || data['theme'] === 'dark' ? data['theme'] : 'system',
    effects: data['effects'] === 'calm' || data['effects'] === 'rich' || data['effects'] === 'cinematic'
      ? data['effects']
      : data['paused'] === true ? 'calm' : 'rich',
  };
}

export function parseRelease(value: unknown): Release | null {
  const data = object(value);
  if (
    data?.['schemaVersion'] !== 1 ||
    typeof data['version'] !== 'string' ||
    typeof data['buildId'] !== 'string' ||
    typeof data['publishedAt'] !== 'string'
  )
    return null;
  if (
    !data['version'].trim() ||
    !data['buildId'].trim() ||
    !Number.isFinite(Date.parse(data['publishedAt']))
  )
    return null;
  return {
    schemaVersion: 1,
    version: data['version'],
    buildId: data['buildId'],
    publishedAt: data['publishedAt'],
  };
}

export function shouldReload(
  current: Release,
  remote: Release | null,
  attempted: readonly string[],
): boolean {
  return (
    remote !== null &&
    remote.buildId !== current.buildId &&
    Date.parse(remote.publishedAt) > Date.parse(current.publishedAt) &&
    !attempted.includes(remote.buildId)
  );
}

export function releaseHistoryPage<T>(entries: readonly T[], requestedPage: number): { page: number; pages: number; total: number; start: number; end: number; entries: T[] } {
  const size = 6;
  const pages = Math.max(1, Math.ceil(entries.length / size));
  const page = Math.min(pages - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = page * size;
  return { page, pages, total: entries.length, start, end: Math.min(entries.length, start + size), entries: entries.slice(start, start + size) };
}
