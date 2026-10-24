import { districtAdjacencySummary, districtLabel, districtMark, type DistrictView } from '../visuals/district-visuals.ts';

import { improvementLabel, improvementMark } from '../visuals/improvement-visuals.ts';
import { wonderSiteLabel } from '../visuals/wonder-visuals.ts';
import type { AtlasWorld } from './atlas.ts';

export type SiteInspectionWork = string | null;
export type SiteInspectionSelect = (cityId: string, workId?: SiteInspectionWork) => void;

export function districtInspectionWork(site: DistrictView): SiteInspectionWork {
  if (site.status === 'building') {
    const order = site.construction;
    return order && 'buildingId' in order && order.id && order.cityId === site.cityId && order.tileId === site.tileId
      && (!site.buildingId || order.buildingId === site.buildingId) ? `active:${order.id}` : null;
  }
  if (site.buildingId?.trim()) return site.buildingId;
  return site.buildingId === undefined && (site.name === undefined || site.name === 'Campus') ? 'campus' : null;
}

export function siteInspectionRequestKey(request: SiteInspectionWork | undefined): string {
  return request === undefined ? 'retain' : JSON.stringify([request]);
}

export function inspectionRequestNeedsRender(request: SiteInspectionWork | undefined, fingerprint: string, previousFingerprint: string): boolean {
  return request !== undefined || fingerprint !== previousFingerprint;
}

export function inspectionSectionForSiteWork(request: SiteInspectionWork | undefined, available: readonly string[], retained: string): string {
  return request === undefined ? retained : request !== null && available.includes(request) ? 'work' : 'overview';
}

export function bindSiteInspection(element: HTMLElement | SVGElement, cityId: string, workId: SiteInspectionWork | undefined, select: SiteInspectionSelect): void {
  const choose = (): void => select(cityId, workId);
  element.addEventListener('click', choose);
  element.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(); }
  });
}

export function handoffSiteOverlayFocus(element: HTMLElement | SVGElement, container: HTMLElement, cityId: string, workId: SiteInspectionWork | undefined, select: SiteInspectionSelect): void {
  if (document.activeElement !== element) return;
  element.blur();
  if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
  container.focus({ preventScroll: true });
  queueMicrotask(() => {
    if (document.activeElement !== container) return;
    select(cityId, workId);
    const shell = container.closest('#app') ?? container.parentElement;
    const panel = shell?.querySelector<HTMLElement>('.inspection');
    const target = panel?.querySelector<HTMLElement>(panel.dataset['inspectionView'] === 'work' ? '.work-picker' : '[data-inspection-focus="overview"]')
      ?? panel?.querySelector<HTMLElement>('.sheet-close');
    if (target) target.focus({ preventScroll: true });
    else { if (!container.hasAttribute('tabindex')) container.tabIndex = -1; container.focus({ preventScroll: true }); }
  });
}

export function siteInspectionName(site: { label: string; townName: string; tileId: number; status: 'built' | 'building'; kind: string; adjacency?: DistrictView['adjacency'] }): string {
  return `Inspect ${site.label} of ${site.townName}, tile ${site.tileId}. ${site.status === 'building' ? 'Under construction' : 'Built'} ${site.kind}${site.adjacency ? `. ${districtAdjacencySummary(site.adjacency)}` : ''}`;
}

export function mapInspectionSites(world: AtlasWorld) {
  return [
    ...(world.catchments ?? []).map(site => ({ ...site, kind: 'catchment' as const, mark: 'catchment' as const, label: `Aqueduct mountain source${site.status === 'building' ? ' · Building' : ''}` })),
    ...(world.districts ?? []).map(site => ({ ...site, kind: 'district' as const, workId: districtInspectionWork(site), mark: districtMark(site), label: districtLabel(site) })),
    ...(world.improvements ?? []).map(site => ({ ...site, kind: 'improvement' as const, mark: improvementMark(site), workId: site.status === 'building' ? site.construction?.id ? `active:${site.construction.id}` : null : String(site.tileId), label: improvementLabel(site) })),
    ...(world.wonders ?? []).map(site => ({ ...site, kind: 'wonder' as const, mark: 'wonder' as const, label: wonderSiteLabel(site) })),
  ];
}

export interface SiteOverlayFocus { id: string; world: string }

export function retainSiteOverlayFocus(container: HTMLElement, world: string): SiteOverlayFocus | null {
  const active = document.activeElement;
  const id = active?.getAttribute('data-site-id');
  if (!id || !active || !container.contains(active) || container.dataset['siteFocusWorld'] !== world) return null;
  if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
  container.focus({ preventScroll: true });
  return { id, world };
}

export function restoreSiteOverlayFocus(container: HTMLElement, retained: SiteOverlayFocus, world: string, site: { cityId: string; workId?: SiteInspectionWork } | undefined, select: SiteInspectionSelect): void {
  if (retained.world !== world || document.activeElement !== container) return;
  const target = [...container.querySelectorAll<HTMLElement | SVGElement>('[data-site-id]')].find(element => element.getAttribute('data-site-id') === retained.id);
  if (target && !target.hasAttribute('hidden') && target.getAttribute('tabindex') !== '-1' && target.getAttribute('aria-hidden') !== 'true') target.focus({ preventScroll: true });
  else if (site) handoffSiteOverlayFocus(container, container, site.cityId, site.workId, select);
}
