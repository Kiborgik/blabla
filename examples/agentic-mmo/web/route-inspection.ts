import { RESOURCE_IDS } from '../core/content.ts';
import type { Resources } from '../core/types.ts';
import { routeTitle, routeVisual, ROUTE_LIMIT } from '../visuals/route-visuals.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { hasRouteQuote, routePathOmission, routeTilePage } from '../visuals/route-paths.ts';
import { resourceGuide } from './viewer-appearance.ts';
import { visualIcon } from './world-cues.ts';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function button(value: string, key: string, action: () => void): HTMLButtonElement {
  const result = text('button', value);
  result.type = 'button';
  result.dataset['routeFocus'] = key;
  result.addEventListener('click', action);
  return result;
}

export function routePage(routes: readonly RouteView[], page: number): { rows: RouteView[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(routes.length / ROUTE_LIMIT));
  const current = Math.max(0, Math.min(pages - 1, (Number.isFinite(page) ? Math.trunc(page) : 0)));
  return { rows: routes.toSorted((a, b) => a.id.localeCompare(b.id)).slice(current * ROUTE_LIMIT, (current + 1) * ROUTE_LIMIT), page: current, pages };
}

export function routeAmounts(label: string, values: Partial<Resources>): Array<{ resource: keyof Resources; label: string; amount: number }> {
  return RESOURCE_IDS.flatMap((resource) => {
    const amount = values[resource] ?? 0;
    return amount > 0 ? [{ resource, label: `${label}: ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${resourceGuide(resource).label}`, amount }] : [];
  });
}

function amounts(label: string, values: Partial<Resources>): HTMLElement {
  const row = text('p', '', 'route-amounts');
  row.append(text('strong', `${label}: `));
  const entries = routeAmounts(label, values);
  if (!entries.length) row.append(document.createTextNode('None'));
  for (const entry of entries) {
    const item = text('span', `${entry.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${resourceGuide(entry.resource).label}`);
    item.prepend(visualIcon(entry.resource));
    row.append(item);
  }
  return row;
}

export interface RoutePathInspection { open: boolean; page: number }

export function routeInspectionIdentity(route: RouteView): string { return JSON.stringify([route.id, route.agreement?.offerId ?? null]); }

export function retainedRoutePathInspection(previous: string | undefined, route: RouteView, open: boolean, page: number): RoutePathInspection {
  return previous === routeInspectionIdentity(route) ? { open, page: routeTilePage(route, page).page } : { open: false, page: 0 };
}

function renderPathTiles(card: HTMLElement, route: RouteView, retained: RoutePathInspection): void {
  let page = routeTilePage(route, retained.page);
  if (!page.total) return;
  const details = text('details', '', 'route-path-tiles');
  details.open = retained.open;
  const summary = text('summary', `Recorded tiles · ${page.total}`);
  summary.dataset['routeFocus'] = 'path-summary';
  const ids = text('p', '', 'route-tile-ids');
  const status = text('span', '');
  const change = (value: number): void => { page = routeTilePage(route, value); render(); };
  const previous = button('Previous tiles', 'path-previous', () => change(page.page - 1));
  const next = button('Next tiles', 'path-next', () => change(page.page + 1));
  const render = (): void => {
    details.dataset['page'] = String(page.page);
    ids.textContent = page.ids.join(' → ');
    status.textContent = `${page.page + 1} / ${page.pages}`;
    previous.disabled = page.page === 0;
    next.disabled = page.page + 1 === page.pages;
  };
  details.append(summary, text('p', 'Each step joins neighboring tiles. This corridor is not a constructed road.', 'inspection-note'), ids);
  if (page.pages > 1) {
    const pager = text('div', '', 'route-pages');
    pager.append(previous, status, next);
    details.append(pager);
  }
  render();
  card.append(details);
}

