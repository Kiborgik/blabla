import type { AtlasCivilization, AtlasWorld } from './atlas.ts';
import type { ViewerPreferences } from './viewer-state.ts';

export function cityKey(city: AtlasCivilization): string {
  return city.cityId ?? `sample:${city.id}`;
}

export function selectedCity(world: AtlasWorld, selection: Pick<ViewerPreferences, 'selected' | 'selectedCity'>): AtlasCivilization | undefined {
  return world.cities.find((city) => cityKey(city) === selection.selectedCity)
    ?? world.cities.find((city) => city.id === selection.selected)
    ?? world.cities[0];
}

export function resolveCitySelection(world: AtlasWorld, selection: Pick<ViewerPreferences, 'selected' | 'selectedCity'>): Pick<ViewerPreferences, 'selected' | 'selectedCity'> {
  const city = selectedCity(world, selection);
  return { selected: city?.id ?? 0, selectedCity: city ? cityKey(city) : null };
}

export function retainedReceiptBuilding(previousCity: string | null, currentCity: string | null, buildingId: string | undefined): string | null {
  return previousCity !== null && previousCity === currentCity ? buildingId ?? null : null;
}
