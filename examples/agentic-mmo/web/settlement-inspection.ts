import { damageCondition } from '../visuals/damage-visuals.ts';
import { BUILDINGS } from '../core/content.ts';
import type { City } from '../core/types.ts';
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

export function renderSettlementInspection(host: HTMLElement, cities: readonly City[], selectedId: string | null, onSelect: (id: string) => void): void {
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
      host.append(card);
      continue;
    }
    const view = operationVisual(city.buildingOperations?.[id]);
    card.dataset['operation'] = view.current.toLowerCase();
    card.dataset['tone'] = view.tone;
    card.append(text('p', `Built · ${view.current} now`, 'building-current'), text('p', view.summary, 'building-summary'));
    if (view.last) {
      const receipt = document.createElement('details');
      receipt.className = 'operation-receipt';
      receipt.append(text('summary', `Last record · Round ${view.last.round} · ${view.last.label}`));
      receipt.append(amountLine('Paid', view.last.paid), amountLine('Made', view.last.produced));
      for (const shortage of view.last.shortages) {
        receipt.append(text('p', `${METRIC_LABELS[shortage.resource]} needed ${shortage.required}; ${shortage.available} left in opening stock at round ${view.last.round}.`, 'operation-shortage'));
      }
      if (view.last.shortages.length) receipt.append(text('p', 'Nothing was paid or made in that record.', 'operation-shortage'));
      card.append(receipt);
    }
    host.append(card);
  }
}
