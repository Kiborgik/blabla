import { DEFAULT_WORLD_CAMERA, parseWorldBody, parseWorldCamera, parseWorldSource, parseWorldViews } from './world-view.ts';
import type { WorldViewPreferences } from './world-view.ts';
export { MAP_ZOOM } from './world-view.ts';

export interface Release {
  schemaVersion: 2;
  version: string;
  buildId: string;
  preparedAt: string;
}

export interface ViewerPreferences extends WorldViewPreferences {
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

export const DEFAULT_PREFERENCES: ViewerPreferences = {
  schemaVersion: 1,
  ...DEFAULT_WORLD_CAMERA,
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
  const worldSource = parseWorldSource(data['worldSource']);
  const worldBody = parseWorldBody(data['worldBody']);
  const worldViews = parseWorldViews(data['worldViews']);
  return {
    schemaVersion: 1,
    ...parseWorldCamera(data),
    ...(worldSource ? { worldSource } : {}),
    ...(worldBody ? { worldBody } : {}),
    ...(worldViews.length ? { worldViews } : {}),
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
    data?.['schemaVersion'] !== 2 ||
    typeof data['version'] !== 'string' ||
    typeof data['buildId'] !== 'string' ||
    typeof data['preparedAt'] !== 'string'
  )
    return null;
  if (
    !data['version'].trim() ||
    !data['buildId'].trim() ||
    !Number.isFinite(Date.parse(data['preparedAt']))
  )
    return null;
  return {
    schemaVersion: 2,
    version: data['version'],
    buildId: data['buildId'],
    preparedAt: data['preparedAt'],
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
    Date.parse(remote.preparedAt) > Date.parse(current.preparedAt) &&
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
