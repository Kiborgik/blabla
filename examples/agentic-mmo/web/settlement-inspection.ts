import { damageCondition } from '../visuals/damage-visuals.ts';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
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
    const item = text('span', `${entry.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${entry.label}`);
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

export function renderSettlementInspection(host: HTMLElement, cities: readonly City[], selectedId: string | null, onSelect: (id: string) => void, support?: ResidentCapacityObservation): void {
  host.replaceChildren();
  const city = cities.find((entry) => entry.id === selectedId) ?? cities[0];
  if (!city) return;
  if (cities.length > 1) {
    const picker = document.createElement('div');
    picker.className = 'city-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Choose a settlement');
    for (const entry of cities) {
      const button = text('button', entry.name);
      button.type = 'button';
      button.dataset['citySelect'] = entry.id;
      button.setAttribute('aria-pressed', String(entry.id === city.id));
      button.addEventListener('click', () => onSelect(entry.id));
      picker.append(button);
    }
    host.append(picker);
  }
  const heading = text('h3', city.name);
  const people = text('p', `${city.population} people · ${city.wellbeing}% wellbeing`, 'settlement-facts');
  people.prepend(visualIcon('population'));
  host.append(heading, people, text('p', `Focus: ${city.focus} · ${city.damage}% damage`, 'settlement-facts'));
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
  if (!city.buildings.length) host.append(text('p', 'No buildings yet', 'settlement-facts'));
  for (const id of city.buildings) {
    const definition = BUILDINGS.find((entry) => entry.id === id);
    const appearance = buildingAppearance(id, 'far');
    const card = document.createElement('section');
    card.className = 'building-card';
    card.dataset['building'] = id;
    const name = text('h4', definition?.name ?? id);
    name.prepend(visualIcon(appearance?.icon ?? 'infrastructure'));
    card.append(name);
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
}
