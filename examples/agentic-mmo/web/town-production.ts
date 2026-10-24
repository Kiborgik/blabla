import { paidCivicWorksReceipt, type CivicWorksView } from '../visuals/civic-works-visuals.ts';
import { civicWorksInspectionKey } from './civic-works-inspection.ts';
import { BUILDINGS } from '../core/content.ts';
import type { FoodSupplyReceipt } from '../core/food-security-content.ts';
import type { City } from '../core/types.ts';
import { buildingIdentity } from '../visuals/building-visuals.ts';
import { operationVisual, type OperationVisual } from '../visuals/operation-visuals.ts';
import { exactNumber } from './number-format.ts';
import { visualIcon } from './world-cues.ts';

export interface TownProductionRow extends OperationVisual {
  buildingId: string;
  name: string;
  result: string;
  recordedAt: string | null;
  inspectKey: string;
}

export function townProductionRows(city: Pick<City, 'buildings' | 'buildingOperations'>, works?: CivicWorksView): TownProductionRow[] {
  return [...city.buildings].reverse().flatMap(buildingId => {
    const definition = BUILDINGS.find(building => building.id === buildingId);
    if (!definition?.operatingInputs) return [];
    const view = operationVisual(city.buildingOperations?.[buildingId]);
    const last = view.last;
    const crew = last?.status === 'civic-works';
    const receipt = works?.last;
    const exactCrew = crew && paidCivicWorksReceipt(receipt) && receipt.commissionId === last.civicWorksCommissionId && receipt.round === last.round;
    const produced = last?.produced.filter(amount => amount.amount > 0) ?? [];
    const result = !last ? 'No operating record yet'
      : crew ? `${exactCrew ? `Crew added ${exactNumber(receipt.extraWork)} work` : 'Crew assigned to construction'} · No Kiln Materials`
      : last.status === 'paused' ? 'Paused in that season'
      : last.status === 'operated' && produced.length ? `Made ${produced.map(amount => `${exactNumber(amount.amount)} ${amount.label}`).join(' · ')}`
      : last.label;
    return [{ ...view, buildingId, inspectKey: crew && works ? civicWorksInspectionKey(works) : buildingId, name: definition.name, result, recordedAt: last ? `Last recorded season · ${last.round}` : null }];
  });
}

function createFoodSupplyReceipt(receipt: FoodSupplyReceipt): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'town-receipt';
  details.dataset['townDisclosure'] = 'food-supply';
  const summary = document.createElement('summary');
  summary.textContent = `Latest Earth household Food · ${receipt.supplied ? 'Supplied' : 'Shortage'} · Round ${exactNumber(receipt.round)}`;
  summary.prepend(visualIcon('food'));
  details.append(summary);
  const facts = [
    ['Opening population', exactNumber(receipt.population)],
    ['Produced', `${exactNumber(receipt.produced)} Food`],
    ['Household meals', `Required ${exactNumber(receipt.required)} Food · Paid ${exactNumber(receipt.paid)} Food`],
    ['Growth paid', `${exactNumber(receipt.growthPaid)} Food`],
    ['Civilization shared stock', `Before ${exactNumber(receipt.foodBefore)} Food → After ${exactNumber(receipt.foodAfter)} Food`],
  ] as const;
  for (const [label, value] of facts) {
    const line = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = `${label}: `;
    line.append(name, document.createTextNode(value));
    details.append(line);
  }
  const meaning = document.createElement('p');
  meaning.textContent = 'Shared stock at this town’s resolution: before its production, then after its meals and growth payments. Not the current total, a whole-round balance, or a forecast.';
  details.append(meaning);
  return details;
}

export function createTownProduction(city: Pick<City, 'buildings' | 'buildingOperations' | 'lastFoodSupply'>, onInspect: (buildingId: string) => void, works?: CivicWorksView): HTMLElement | null {
  const rows = townProductionRows(city, works);
  if (!rows.length && !city.lastFoodSupply) return null;
  const section = document.createElement('section');
  section.className = 'town-production';
  section.setAttribute('aria-label', 'Town production');
  const heading = document.createElement('h4');
  heading.textContent = 'Town production';
  section.append(heading);
  if (city.lastFoodSupply) section.append(createFoodSupplyReceipt(city.lastFoodSupply));
  const more = document.createElement('details');
  more.className = 'town-production-more';
  more.dataset['townDisclosure'] = 'production';
  const summary = document.createElement('summary');
  summary.textContent = `More town production (${Math.max(0, rows.length - 3)})`;
  more.append(summary);
  for (const [index, row] of rows.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'town-production-row';
    button.dataset['productionWork'] = row.buildingId;
    button.dataset['inspectionFocus'] = `production:${row.buildingId}`;
    button.dataset['tone'] = row.tone;
    const title = document.createElement('span');
    title.className = 'town-production-title';
    const name = document.createElement('strong');
    name.textContent = row.name;
    const definition = BUILDINGS.find(building => building.id === row.buildingId);
    const icon = buildingIdentity(row.buildingId)?.icon ?? (row.buildingId === 'foundry' ? 'kiln' : definition?.production.science ? 'science' : definition?.production.culture ? 'culture' : 'infrastructure');
    title.append(visualIcon(icon), name);
    const state = document.createElement('span');
    state.className = 'town-production-state';
    state.textContent = row.current === 'Unknown' ? 'State unavailable' : `${row.current} now`;
    title.append(state);
    const result = document.createElement('span');
    result.className = 'town-production-result';
    result.textContent = row.result;
    button.append(title, result);
    if (row.last) {
      const inputs = document.createElement('span');
      inputs.className = 'town-production-inputs';
      const paid = [...row.last.paid, ...row.last.strategicPaid ?? []].map(amount => `${exactNumber(amount.amount)} ${amount.label}`).join(' · ') || 'None';
      const residents = row.last.residents;
      inputs.textContent = row.last.status === 'civic-works' ? `Crew assigned ${exactNumber(residents?.allocated ?? 0)} local staff · Fee is in the commission record` : `Used ${paid}${residents ? ` · Assigned ${exactNumber(residents.allocated)} resident${residents.allocated === 1 ? '' : 's'}` : ''}`;
      button.append(inputs);
    }
    if (row.recordedAt) {
      const record = document.createElement('span');
      record.className = 'town-production-record';
      record.textContent = row.recordedAt;
      button.append(record);
    }
    const link = document.createElement('span');
    link.className = 'town-production-link';
    link.textContent = 'Inspect record →';
    button.append(link);
    button.addEventListener('click', () => onInspect(row.inspectKey));
    (index < 3 ? section : more).append(button);
  }
  if (rows.length > 3) section.append(more);
  return section;
}
