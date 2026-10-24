import type { WorldState } from '../core/types.ts';
import type { AtlasWorld } from './atlas.ts';
import { resolveCitySelection } from './city-selection.ts';
import type { WorldBody, WorldCamera } from './world-view.ts';

export function bodySelection(body: WorldBody, world: AtlasWorld, selection: Pick<WorldCamera, 'selected' | 'selectedCity'>): Pick<WorldCamera, 'selected' | 'selectedCity'> {
  if (body === 'earth') return resolveCitySelection(world, selection);
  const selected = world.cities.find(city => city.id === selection.selected)?.id ?? world.cities[0]?.id ?? 0;
  return { selected, selectedCity: world.cities.length ? `mars:${selected}` : null };
}

export function worldBodyHref(href: string, body: WorldBody): string {
  const url = new URL(href);
  url.searchParams.set('body', body);
  return url.href;
}

export function bodyViewContext(body: WorldBody, state: WorldState): string {
  if (body === 'earth') return 'Earth · Recorded local development';
  if (!state.spaceflight) return 'Mars · No mission or colony records · Illustrative terrain';
  const colonies = state.spaceflight.civilizations.filter(entry => entry.colony).length;
  const flights = state.spaceflight.civilizations.filter(entry => entry.activeMission).length;
  return `Mars · ${colonies} ${colonies === 1 ? 'colony' : 'colonies'} · ${flights} ${state.outcome ? 'unfinished ' : ''}${flights === 1 ? 'flight' : 'flights'} · Illustrative terrain`;
}

export function bodyViewDescription(body: WorldBody, state: WorldState): string {
  if (body === 'earth') return 'Earth towns and sites reflect recorded local development, not a uniform world-era makeover.';
  return `${bodyViewContext(body, state)}. Terrain and layout are visual context, not simulated geography, territory, ownership or resources. Habitat work, people and delivered reserves come only from recorded state, not invented local production.${state.outcome ? ' Unfinished flights remain in transit at world end; no further arrivals will occur.' : ''}`;
}
