import { exactNumber, numberElement } from './number-format.ts';
import { extractionFacts, depositLabel } from '../visuals/strategic-resource-visuals.ts';
import type { observedStrategicResources } from '../core/simulation/metals.ts';
import { improvementLastLabel } from '../visuals/improvement-visuals.ts';
import { damageCondition } from '../visuals/damage-visuals.ts';
import { BUILDINGS, IMPROVEMENTS, RESOURCE_IDS } from '../core/content.ts';
import { hasFeatures } from '../core/simulation/history.ts';
import { observedResidentCapacity } from '../core/simulation/operations.ts';
import type { City, WorldState, ResidentCapacityObservation } from '../core/types.ts';
import { buildingAppearance } from '../visuals/building-visuals.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import type { ResourceAmount } from '../visuals/operation-visuals.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import { visualIcon } from './world-cues.ts';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function amountLine(label: string, amounts: ResourceAmount[]): HTMLElement {
  const line = text('p', '', 'operation-amounts');
  line.append(text('strong', `${label}: `));
  if (!amounts.length) line.append(document.createTextNode('None'));
  for (const entry of amounts) {
    const item = text('span', `${exactNumber(entry.amount)} ${entry.label}`);
    item.prepend(visualIcon(entry.resource));
    line.append(item);
  }
  return line;
}

export function residentSupportForWorld(state: WorldState | null, cities: City[]): ResidentCapacityObservation | undefined {
  return state && hasFeatures(state, ['resident-capacity']) ? observedResidentCapacity(cities) : undefined;
}

function townDisclosure(key: string, label: string): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'town-receipt';
  details.dataset['townDisclosure'] = key;
  details.append(text('summary', label));
  return details;
}

