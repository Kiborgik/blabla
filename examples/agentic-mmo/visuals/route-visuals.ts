import type { Route } from '../core/types.ts';
import type { RoutePath } from './route-paths.ts';

export interface RouteTown {
  id: string;
  name: string;
  civilization: string;
  color: string;
  q: number;
  r: number;
}

export interface RouteView extends Route {
  path?: RoutePath;
  ownerName: string;
  partnerName: string;
  fromTown: RouteTown | null;
  toTown: RouteTown | null;
  illustrative?: boolean;
}

export interface RouteVisual {
  status: 'sample' | 'legacy' | 'stopped' | 'damaged' | 'path-blocked' | 'blocked' | 'agreed';
  label: string;
  symbol: string;
  dash: readonly number[];
  color: string;
  consent: string;
  lastAttempt: string;
  lastDelivery: string;
  nextDue: string;
}

export const ROUTE_LIMIT = 12;

export function routeVisual(route: RouteView): RouteVisual {
  const agreement = route.agreement;
  const base = { lastAttempt: 'No recorded attempt', lastDelivery: 'No recorded delivery', nextDue: 'No scheduled delivery recorded' };
  if (route.illustrative) return { ...base, status: 'sample', label: 'Sample link', symbol: '◇', dash: [3, 4], color: '#b9c9d6', consent: 'Illustrative only' };
  if (!agreement) return { ...base, status: 'legacy', label: 'Legacy route', symbol: '◇', dash: [2, 5], color: '#b9c9d6', consent: 'Agreement not recorded' };
  const lastAttempt = agreement.lastAttemptRound === null ? 'No recorded attempt'
    : agreement.blockedReason ? `Last attempt blocked · round ${agreement.lastAttemptRound}: ${agreement.blockedReason}`
      : agreement.lastDeliveryRound === agreement.lastAttemptRound ? `Last attempt delivered · round ${agreement.lastAttemptRound}`
        : `Last attempt · round ${agreement.lastAttemptRound}; result unavailable`;
  const facts = {
    consent: agreement.enabled ? `Agreed · accepted round ${agreement.acceptedRound}` : `Trade stopped${agreement.closedRound === null ? '' : ` · round ${agreement.closedRound}`}`,
    lastAttempt,
    lastDelivery: agreement.lastDeliveryRound === null ? 'No recorded delivery'
      : `Last delivered round ${agreement.lastDeliveryRound} · ${agreement.deliveryCount} completed ${agreement.deliveryCount === 1 ? 'delivery' : 'deliveries'}`,
    nextDue: agreement.enabled ? `${agreement.deliveryCount === 0 ? 'First' : 'Next'} due round ${agreement.nextDeliveryRound}` : 'No future deliveries while stopped',
  };
  if (!agreement.enabled) return { ...facts, status: 'stopped', label: 'Trade stopped', symbol: '■', dash: [3, 7], color: '#b9c9d6' };
  if (route.path?.currentBlock) return { ...facts, status: 'path-blocked', label: 'Path cannot pass now', symbol: '!', dash: [8, 3], color: '#f4c27e' };
  if (route.damage >= agreement.terms.damageDisableAt) return { ...facts, status: 'damaged', label: `Damage now ${route.damage}%`, symbol: '!', dash: [8, 3], color: '#f4c27e' };
  if (agreement.blockedReason !== null) return { ...facts, status: 'blocked', label: 'Last attempt blocked', symbol: '!', dash: [8, 3], color: '#f4c27e' };
  return { ...facts, status: 'agreed', label: agreement.deliveryCount === 0 ? 'Agreed · first delivery pending' : 'Agreed trade', symbol: '↔', dash: [], color: '#ffe3a0' };
}

export function visibleRoutes(routes: readonly RouteView[], selected: string | null): RouteView[] {
  return routes.filter((route) => route.fromTown && route.toTown && (route.id === selected || route.illustrative || route.agreement?.enabled))
    .toSorted((a, b) => Number(b.id === selected) - Number(a.id === selected) || a.id.localeCompare(b.id))
    .slice(0, ROUTE_LIMIT);
}

export function routeTitle(route: RouteView): string {
  return `${route.fromTown?.name ?? route.from} ↔ ${route.toTown?.name ?? route.to}`;
}

export function routeMapLabel(route: RouteView): string {
  const visual = routeVisual(route);
  const label = visual.status === 'agreed' ? route.path?.kind === 'land' ? 'Recorded land path' : 'Agreed · schematic' : visual.label;
  return `${visual.symbol} ${label}`;
}

export function routeLabelKey(id: string): string { return `route:${id}`; }

export interface RouteLabelBounds { x: number; y: number; width: number; height: number }

export function routeLabelPlacement(anchor: { x: number; y: number }, occupied: readonly RouteLabelBounds[], width: number, height: number, dimensions: Pick<RouteLabelBounds, 'width' | 'height'> = { width: 180, height: 44 }): RouteLabelBounds | null {
  const { width: labelWidth, height: labelHeight } = dimensions;
  if (!Number.isFinite(labelWidth) || !Number.isFinite(labelHeight) || labelWidth <= 0 || labelHeight <= 0 || labelWidth + 16 > width || labelHeight + 16 > height) return null;
  const x = Math.max(8 + labelWidth / 2, Math.min(width - 8 - labelWidth / 2, anchor.x));
  const y = Math.max(8 + labelHeight / 2, Math.min(height - 8 - labelHeight / 2, anchor.y));
  const vertical = labelHeight + 28; const diagonal = labelWidth / 2 + 22; const horizontal = labelWidth + 16;
  const offsets = [[0, 0], [0, -vertical], [0, vertical], [-diagonal, -vertical], [diagonal, -vertical], [-diagonal, vertical], [diagonal, vertical], [-horizontal, 0], [horizontal, 0]] as const;
  for (const [dx, dy] of offsets) {
    const label = { x: x + dx, y: y + dy - labelHeight / 2, width: labelWidth, height: labelHeight };
    if (label.x - labelWidth / 2 < 8 || label.x + labelWidth / 2 > width - 8 || label.y < 8 || label.y + labelHeight > height - 8) continue;
    if (occupied.some((other) => Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 6 && label.y < other.y + other.height + 6 && label.y + label.height + 6 > other.y)) continue;
    return label;
  }
  return null;
}

export function routeInspectionCity(route: RouteView): string | null { return route.fromTown?.id ?? route.toTown?.id ?? null; }