export function renderRouteCard(host: HTMLElement, route: RouteView, onTown: (id: string) => void, retained: RoutePathInspection = { open: false, page: 0 }): void {
  const visual = routeVisual(route);
  const card = text('section', '', 'route-card');
  card.setAttribute('aria-label', 'Selected trade route');
  card.append(text('span', 'TRADE ROUTE', 'eyebrow'), text('h2', routeTitle(route)), text('strong', `${visual.symbol} ${visual.label}`, 'route-status'));
  const quoted = hasRouteQuote(route);
  const total = routeTilePage(route, 0).total;
  card.append(text('p', quoted ? total ? `Recorded land path · ${total - 1} steps` : 'Recorded path unavailable' : 'Schematic link between towns. No travel time or terrain path is recorded.', 'inspection-note'));
  const omission = routePathOmission(route);
  if (omission) card.append(text('p', omission, 'inspection-note'));
  for (const [id, town] of [[route.from, route.fromTown], [route.to, route.toTown]] as const) {
    const endpoint = text('div', '', 'route-endpoint');
    endpoint.append(text('strong', town?.name ?? id), text('small', town ? `${town.civilization} · ${id}` : `Endpoint unavailable · ${id}`));
    if (town) endpoint.append(button(`Show ${town.name}`, `town:${id}`, () => onTown(id)));
    card.append(endpoint);
  }
  card.append(text('h3', 'Current state'), text('p', visual.consent), text('p', `${route.ownerName} ↔ ${route.partnerName}`), text('p', `Damage now: ${route.damage}%`));
  if (route.path?.currentBlock) card.append(text('p', `Path now: ${route.path.currentBlock}`, 'route-status'), text('p', 'This describes current terrain, not a new delivery attempt.', 'inspection-note'));
  if (route.agreement) card.append(text('p', `Deliveries cannot run at ${route.agreement.terms.damageDisableAt}% damage or more.`));
  card.append(text('h3', 'Recorded deliveries'), text('p', visual.lastAttempt), text('p', visual.lastDelivery), text('p', visual.nextDue));
  if (route.agreement?.blockedReason) card.append(text('p', 'The block describes that attempt. Supplies or damage may have changed since then.', 'inspection-note'));
  const terms = route.agreement?.terms;
  if (terms) {
    card.append(text('h3', 'Stored schedule'), text('p', `Exchange interval: ${terms.cadenceRounds} rounds`));
    if (quoted) card.append(text('p', 'Cargo is exchanged on a due successful round. There is no shipment in progress between rounds.', 'inspection-note'));
    card.append(text('h3', 'Agreed terms'), text('p', 'Amounts for each successful delivery. These are not new gains.', 'inspection-note'));
    for (const [town, cargo, upkeep, commerce] of [
      [route.fromTown?.name ?? route.from, terms.proposerCargo, terms.proposerUpkeep, terms.proposerYield],
      [route.toTown?.name ?? route.to, terms.recipientCargo, terms.recipientUpkeep, terms.recipientYield],
    ] as const) {
      card.append(text('h4', town), amounts('Sends', cargo), amounts('Transport cost', upkeep), amounts('Commerce received', commerce));
    }
    card.append(text('p', `Agreement ${route.agreement?.offerId}`, 'inspection-note'));
  }
  renderPathTiles(card, route, retained);
  card.append(text('p', `Route ${route.id}`, 'inspection-note'));
  host.append(card);
}

export function renderRouteList(host: HTMLElement, routes: readonly RouteView[], selected: string | null, page: number, onSelect: (id: string) => void, onPage: (page: number) => void): void {
  if (!routes.length) return;
  const section = text('section', '', 'route-list');
  section.setAttribute('aria-label', 'Inspect trade routes');
  section.append(text('h3', `Trade routes · ${routes.length}`), text('p', 'Tap a route to inspect. Only agreed links appear by default; stopped and legacy routes appear when selected.', 'inspection-note'));
  const current = routePage(routes, page);
  for (const route of current.rows) {
    const visual = routeVisual(route);
    const row = button('', `route:${route.id}`, () => onSelect(route.id));
    row.setAttribute('aria-pressed', String(route.id === selected));
    row.append(text('strong', `${visual.symbol} ${routeTitle(route)}`), text('small', visual.label));
    section.append(row);
  }
  if (current.pages > 1) {
    const pager = text('div', '', 'route-pages');
    const previous = button('Previous', 'previous', () => onPage(current.page - 1));
    const next = button('Next', 'next', () => onPage(current.page + 1));
    previous.disabled = current.page === 0;
    next.disabled = current.page === current.pages - 1;
    pager.append(previous, text('span', `${current.page + 1} / ${current.pages}`), next);
    section.append(pager);
  }
  host.append(section);
}
