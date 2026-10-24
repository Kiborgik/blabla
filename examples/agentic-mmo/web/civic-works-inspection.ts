import { BUILDINGS } from '../core/content.ts';
import type { CivicWorksReceipt } from '../core/civic-works-types.ts';
import type { GameEvent } from '../core/types.ts';
import { recordedCivicWorks, type CivicWorksView } from '../visuals/civic-works-visuals.ts';
import { exactNumber } from './number-format.ts';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value; element.className = className;
  return element;
}

function buildingName(id: string): string {
  return BUILDINGS.find(building => building.id === id)?.name ?? id;
}

export function civicWorksResultLabel(receipt: CivicWorksReceipt): string {
  return receipt.status === 'worked' ? 'Crew work paid' : receipt.status === 'blocked' ? 'Crew could not work'
    : receipt.terminal === 'order-completed' ? 'Ordinary work finished the order' : receipt.terminal === 'order-lost' ? 'Exact order no longer active' : 'Commission ended';
}

export function civicWorksResultSummary(receipt: CivicWorksReceipt): string {
  return receipt.status === 'worked'
    ? `${exactNumber(receipt.ordinaryWork)} ordinary + ${exactNumber(receipt.extraWork)} crew work. Paid 1 Material + 2 Credits; 3 local staff. No Kiln Materials.`
    : 'No crew payment, reassignment or extra work. Ordinary work and production remain separate.';
}

export function civicWorksReceiptLines(receipt: CivicWorksReceipt): string[] {
  const staff = receipt.residents;
  return [
    `Town ${receipt.cityId} · Tile ${receipt.targetTileId} · Order ${receipt.orderId} · ${buildingName(receipt.buildingId)}`,
    `Scheduled rounds ${receipt.firstRound} and ${receipt.expiresRound} · Recorded round ${receipt.round}`,
    `Work before ${exactNumber(receipt.workBefore)} / ${exactNumber(receipt.workRequired)} · Ordinary ${exactNumber(receipt.ordinaryWork)} · Extra crew ${exactNumber(receipt.extraWork)}`,
    receipt.status === 'worked' ? 'Commission paid 1 Material + 2 Credits. No ordinary Kiln Energy charge or Materials output in this beat.' : 'Commission paid nothing and added no extra work.',
    ...(staff ? [`Crew allocation ${staff.allocated} / ${staff.required} local staff · ${staff.available} available then`, `Opening population ${staff.openingPopulation} · Community reserve ${staff.communityReserve}`] : ['No crew staff reassigned.']),
    receipt.reason,
    ...(receipt.terminal ? [receipt.terminal === 'expired' ? 'The fixed commission window ended. It did not renew.' : receipt.terminal === 'order-completed' ? 'This exact construction order completed. Later production is separate.' : 'The exact order ended or changed; this commission cannot transfer to its replacement.'] : []),
    `Commission ${receipt.commissionId} · Acceptance event ${receipt.acceptedEventId} · Result event ${receipt.eventId}`,
  ];
}

export function civicWorksInspectionKey(view: CivicWorksView): string {
  return `civic-works:${view.active?.id ?? view.last?.commissionId ?? ''}`;
}

export function civicWorksPreview(view: CivicWorksView): HTMLElement {
  const preview = text('div', '', 'civic-works-preview');
  const active = view.active;
  const last = view.last;
  if (active) preview.append(text('strong', `Kiln crew · ${buildingName(active.buildingId)}`),
    text('p', `Exact order ${active.orderId} · Tile ${active.targetTileId}`),
    text('p', `Scheduled rounds ${active.firstRound} and ${active.expiresRound}. Each beat still needs full funding and local staff.`));
  if (last) preview.append(text('strong', `${active && active.id !== last.commissionId ? 'Previous commission · ' : ''}${civicWorksResultLabel(last)}`),
    text('p', civicWorksResultSummary(last)), text('span', `Last recorded season · ${last.round}`, 'work-record-round'));
  else preview.append(text('p', 'Commission accepted; no crew work or payment recorded yet.'));
  return preview;
}

export function createCivicWorksInspection(view: CivicWorksView | undefined): HTMLElement | null {
  if (!view || !view.active && !view.last) return null;
  const card = text('section', '', 'building-card civic-works-card');
  card.dataset['workId'] = civicWorksInspectionKey(view);
  card.append(text('h4', 'Kiln crew · Exact building commission'));
  const active = view.active;
  if (active) card.append(text('p', `Commission ${active.id} · Town ${active.cityId} · Tile ${active.targetTileId}`),
    text('p', `Order ${active.orderId} · ${buildingName(active.buildingId)} · Donor Kiln`),
    text('p', `Accepted round ${active.acceptedRound} · Scheduled rounds ${active.firstRound} and ${active.expiresRound} · Acceptance event ${active.acceptedEventId}`),
    text('p', 'Each successful beat assigns three existing local staff and pays 1 Material + 2 Credits for extra construction work instead of Kiln production. No payment was made at acceptance.'));
  if (view.last) {
    const receipt = view.last;
    const record = text('details', '', 'operation-receipt');
    record.dataset['townDisclosure'] = `civic-works-result:${receipt.commissionId}`;
    record.append(text('summary', `${active && active.id !== receipt.commissionId ? 'Previous commission' : 'Latest crew result'} · Round ${receipt.round} · ${civicWorksResultLabel(receipt)}`));
    for (const line of civicWorksReceiptLines(receipt)) record.append(text('p', line));
    card.append(record);
  } else card.append(text('p', 'No crew work or payment recorded yet.'));
  card.append(text('p', 'People remain in this town. Construction payment, crew fees and later building operation are separate records.'));
  return card;
}

export function civicWorksStory(event: GameEvent, townName?: (id: string) => string): { title: string; category: string; summary: string; cause: string; details: string[] } | null {
  const receipt = recordedCivicWorks(event);
  if (receipt) return { title: `${townName?.(receipt.cityId) ?? 'Kiln crew'} · ${buildingName(receipt.buildingId)}`, category: civicWorksResultLabel(receipt),
    summary: civicWorksResultSummary(receipt), cause: receipt.status === 'worked' ? 'Three local Kiln staff worked on this already-paid order instead of making Materials.' : receipt.reason, details: civicWorksReceiptLines(receipt) };
  if (event.type !== 'civic-works-accepted' || event.actor === null || event.target !== event.actor
    || event.cause !== 'Completed State workforce authorized an exact paid ordinary building commission') return null;
  const identity = /^City (\S+); order (\S+); donor kiln$/.exec(event.effects[0] ?? '');
  const schedule = /^Scheduled rounds (\d+) and (\d+); no escrow or payment on acceptance$/.exec(event.effects[1] ?? '');
  if (!identity || !schedule || Number(schedule[1]) !== event.round + 1 || Number(schedule[2]) !== event.round + 2) return null;
  return { title: `${townName?.(identity[1]!) ?? 'Kiln crew'} · Commission accepted`, category: 'Crew commissioned', cause: '',
    summary: `Rounds ${schedule[1]} and ${schedule[2]} reserved for this exact order. No crew payment or work yet.`,
    details: [`Town ${identity[1]} · Tile ${event.tileId} · Order ${identity[2]}`, `Commission ${event.detail} · Acceptance event ${event.id}`] };
}
