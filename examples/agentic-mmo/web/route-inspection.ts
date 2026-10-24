import { exactNumber } from './number-format.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import { railEdgeId } from '../core/simulation/rail.ts';
import { isTransportQuote } from '../core/simulation/transport.ts';
import type { Resources, StrategicResources, StrategicResource } from '../core/types.ts';
import { strategicResourceAmounts, strategicResourceLabel } from '../visuals/strategic-resource-visuals.ts';
import { routeTitle, routeVisual, ROUTE_LIMIT } from '../visuals/route-visuals.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { hasRouteQuote, routePathOmission, routeTilePage, ROUTE_TILE_PAGE_SIZE } from '../visuals/route-paths.ts';
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

export function routeAmounts(label: string, values: Partial<Resources>, strategic?: StrategicResources): Array<{ resource: keyof Resources | StrategicResource; label: string; amount: number }> {
  const ordinary = RESOURCE_IDS.flatMap((resource) => {
    const amount = values[resource] ?? 0;
    return amount > 0 ? [{ resource, label: `${label}: ${exactNumber(amount)} ${resourceGuide(resource).label}`, amount }] : [];
  });
  return [...ordinary, ...strategicResourceAmounts(strategic).filter(entry => entry.amount > 0).map(entry => ({ ...entry, label: `${label}: ${exactNumber(entry.amount)} ${entry.label}` }))];
}

function amounts(label: string, values: Partial<Resources>, strategic?: StrategicResources): HTMLElement {
  const row = text('p', '', 'route-amounts');
  row.append(text('strong', `${label}: `));
  const entries = routeAmounts(label, values, strategic);
  if (!entries.length) row.append(document.createTextNode('None'));
  for (const entry of entries) {
    const resource = entry.resource;
    const strategic = resource === 'iron' || resource === 'coal';
    const item = text('span', `${exactNumber(entry.amount)} ${strategic ? strategicResourceLabel(resource) : resourceGuide(resource).label}`);
    item.prepend(visualIcon(strategic ? 'materials' : resource));
    row.append(item);
  }
  return row;
}

export interface RoutePathInspection { open: boolean; page: number; steamOpen?: boolean }

export function steamRoutePresentation(route: RouteView) {
  const agreement = route.agreement;
  const quote = agreement?.terms.transport;
  if (!agreement || quote?.mode !== 'steam' || !isTransportQuote(quote, Number.MAX_SAFE_INTEGER)) return null;
  const last = agreement.lastSteamDelivery;
  return {
    terms: [
      `Steam transport · Version ${quote.ruleVersion} · Agreed round ${agreement.acceptedRound}`,
      `Stored exchange interval · ${agreement.terms.cadenceRounds} rounds`,
      `Unrailed comparison at proposal · ${quote.unrailedCadence} rounds · ${quote.unrailedEdges} steps`,
      agreement.terms.cadenceRounds < quote.unrailedCadence ? 'This agreement has a shorter stored interval than its unrailed comparison.' : 'No shorter interval is recorded for this agreement.',
      `Recorded weighted distance · ${exactNumber(quote.weightedDistance)} · Recipe interval floor ${quote.baseCadence} rounds`,
      `Proposer fuel each successful delivery · ${exactNumber(quote.proposerFuel.coal)} Coal`,
    ],
    edges: quote.edgeWeights.map((weight, index) => {
      const from = quote.tileIds[index]; const to = quote.tileIds[index + 1];
      const edge = from === undefined || to === undefined ? undefined : quote.railEdges.find(record => record.edgeId === railEdgeId(from, to));
      return `Tiles ${from} ↔ ${to} · ${edge ? `Rail · Completion ${edge.completionEventId}` : 'Unrailed'} · Recorded weight ${exactNumber(weight)}`;
    }),
    rails: quote.railEdges.map(edge => `Rail edge ${edge.edgeId} · Completion ${edge.completionEventId}`),
    last: last ? {
      heading: `Last successful steam payment · Round ${last.round}`,
      identity: `Route ${last.routeId} · Agreement ${last.offerId} · Event ${last.eventId}`,
      cadence: `Delivered on stored interval · ${last.terms.cadenceRounds} rounds`,
      proposerPaid: last.proposerPaid,
      recipientPaid: last.recipientPaid,
      proposerStrategicPaid: last.proposerStrategicPaid,
      recipientStrategicPaid: last.recipientStrategicPaid,
    } : null,
    explanation: 'Periodic shipments use the consented path and terms. Later rail does not change this agreement. Coal is fuel, separate from cargo and ordinary Energy. Path weights are a route-planning measure, not travel time.',
  };
}