export function renderSettlementInspection(host: HTMLElement, cities: readonly City[], selectedId: string | null, onSelect: (id: string) => void, support?: ResidentCapacityObservation, retainedWork = ''): void {
  host.replaceChildren();
  const city = cities.find((entry) => entry.id === selectedId) ?? cities[0];
  if (!city) return;
  let townPicker: HTMLElement | null = null;
  if (cities.length > 1) {
    const label = text('label', 'Town', 'town-picker-label');
    const picker = text('select', '', 'town-picker'); picker.setAttribute('aria-label', 'Choose a settlement'); picker.dataset['inspectionFocus'] = 'town-picker';
    for (const entry of cities) { const option = text('option', entry.name); option.value = entry.id; picker.append(option); }
    picker.value = city.id; picker.addEventListener('change', () => onSelect(picker.value)); label.append(picker); townPicker = label;
  }
  const heading = text('h3', city.name, 'town-heading');
  const people = text('p', `${city.population} people · ${city.wellbeing}% wellbeing`, 'settlement-facts');
  people.prepend(visualIcon('population'));
  host.append(heading, people, text('p', `Focus: ${city.focus} · ${city.damage}% damage`, 'settlement-facts'));
  if (townPicker) host.append(townPicker);
  const capacity = support?.cities.find(entry => entry.cityId === city.id);
  if (support && capacity) {
    const line = text('p', `Local work capacity: ${capacity.capacity} residents`, 'settlement-support');
    line.prepend(visualIcon('population'));
    const explanation = townDisclosure('support', 'How local support works');
    explanation.append(text('p', `${support.communityReserve} residents support ordinary town life. Each paid recipe needs ${support.perPaidRecipe} other local residents.`),
      text('p', 'This is capacity at the current population, before allocation. Work is assigned again each season. People stay in the town. Supplies must also be available.'));
    host.append(line, explanation);
  }
  const founding = city.coastalFounding;
  if (founding) {
    const source = cities.find(entry => entry.id === founding.sourceCityId);
    const receipt = townDisclosure('coastal-founding', `Coastal founding · Round ${founding.foundedRound}`);
    receipt.append(text('p', `${founding.population} residents arrived from ${source?.name ?? founding.sourceCityId} to found ${city.name}.`),
      text('p', `Recorded source tile: ${founding.sourceTileId} · Recorded destination tile: ${founding.destinationTileId}`),
      text('p', `Recorded path: ${founding.pathTileIds.join(' → ')}`, 'coastal-path-facts'),
      amountLine('Paid once', RESOURCE_IDS.flatMap(resource => { const amount = founding.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
      text('p', 'Completed founding record. These residents moved between towns; they were not consumed. This is not a journey in progress.'),
      text('p', `Event ${founding.eventId}`, 'settlement-facts'));
    if (source) {
      const button = text('button', `Show ${source.name}`, 'coastal-source');
      button.type = 'button'; button.dataset['citySelect'] = source.id;
      button.addEventListener('click', () => onSelect(source.id)); receipt.append(button);
    }
    host.append(receipt);
  }
  const condition = damageCondition(city.damage);
  if (condition) {
    const damage = text('div', '', 'city-damage-detail');
    const value = text('strong', condition.text);
    value.prepend(visualIcon(condition.icon));
    damage.append(value, text('p', 'Damage lowers production. A repair changes future seasons; it does not make supplies immediately.'));
    host.append(damage);
  }
  const overview = text('div', '', 'town-overview');
  overview.dataset['inspectionSection'] = 'overview';
  overview.append(...Array.from(host.children)); host.append(overview);
  const activeDistrict = city.construction?.active;
  if (activeDistrict && 'buildingId' in activeDistrict) {
    const definition = BUILDINGS.find(item => item.id === activeDistrict.buildingId);
    const parent = definition?.district ? definition : BUILDINGS.find(item => item.district && definition?.requiresBuildings?.includes(item.id));
    const site = text('section', '', 'building-card');
    site.append(text('h4', `${definition?.name ?? activeDistrict.buildingId} · Under construction`));
    if (parent) {
      const tileId = definition?.district ? activeDistrict.tileId : city.districtSites?.[parent.id];
      site.append(text('p', `${definition?.district ? 'Reserved site' : `At this town’s ${parent.name}`}: ${tileId === undefined ? 'Unavailable' : `Tile ${tileId}`}`, 'building-current'));
    }
    site.append(text('p', `${exactNumber(activeDistrict.workDone)} / ${exactNumber(activeDistrict.workRequired)} work · Not built yet`, 'building-summary'),
      amountLine('Paid once for this order', RESOURCE_IDS.flatMap(resource => { const amount = activeDistrict.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })));
    host.append(site);
  }
  if (activeDistrict && 'kind' in activeDistrict && activeDistrict.kind === 'improvement') {
    const definition = IMPROVEMENTS.find(item => item.id === activeDistrict.improvementId);
    const card = text('section', '', 'building-card worked-site-card');
    const siteHeading = text('h4', `${definition?.name ?? activeDistrict.improvementId} · Under construction`);
    siteHeading.prepend(visualIcon('materials'));
    card.append(siteHeading, text('p', `Reserved site · Tile ${activeDistrict.tileId}`, 'building-current'),
      text('p', `${activeDistrict.workDone} / ${activeDistrict.workRequired} work · Not built yet`, 'building-summary'),
      amountLine('Paid once for this order', RESOURCE_IDS.flatMap(resource => { const amount = activeDistrict.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
      text('p', 'No operating output until after completion and a later staffed season.', 'building-summary'));
    host.append(card);
  }
  for (const site of Object.values(city.improvements ?? {}).toSorted((a, b) => a.tileId - b.tileId)) {
    const definition = IMPROVEMENTS.find(item => item.id === site.improvementId);
    const card = text('section', '', 'building-card worked-site-card');
    card.dataset['improvementTile'] = String(site.tileId);
    const siteHeading = text('h4', `${definition?.name ?? site.improvementId} · Tile ${site.tileId}`);
    siteHeading.prepend(visualIcon('materials'));
    card.append(siteHeading, text('p', `Built · ${site.operation.enabled ? 'On' : 'Paused'} now`, 'building-current'));
    if (definition) card.append(text('p', `Needs ${definition.residentsRequired} local resident each operating season. People stay in this town.`, 'building-summary'),
      amountLine('Base before town productivity', RESOURCE_IDS.flatMap(resource => { const amount = definition.production[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })));
    const built = townDisclosure(`improvement:${site.tileId}:built`, `Completed · Round ${site.completion.completedRound}`);
    built.append(amountLine('Paid once', RESOURCE_IDS.flatMap(resource => { const amount = site.completion.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
      text('p', `Work ${site.completion.workRequired} · Event ${site.completion.eventId}`, 'settlement-facts'));
    card.append(built);
    const last = site.operation.lastResult;
    if (last) {
      const receipt = townDisclosure(`improvement:${site.tileId}:operation`, `Last record · Round ${last.round} · ${improvementLastLabel(last)}`);
      const residents = last.residents;
      receipt.append(text('p', `Assigned: ${residents.allocated} resident`, 'resident-allocation'),
        text('p', `Needed: ${residents.required} · Available then: ${residents.available}`),
        text('p', `Population at start: ${residents.openingPopulation} · Community reserve: ${residents.communityReserve}`),
        text('p', 'This allocation belongs to that recorded season. Current population and pause choices may have changed.'),
        amountLine('Paid that season', RESOURCE_IDS.flatMap(resource => { const amount = last.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
        amountLine('Made', RESOURCE_IDS.flatMap(resource => { const amount = last.produced[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })));
      if (last.extraction) for (const fact of extractionFacts(last.extraction)) receipt.append(text('p', fact, 'extraction-fact'));
      card.append(receipt);
    } else card.append(text('p', 'No operating result has been recorded yet. Output requires a later season with local support.', 'building-summary'));
    host.append(card);
  }
  if (!city.buildings.length && !Object.keys(city.improvements ?? {}).length && !activeDistrict) host.append(text('p', 'No buildings yet', 'settlement-facts'));
  for (const id of city.buildings) {
    const definition = BUILDINGS.find((entry) => entry.id === id);
    const appearance = buildingAppearance(id, 'far');
    const card = document.createElement('section');
    card.className = 'building-card';
    card.dataset['building'] = id;
    const name = text('h4', definition?.name ?? id);
    name.prepend(visualIcon(appearance?.icon ?? 'infrastructure'));
    card.append(name);
    const parent = definition?.district ? definition : BUILDINGS.find(item => item.district && definition?.requiresBuildings?.includes(item.id));
    if (parent) {
      const siteId = city.districtSites?.[parent.id];
      card.append(text('p', siteId === undefined ? `Exact ${parent.name} site unavailable` : `${parent.id === id ? 'Exact district site' : `At this town’s ${parent.name}`} · Tile ${siteId}`, 'building-summary'));
    }
    if (!definition?.operatingInputs) {
      card.append(text('p', 'Built', 'building-current'));
      if (definition?.capabilities?.includes('coastal-departure')) card.append(text('p', 'Coastal departure site. With Navigation, existing residents can found a new coastal town. This building has no operating output.', 'building-summary'));
      host.append(card);
      continue;
    }
    const view = operationVisual(city.buildingOperations?.[id]);
    card.dataset['operation'] = view.current.toLowerCase();
    card.dataset['tone'] = view.tone;
    card.append(text('p', `Built · ${view.current} now`, 'building-current'), text('p', view.summary, 'building-summary'));
    if (support) card.append(text('p', `Needs ${support.perPaidRecipe} local residents each operating season.`, 'building-summary'));
    if (view.last) {
      const receipt = document.createElement('details');
      receipt.className = 'operation-receipt';
      receipt.append(text('summary', `Last record · Round ${view.last.round} · ${view.last.label}`));
      if (view.last.residents) {
        const residents = view.last.residents;
        receipt.append(text('p', `Assigned: ${residents.allocated} residents`, 'resident-allocation'),
          text('p', `Needed: ${residents.required} · Available then: ${residents.available}`),
          text('p', `Population at start: ${residents.openingPopulation} · Community reserve: ${residents.communityReserve}`),
          text('p', 'This is the recorded allocation for that round. Support is assigned again each season.'));
      } else if (support) receipt.append(text('p', 'Resident support was not recorded for this result.'));
      receipt.append(amountLine('Paid', view.last.paid), amountLine('Made', view.last.produced));
      for (const shortage of view.last.shortages) {
        receipt.append(text('p', `${METRIC_LABELS[shortage.resource]} needed ${shortage.required}; ${shortage.available} left in opening stock at round ${view.last.round}.`, 'operation-shortage'));
      }
      if (view.last.status === 'blocked' && !view.last.paid.length && !view.last.produced.length) receipt.append(text('p', 'Nothing was paid or made in that record.', 'operation-shortage'));
      card.append(receipt);
    }
    host.append(card);
  }
  const cards = [...host.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overview);
  const work = text('section', '', 'town-work'); work.dataset['inspectionSection'] = 'work';
  const label = text('label', ''); label.append(text('span', 'Inspect work & buildings', 'sr-only'));
  const picker = text('select', '', 'work-picker'); picker.setAttribute('aria-label', 'Inspect work or building'); picker.dataset['inspectionFocus'] = 'work-picker';
  const detail = text('div', '', 'work-detail');
  for (const [index, card] of cards.entries()) {
    const key = card.dataset['building'] ?? card.dataset['improvementTile'] ?? `active:${index}`;
    card.dataset['workId'] = key;
    const option = text('option', card.querySelector('h4')?.textContent ?? 'No buildings yet'); option.value = key; picker.append(option);
  }
  picker.value = cards.some(card => card.dataset['workId'] === retainedWork) ? retainedWork : cards[0]?.dataset['workId'] ?? '';
  const choose = (): void => {
    const selected = cards.find(card => card.dataset['workId'] === picker.value);
    host.dataset['selectedWork'] = picker.value;
    if (!selected) { detail.replaceChildren(text('p', 'No built or active work in this town.')); return; }
    const preview = text('div', '', 'work-preview');
    const key = selected.dataset['workId'];
    const worked = Object.values(city.improvements ?? {}).find(site => String(site.tileId) === key);
    const operation = key ? city.buildingOperations?.[key] : undefined;
    if (key?.startsWith('active:') && activeDistrict) {
      preview.append(text('strong', 'Under construction'), text('p', `${exactNumber(activeDistrict.workDone)} / ${exactNumber(activeDistrict.workRequired)} work · Not built yet`));
    } else {
      preview.append(text('strong', operation || worked ? `Built · ${(operation ?? worked?.operation)?.enabled ? 'On' : 'Paused'} now` : 'Built'));
      const last = operation?.lastResult ?? worked?.operation.lastResult;
      if (last) {
        preview.append(text('span', `Last recorded season · ${last.round}`, 'work-record-round'));
        const results = text('div', '', 'work-key-results');
        results.append(amountLine('Made', RESOURCE_IDS.flatMap(resource => { const amount = last.produced[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
          amountLine('Used', RESOURCE_IDS.flatMap(resource => { const amount = last.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })));
        preview.append(results);
        if (last.status !== 'operated') preview.append(text('span', last.status === 'paused' ? 'Paused in that season' : 'Could not operate in that season', 'work-record-round'));
      } else preview.append(text('span', operation || worked ? 'No operating result recorded yet' : 'Production records are separate from construction.', 'work-record-round'));
    }
    const full = townDisclosure(`work:${key ?? ''}`, 'Site & full record'); full.className += ' work-full-record'; full.append(selected);
    detail.replaceChildren(preview, full);
  };
  picker.addEventListener('change', choose); label.append(picker); work.append(label, detail);
  for (const card of cards) card.remove();
  host.append(work); choose();
}

export function renderStrategicInspection(host: HTMLElement, facts: ReturnType<typeof observedStrategicResources>): void {
  if (facts.strategicCapacity === undefined) return;
  const section = text('section', '', 'strategic-stock'); section.dataset['inspectionSection'] = 'overview';
  section.setAttribute('aria-label', 'Civilization iron');
  const heading = text('h3', 'Iron'); heading.prepend(visualIcon('materials'));
  const value = text('p', '', 'strategic-stock-value'); value.append(numberElement(facts.strategicResources?.iron ?? 0), text('span', ` stored / ${exactNumber(facts.strategicCapacity)} capacity`));
  section.append(heading, value,
    text('p', 'Civilization stock. Finite deposits and ordinary materials are separate.', 'building-summary'));
  const deposits = townDisclosure('revealed-deposits', `Known iron sites · ${facts.revealedDeposits?.length ?? 0}`);
  if (!facts.revealedDeposits?.length) deposits.append(text('p', 'No deposits are revealed to this civilization.'));
  for (const deposit of facts.revealedDeposits ?? []) deposits.append(text('p', depositLabel(deposit)));
  section.append(deposits); host.append(section);
}
