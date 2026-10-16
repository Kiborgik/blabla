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
  speed: number;
  paused: boolean;
  borders: boolean;
  routes: boolean;
}

export const DEFAULT_PREFERENCES: ViewerPreferences = {
  schemaVersion: 1,
  zoom: 1,
  x: 0,
  z: 0,
  selected: 0,
  speed: 1,
  paused: false,
  borders: true,
  routes: true,
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
  return {
    schemaVersion: 1,
    zoom: bounded(data['zoom'], 1, 0.65, 2.2),
    x: bounded(data['x'], 0, -20, 20),
    z: bounded(data['z'], 0, -15, 15),
    selected:
      typeof selected === 'number' && Number.isInteger(selected) && selected >= 0 && selected < 5
        ? selected
        : 0,
    speed: bounded(data['speed'], 1, 0.5, 4),
    paused: typeof data['paused'] === 'boolean' ? data['paused'] : false,
    borders: typeof data['borders'] === 'boolean' ? data['borders'] : true,
    routes: typeof data['routes'] === 'boolean' ? data['routes'] : true,
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