export function routeInspectionIdentity(route: RouteView): string { return JSON.stringify([route.id, route.agreement?.offerId ?? null]); }

export function retainedRoutePathInspection(previous: string | undefined, route: RouteView, open: boolean, page: number, steamOpen = false): RoutePathInspection {
  const retained = previous === routeInspectionIdentity(route) ? { open, page: routeTilePage(route, page).page } : { open: false, page: 0 };
  return route.agreement?.terms.transport?.mode === 'steam' ? { ...retained, steamOpen: previous === routeInspectionIdentity(route) && steamOpen } : retained;
}

function renderPathTiles(card: HTMLElement, route: RouteView, retained: RoutePathInspection): void {
  let page = routeTilePage(route, retained.page);
  if (!page.total) return;
  const details = text('details', '', 'route-path-tiles');
  details.open = retained.open;
  const summary = text('summary', `Recorded tiles · ${page.total}`);
  summary.dataset['routeFocus'] = 'path-summary';
  const ids = text('p', '', 'route-tile-ids');
  const edgeFacts = text('div', '', 'route-edge-records');
  const steam = steamRoutePresentation(route);
  const status = text('span', '');
  const change = (value: number): void => { page = routeTilePage(route, value); render(); };
  const previous = button('Previous tiles', 'path-previous', () => change(page.page - 1));
  const next = button('Next tiles', 'path-next', () => change(page.page + 1));
  const render = (): void => {
    details.dataset['page'] = String(page.page);
    ids.textContent = page.ids.join(' → ');
    if (steam) edgeFacts.replaceChildren(...steam.edges.slice(page.page * ROUTE_TILE_PAGE_SIZE, (page.page + 1) * ROUTE_TILE_PAGE_SIZE).map(fact => text('p', fact, 'inspection-note')));
    status.textContent = `${page.page + 1} / ${page.pages}`;
    previous.disabled = page.page === 0;
    next.disabled = page.page + 1 === page.pages;
  };
  details.append(summary, text('p', route.agreement?.terms.transport?.mode === 'steam' ? 'Each step joins neighboring tiles. The retained quote lists which edges had completed Rail.' : 'Each step joins neighboring tiles. This corridor is not a constructed road.', 'inspection-note'), ids, edgeFacts);
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
    for (const [town, cargo, upkeep, commerce, strategic] of [
      [route.fromTown?.name ?? route.from, terms.proposerCargo, terms.proposerUpkeep, terms.proposerYield, terms.strategicCargo?.proposer],
      [route.toTown?.name ?? route.to, terms.recipientCargo, terms.recipientUpkeep, terms.recipientYield, terms.strategicCargo?.recipient],
    ] as const) {
      card.append(text('h4', town), amounts('Sends', cargo, strategic), amounts('Transport cost', upkeep), amounts('Commerce received', commerce));
    }
    card.append(text('p', `Agreement ${route.agreement?.offerId}`, 'inspection-note'));
  }
  const steam = steamRoutePresentation(route);
  if (steam) {
    const stored = text('details', '', 'route-steam-terms');
    stored.open = retained.steamOpen ?? false;
    const summary = text('summary', 'Stored steam path & fuel'); summary.dataset['routeFocus'] = 'steam-summary';
    stored.append(summary);
    for (const fact of steam.terms) stored.append(text('p', fact));
    stored.append(text('p', `${steam.rails.length} completed Rail references · Exact edges are in Recorded tiles below.`, 'inspection-note'));
    stored.append(text('p', steam.explanation, 'inspection-note'));
    card.append(stored);
    if (steam.last) {
      card.append(text('h3', steam.last.heading), text('p', steam.last.cadence),
        amounts(`${route.fromTown?.name ?? route.from} paid`, steam.last.proposerPaid, steam.last.proposerStrategicPaid),
        amounts(`${route.toTown?.name ?? route.to} paid`, steam.last.recipientPaid, steam.last.recipientStrategicPaid),
        text('p', steam.last.identity, 'inspection-note'), text('p', 'These payments belong to that successful delivery. A later blocked attempt does not replace them.', 'inspection-note'));
    } else card.append(text('p', 'No successful steam payment recorded yet.', 'inspection-note'));
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
