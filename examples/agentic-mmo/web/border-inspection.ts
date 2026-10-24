import type { BorderIncidentView, BorderPartyView } from '../visuals/border-visuals.ts';
import { exactNumber } from './number-format.ts';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function people(count: number): string { return `${exactNumber(count)} ${count === 1 ? 'person' : 'people'}`; }

export function borderIncidentSummary(view: BorderIncidentView): string {
  const resolution = view.incident.resolution;
  const away = view.parties.filter(row => row.party.returned === null && row.party.phase !== 'returned').reduce((sum, row) => sum + row.party.people, 0);
  const loss = view.parties.reduce((sum, row) => sum + row.party.casualties, 0);
  const status = !view.active ? 'Residents returned' : resolution ? 'Result recorded; return not complete' : 'A purchased plot is disputed';
  return `${status}. ${people(away)} away from home.${loss ? ` ${people(loss)} lost.` : ''}`;
}

function partyDetails(view: BorderPartyView): HTMLElement {
  const { party } = view; const departure = party.departure;
  const section = text('section', '', 'border-party-record');
  section.append(text('h4', `${view.identity.name} · ${view.sourceCityName ?? 'Town unavailable'}`),
    text('p', `${people(departure.people)} departed; ${people(party.people)} survive; ${people(party.casualties)} lost.`),
    text('p', `Last recorded phase: ${party.phase}. Tile ${party.positionTileId}.${view.point ? '' : ' Exact map position unavailable.'}`),
    text('p', `Home population at departure: ${exactNumber(departure.sourcePopulationBefore)} → ${exactNumber(departure.sourcePopulationAfter)}.`),
    text('p', `Paid at departure: ${exactNumber(departure.setup.materials)} Materials · ${exactNumber(departure.setup.credits)} Credits · ${exactNumber(departure.cargo.food)} Food · ${exactNumber(departure.legitimacyCost)} Trust.`),
    text('p', `Field Food: ${exactNumber(party.food)} remaining · ${exactNumber(party.foodConsumed)} consumed. Household reserve at departure: ${exactNumber(departure.householdReserve.food)} Food.`),
    text('p', `Recorded departure round ${departure.departureRound}; return limit round ${departure.returnByRound}. This is a stored limit, not a live travel estimate.`),
    text('p', `Departure receipt ${party.departureEventId} · Source ${departure.sourceCityId}.`));
  if (party.steps.length) {
    const steps = text('ol', '', 'border-step-records');
    for (const step of party.steps) steps.append(text('li', `Round ${step.round}: tile ${step.fromTileId} → ${step.toTileId} · ${step.phase} · ${people(step.people)} · Food ${exactNumber(step.foodBefore)} − ${exactNumber(step.foodConsumed)} = ${exactNumber(step.foodAfter)}.`));
    section.append(text('h4', 'Recorded steps'), steps);
  } else section.append(text('p', 'No movement step recorded.'));
  const returned = party.returned;
  section.append(text('p', returned ? `Returned in round ${returned.round}: ${people(returned.people)} to ${returned.sourceCityId}. Home population ${exactNumber(returned.populationBefore)} → ${exactNumber(returned.populationAfter)}. Unused Food refunded ${exactNumber(returned.foodRefunded)}; Food stock ${exactNumber(returned.foodStockBefore)} → ${exactNumber(returned.foodStockAfter)}. Receipt ${returned.eventId}.` : 'No return receipt recorded.'));
  return section;
}

export function borderInspection(view: BorderIncidentView): HTMLElement {
  const incident = view.incident;
  const section = text('section', '', 'border-inspection');
  section.dataset['borderIncident'] = incident.id;
  section.setAttribute('aria-label', `Border incident at tile ${incident.tileId}`);
  section.append(text('h3', `Border incident · Tile ${incident.tileId}`), text('p', borderIncidentSummary(view), 'border-summary'));
  section.append(text('p', `Current control: ${!view.currentControllerKnown ? 'unavailable' : view.currentController?.name ?? 'unclaimed'}.`, 'border-current-control'));
  if (view.active) section.append(text('p', view.parties.filter(row => row.party.returned === null && row.party.phase !== 'returned')
    .map(row => `${row.identity.name}: ${people(row.party.people)} · ${row.party.phase}`).join(' / ') || 'No field residents recorded.', 'border-phases'));
  section.append(text('p', 'Phases describe the last committed record. No movement is shown between recorded steps.', 'inspection-note'));
  const details = text('details', '', 'border-records');
  details.dataset['borderDetails'] = incident.id;
  details.append(text('summary', 'People, supplies and receipts'));
  details.append(text('p', `Opened round ${incident.openedRound}. Recorded response: ${incident.response}${incident.responseRound === null ? '' : ` in round ${incident.responseRound}`}. Response deadline ${incident.responseDeadlineRound}; resolution scheduled for round ${incident.resolveRound}.`));
  if (incident.responseEventId) details.append(text('p', `Response receipt ${incident.responseEventId}.`));
  details.append(text('p', view.purchase ? `Original purchase: ${view.purchaser?.name ?? `Civilization ${view.purchase.civId}`} paid ${exactNumber(view.purchase.paid.credits)} Credits in round ${view.purchase.acquiredRound}. Receipt ${view.purchase.eventId}. This purchase history does not describe current control.` : 'Original purchase receipt unavailable. No payment is inferred.'));
  if (view.currentControlReceipt) {
    const control = view.currentControlReceipt;
    details.append(text('p', `Current control receipt: civilization ${control.previousCivId} → ${control.civId}; town ${control.previousCityId} → ${control.cityId}; round ${control.round}; receipt ${control.eventId}. Only this plot changed control; no city was captured.`));
  }
  const resolution = incident.resolution;
  if (resolution) {
    const outcome = { captured: 'Plot control changed', defended: 'Plot control retained', withdrawn: 'Withdrawal recorded', cancelled: 'Incident cancelled' }[resolution.outcome];
    details.append(text('p', `${outcome} in round ${resolution.round}. ${resolution.reason} Receipt ${resolution.eventId}.`));
    if (resolution.clash) details.append(text('p', `One clash recorded: civilization ${resolution.clash.casualtyCivId} lost ${people(resolution.clash.casualties)}. Recorded strengths ${exactNumber(resolution.clash.initiatorPower)} / ${exactNumber(resolution.clash.defenderPower)}; roll ${exactNumber(resolution.clash.roll)}; winner civilization ${resolution.clash.winnerId}.`));
    else details.append(text('p', 'No clash was recorded.'));
  } else details.append(text('p', 'No resolution has been recorded.'));
  for (const party of view.parties) details.append(partyDetails(party));
  if (view.completedRound !== null) details.append(text('p', `Incident completed in round ${view.completedRound}.`));
  details.append(text('p', `Incident ${incident.id} · Purchase ${incident.purchaseId}.`, 'inspection-note'));
  section.append(details);
  return section;
}

export function renderBorderInspection(host: HTMLElement, views: readonly BorderIncidentView[], cityId: string): void {
  const previous = [...host.querySelectorAll<HTMLDetailsElement>('.border-records')];
  const open = new Set(previous.filter(details => details.open).map(details => details.dataset['borderDetails']));
  for (const section of host.querySelectorAll('.border-inspection')) section.remove();
  for (const view of views.filter(row => row.incident.sourceCityId === cityId || row.incident.defenderCityId === cityId || row.parties.some(party => party.sourceCityId === cityId))) {
    const section = borderInspection(view);
    const details = section.querySelector('details');
    if (details) details.open = open.has(view.incident.id);
    host.append(section);
  }
}
