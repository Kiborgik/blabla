import type { HierarchyAnchor, ScreenBox } from '../visuals/map-hierarchy.ts';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { routeLabelKey, routeMapLabel } from '../visuals/route-visuals.ts';
import { routeMapAnchor, type AtlasWorld } from './atlas.ts';
import { cityKey } from './city-selection.ts';
import { DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';

export interface MapLabel { id: string | number; x: number; y: number; width: number; height: number }

export function mapLabelVisibility(labels: readonly MapLabel[], selected: string | number, detail: DetailLevel, width: number, height: number): boolean[] {
  const visible = labels.map(() => false);
  const chosen = labels.findIndex((label) => label.id === selected);
  const order = labels.map((_, index) => index).toSorted((a, b) => Number(b === chosen) - Number(a === chosen));
  const occupied: MapLabel[] = [];
  for (const index of order) {
    const label = labels[index];
    if (!label || occupied.length >= DETAIL_BUDGETS[detail].labels) continue;
    if (label.x + label.width / 2 < 0 || label.x - label.width / 2 > width || label.y + label.height < 0 || label.y > height) continue;
    if (index !== chosen && occupied.some((other) => Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 6 && Math.abs(label.y - other.y) < Math.max(label.height, other.height) + 4)) continue;
    occupied.push(label);
    visible[index] = true;
  }
  return visible;
}

export function mapHierarchyAnchors(world: AtlasWorld, selected: string, selectedRoute: string | null, project: (q: number, r: number, height: number) => { x: number; y: number }): HierarchyAnchor[] {
  const civilization = world.cities.find(city => cityKey(city) === selected)?.id;
  const anchors: HierarchyAnchor[] = world.cities.map(city => {
    const tileId = world.tiles.find(tile => tile.q === city.q && tile.r === city.r)?.id;
    return { id: cityKey(city), kind: 'town', label: damageMapLabel(city.capital, city.settlement?.damage ?? 0),
      ...project(city.q, city.r, .4), selected: cityKey(city) === selected, importance: city.population ?? 0,
      ...(tileId === undefined ? {} : { tileId }) };
  });
  for (const site of [...world.catchments ?? [], ...world.districts ?? [], ...world.improvements ?? [], ...world.wonders ?? []]) {
    const wonder = 'record' in site;
    const label = 'name' in site ? site.name ?? 'Campus' : 'Aqueduct source';
    anchors.push({ id: site.id, kind: wonder ? 'wonder' : 'site', label: `${label}${site.status === 'building' ? ' · Building' : ''}`,
      ...project(site.q, site.r, site.height + .4), tileId: site.tileId, related: site.cityId === selected, completed: wonder && site.status === 'built' });
  }
  for (const site of world.pastoralSites ?? []) anchors.push({ id: site.id, kind: 'resource', label: 'Horses', ...project(site.q, site.r, site.height + .4), tileId: site.tileId,
    revealed: civilization !== undefined && site.revealedTo.includes(civilization) });
  for (const site of world.deposits ?? []) anchors.push({ id: site.id, kind: 'resource', label: `Iron · ${site.remaining} left`, ...project(site.q, site.r, site.height + .4), tileId: site.tileId,
    revealed: civilization !== undefined && site.revealedTo.some(entry => entry.id === civilization) });
  const route = world.routes.find(entry => entry.id === selectedRoute);
  const point = route && routeMapAnchor(route);
  if (route && point) {
    const axial = { r: point.z / 1.5, q: point.x / Math.sqrt(3) - point.z / 3 };
    anchors.push({ id: routeLabelKey(route.id), kind: 'route', label: routeMapLabel(route), ...project(axial.q, axial.r, point.y), related: true });
  }
  return anchors;
}

export function mapHierarchyObstacles(container: HTMLElement): ScreenBox[] {
  const origin = container.getBoundingClientRect();
  return [...container.parentElement?.querySelectorAll('.civilization-panel, .inspection, .world-heading, .chronicle, .map-tools, .layer-controls, .connection-actions') ?? []].flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.width && box.height ? [{ left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }] : [];
  });
}
