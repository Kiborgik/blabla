import { territoryPage, type TownTerritoryView, type TerritorySiteView } from '../visuals/territory-visuals.ts';
import type { observedPastoralSites } from '../core/simulation/pastoral.ts';
import { pastoralSiteLabel } from '../visuals/pastoral-visuals.ts';
import { wonderWorkRows, type TownDevelopmentFacts, type WonderWorkRow } from '../visuals/wonder-visuals.ts';
import { exactNumber, numberElement } from './number-format.ts';
import { strategicResourceAmounts, strategicResourceLabel, SITE_MARK_PATHS, type StrategicAmount, extractionFacts, depositLabel } from '../visuals/strategic-resource-visuals.ts';
import type { observedStrategicResources } from '../core/simulation/metals.ts';
import { improvementLastLabel } from '../visuals/improvement-visuals.ts';
import { damageCondition } from '../visuals/damage-visuals.ts';
import { BUILDINGS, IMPROVEMENTS, RESOURCE_IDS, TECHNOLOGIES, WONDERS } from '../core/content.ts';
import { hasFeatures } from '../core/simulation/history.ts';
import { observedResidentCapacity } from '../core/simulation/operations.ts';
import type { City, WorldState, ResidentCapacityObservation, Resources, RailObservation, RailConstructionOrder, RailCompletion, CityLocalPower, LocalPowerBeatReceipt, BuildingOperationResult } from '../core/types.ts';
import { buildingAppearance } from '../visuals/building-visuals.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import type { ResourceAmount } from '../visuals/operation-visuals.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import { visualIcon } from './world-cues.ts';
import { createTownProduction } from './town-production.ts';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function amountLine(label: string, amounts: Array<ResourceAmount | StrategicAmount>): HTMLElement {
  const line = text('p', '', 'operation-amounts');
  line.append(text('strong', `${label}: `));
  if (!amounts.length) line.append(document.createTextNode('None'));
  for (const entry of amounts) {
    const item = text('span', `${exactNumber(entry.amount)} ${entry.label}`);
    const icon = visualIcon(entry.resource === 'iron' || entry.resource === 'coal' ? 'materials' : entry.resource);
    if (entry.resource === 'iron') icon.querySelector('path')?.setAttribute('d', SITE_MARK_PATHS.iron);
    item.prepend(icon);
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

function vectorLine(label: string, vector: Partial<Resources>): HTMLElement {
  return amountLine(label, RESOURCE_IDS.flatMap(resource => { const amount = vector[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; }));
}

function wonderPreview(row: WonderWorkRow): HTMLElement {
  const preview = text('div', '', 'wonder-work-preview');
  if (row.kind === 'building') preview.append(text('strong', 'Under construction · Competing for the world wonder'), text('p', `${exactNumber(row.order.workDone)} / ${exactNumber(row.order.workRequired)} work · Not completed`), text('span', `${row.facts.contenders.length} recorded contenders · Tile ${row.order.tileId}`, 'work-record-round'));
  else if (row.kind === 'lost') preview.append(text('strong', 'Contest ended · Another town completed the wonder'), vectorLine('Refund received', row.receipt.refund), text('span', `No wonder installed here · Round ${row.receipt.resolvedRound}`, 'work-record-round'));
  else {
    preview.append(text('strong', 'Completed · World wonder'), text('p', `${row.facts.boost.remaining} unused research boosts`));
    const quote = row.facts.boost.quote;
    preview.append(text('span', quote ? `Available for ${TECHNOLOGIES.find(tech => tech.id === quote.technologyId)?.name ?? 'active research'}: ${exactNumber(quote.amount)} work. Requires an actor choice.` : row.facts.boost.blocker ?? 'No eligible research now', 'work-record-round'));
  }
  return preview;
}

function wonderCard(row: WonderWorkRow): HTMLElement {
  const card = text('section', '', 'building-card wonder-card'); card.dataset['workId'] = row.key;
  const receipt = row.kind === 'building' ? row.order : row.kind === 'lost' ? row.receipt : row.completed.completion;
  card.append(text('h4', `${row.name} · ${row.kind === 'building' ? 'Under construction' : row.kind === 'lost' ? 'Contest ended' : 'World wonder'}`), text('p', `Exact site · Tile ${receipt.tileId}`, 'building-current'), vectorLine('Paid once for this order', receipt.paid));
  if (row.kind === 'building') card.append(text('p', `${exactNumber(receipt.workRequired)} work required. Completion must be recorded before this becomes a world wonder.`));
  else if (row.kind === 'lost') card.append(text('p', `${exactNumber(row.receipt.workDone)} / ${exactNumber(row.receipt.workRequired)} work recorded. This ended reservation has no installed landmark.`), vectorLine('Recorded refund', row.receipt.refund), text('p', `Winner order ${row.receipt.winnerOrderId} · Event ${row.receipt.eventId}`, 'settlement-facts'));
  else {
    card.append(text('p', `Completed in round ${row.completed.completion.completedRound} · Event ${row.completed.completion.eventId}`, 'settlement-facts'));
    const definition = WONDERS.find(wonder => wonder.id === row.facts.wonderId);
    if (definition) card.append(vectorLine('Base for later productive seasons', definition.production));
    card.append(text('p', 'Completion does not record goods made. Actual town production is recorded separately.'));
    for (const boost of row.completed.boosts) card.append(text('p', `${TECHNOLOGIES.find(tech => tech.id === boost.technologyId)?.name ?? 'Recorded discovery'} · Applied ${exactNumber(boost.amount)} research work · ${exactNumber(boost.progressBefore)} → ${exactNumber(boost.progressAfter)} · Unused part ${exactNumber(boost.unusedAmount)} · Round ${boost.round}`, 'wonder-boost-receipt'));
    if (!row.completed.boosts.length) card.append(text('p', 'No boost has been applied.'));
    for (const loss of row.completed.losses) card.append(text('p', `Other contender · Tile ${loss.tileId} · Recorded refund ${RESOURCE_IDS.flatMap(resource => loss.refund[resource] === undefined ? [] : [`${exactNumber(loss.refund[resource] ?? 0)} ${METRIC_LABELS[resource]}`]).join(', ') || 'None'} · Round ${loss.resolvedRound}`));
  }
  return card;
}

function territorySiteName(site: TerritorySiteView | null): string {
  return site?.work?.name ?? (site?.resources.map(resource => resource.name).join(' / ') || (site ? site.terrain.charAt(0).toUpperCase() + site.terrain.slice(1) : 'Site unavailable'));
}

export function renderTerritoryInspection(host: HTMLElement, territory: TownTerritoryView, retained = { view: 'purchases', page: 0 }): void {
  if (territory.status !== 'available') return;
  const details = townDisclosure('land', `Land · ${territory.purchases.length} acquired plots`);
  details.classList.add('territory-detail');
  details.firstElementChild?.addEventListener('click', () => {
    if (!details.open) requestAnimationFrame(() => { if (details.open) details.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' }); });
  });
  const selector = text('select', '', 'territory-view');
  selector.setAttribute('aria-label', 'Land information'); selector.dataset['inspectionFocus'] = 'land-view';
  for (const [value, label] of [['purchases', 'Recorded purchases'], ['available', 'Land options now'], ['blocked', 'Unavailable land now']]) {
    if (!value || !label) continue;
    const option = text('option', label); option.value = value; selector.append(option);
  }
  selector.value = ['purchases', 'available', 'blocked'].includes(retained.view) ? retained.view : 'purchases';
  const context = text('p', '', 'territory-note'); const list = text('ul', '', 'territory-records');
  const navigation = text('div', '', 'territory-pagination');
  const previous = text('button', 'Previous'); const next = text('button', 'Next'); const position = text('span', '');
  for (const [button, key] of [[previous, 'land-previous'], [next, 'land-next']] as const) { button.type = 'button'; button.dataset['inspectionFocus'] = key; }
  navigation.append(previous, position, next);
  const meaning = townDisclosure('land-meaning', 'How acquired land works');
  meaning.append(text('p', 'Outlined plots are currently controlled by this town. Purchase and border-control records remain distinct. A retained ownership connection is not a road. Buying land does not construct a worked site, add residents or make supplies.'));
  details.append(selector, context, list, navigation, meaning);
  for (const control of territory.controls ?? []) {
    const receipt = townDisclosure(`land-control:${control.tileId}`, `Current control · Tile ${control.tileId}`);
    receipt.append(text('p', `${territory.cityName ?? 'This town'} gained current control in round ${control.round}. The original paid purchase is unchanged.`),
      text('p', `Border incident ${control.incidentId} · Event ${control.eventId}`, 'territory-note'));
    details.append(receipt);
  }
  host.append(details);
  let page = retained.page;
  const draw = (): void => {
    list.replaceChildren(); details.dataset['landView'] = selector.value;
    const rows: Array<TownTerritoryView['purchases'][number] | TownTerritoryView['available'][number] | TownTerritoryView['blocked'][number]> = selector.value === 'available' ? territory.available : selector.value === 'blocked' ? territory.blocked : territory.purchases.toSorted((left, right) => Number(!!right.site?.work) - Number(!!left.site?.work) || left.receipt.tileId - right.receipt.tileId);
    const current = territoryPage(rows, page); page = current.page; details.dataset['landPage'] = String(page);
    context.hidden = selector.value === 'purchases';
    context.textContent = `Current options · Revision ${territory.revision}. Actor timing is separate.`;
    for (const entry of current.rows) {
      const row = text('li', '', 'territory-record');
      if ('receipt' in entry) {
        const site = entry.site; const record = entry.receipt;
        row.append(text('strong', `${territorySiteName(site)} · Tile ${record.tileId}`));
        const resource = site?.resources.map(item => item.name).join(' / ') || (site?.terrain === 'forest' ? 'Forest' : '');
        const work = site?.work;
        row.append(text('p', [resource, work ? work.status === 'building' ? `Under construction · ${exactNumber(work.construction?.workDone ?? 0)} / ${exactNumber(work.construction?.workRequired ?? 0)} work` : `Built · ${work.installed?.operation.enabled === false ? 'Paused now' : 'On now'}` : 'Acquired · No worked site'].filter(Boolean).join(' · ')));
        if (work?.installed?.operation.lastResult) {
          const result = work.installed.operation.lastResult;
          row.append(text('span', `Last recorded season ${result.round} · ${improvementLastLabel(result)}`, 'work-record-round'), vectorLine('Made', result.produced), text('p', `Assigned then: ${result.residents.allocated} resident${result.residents.allocated === 1 ? '' : 's'}.`));
          if (result.inputs) row.append(vectorLine('Paid that season', result.paid));
          for (const input of result.inputs ?? []) row.append(text('p', `${METRIC_LABELS[input.resource]} needed ${exactNumber(input.required)} · Available before that attempt ${exactNumber(input.available)}`));
        } else if (work?.status === 'built') row.append(text('p', 'No operating record yet.'));
        const receipt = townDisclosure(`land-record:${record.tileId}`, `Purchase record · ${exactNumber(record.paid.credits)} Credits`);
        receipt.append(text('p', `${territory.cityName ?? 'Recorded town'} acquired Tile ${record.tileId} in round ${record.acquiredRound}. Paid once: ${exactNumber(record.paid.credits)} Credits.`),
          text('p', `Recorded ownership connection: ${record.pathTileIds.join(' → ')}.`), text('p', `Current owner: ${site?.owner === territory.civilizationId ? 'this civilization' : site?.owner === null ? 'unowned' : site ? 'another civilization' : 'unavailable'}.`), text('p', `Event ${record.eventId}`, 'territory-note'));
        row.append(receipt);
      } else if ('quote' in entry) row.append(text('strong', `${territorySiteName(entry.site)} · Tile ${entry.quote.tileId}`), text('p', `Cost now: ${exactNumber(entry.quote.paid.credits)} Credits. No payment has been made.`));
      else row.append(text('strong', `Tile ${entry.tileId}`), text('p', entry.reason));
      list.append(row);
    }
    if (!rows.length) list.append(text('li', selector.value === 'purchases' ? 'No acquired plots recorded for this town.' : selector.value === 'available' ? 'No land acquisition options now.' : 'No blocked land candidates recorded.'));
    previous.disabled = page === 0; next.disabled = page + 1 === current.pages; navigation.hidden = current.pages === 1;
    position.textContent = `Page ${page + 1} of ${current.pages}`;
  };
  selector.addEventListener('change', () => { page = 0; draw(); });
  previous.addEventListener('click', () => { page--; draw(); }); next.addEventListener('click', () => { page++; draw(); }); draw();
}

export function railWorkRows(city: Pick<City, 'id' | 'civId' | 'construction'>, rail?: RailObservation) {
  const active = rail ? rail.active : city.construction?.active;
  const last = city.construction?.lastCompleted;
  const records: Array<RailConstructionOrder | RailCompletion> = [];
  if (active && 'kind' in active && active.kind === 'rail' && active.cityId === city.id) records.push(active);
  records.push(...(rail?.completed ?? (last && 'kind' in last && last.kind === 'rail' ? [last] : [])).filter(record => record.cityId === city.id));
  return records.map(record => ({
    key: `rail:${record.edgeId}:${'id' in record ? record.id : record.orderId}`,
    heading: `Rail · Tiles ${record.tileId} ↔ ${record.toTileId}`,
    state: 'workDone' in record ? 'Under construction · Not built yet' : 'Completed Rail',
    progress: 'workDone' in record ? `${exactNumber(record.workDone)} / ${exactNumber(record.workRequired)} work` : `${exactNumber(record.workRequired)} work completed · Round ${record.completedRound}`,
    owner: 'civId' in record ? record.civId : city.civId,
    record,
  }));
}

export function localPowerResultLines(result: BuildingOperationResult): string[] {
  const flow = result.localPower;
  if (!flow) return ['Local Power flow was not recorded.'];
  const residents = result.residents;
  return [
    `${result.status === 'operated' ? 'Operated' : result.status === 'paused' ? 'Paused' : 'Blocked'} in round ${result.round}`,
    `Local Power · Generated ${exactNumber(flow.generated)} · Used ${exactNumber(flow.consumed)}`,
    `Power needed ${exactNumber(flow.required)} · Available before this attempt ${exactNumber(flow.availableBefore)} · Shortfall ${exactNumber(flow.shortage)}`,
    ...(residents ? [`Assigned ${exactNumber(residents.allocated)} residents · Needed ${exactNumber(residents.required)} · Available then ${exactNumber(residents.available)}`, `Opening population ${exactNumber(residents.openingPopulation)} · Community reserve ${exactNumber(residents.communityReserve)}`] : ['Resident allocation was not recorded.']),
    ...(result.emissionsProduced === undefined ? [] : [`Emissions recorded for this operation · ${exactNumber(result.emissionsProduced)}`]),
    ...result.shortages.map(shortage => `${METRIC_LABELS[shortage.resource]} needed ${exactNumber(shortage.required)} · Available then ${exactNumber(shortage.available)}`),
    ...(result.strategicShortages ?? []).map(shortage => `${strategicResourceLabel(shortage.resource)} needed ${exactNumber(shortage.required)} · Available then ${exactNumber(shortage.available)}`),
    ...(result.operationEventId ? [`Operation event ${result.operationEventId}`] : []),
  ];
}

export function localPowerPresentation(city: Pick<City, 'id' | 'buildings' | 'buildingOperations' | 'localPower'>, power: CityLocalPower | undefined = city.localPower) {
  if (!power) return null;
  const receipt = (record: LocalPowerBeatReceipt | null) => record?.cityId === city.id ? {
    record: structuredClone(record),
    balance: `Generated ${exactNumber(record.generated)} Power · Used ${exactNumber(record.consumed)} · Expired ${exactNumber(record.expired)}`,
    identity: `Town ${record.cityId} · Recorded civilization ${record.civId} · Round ${record.round} · Event ${record.eventId}`,
  } : null;
  return {
    current: city.buildings.flatMap(id => {
      const definition = BUILDINGS.find(building => building.id === id);
      if (!definition || !(definition.localPowerInput || definition.localPowerOutput)) return [];
      const operation = city.buildingOperations?.[id];
      return [`${definition.name} · ${operation ? operation.enabled ? 'On now' : 'Paused now' : 'Current state unavailable'}`];
    }),
    latest: receipt(power.lastBeat),
    productive: receipt(power.lastProductiveBeat),
    meaning: 'Power is used only in this town during that same season. Unused Power expires. It is not stored, traded or ordinary Energy. Emissions are operation records; no climate or calendar effect is recorded here.',
  };
}

function appendPowerResult(host: HTMLElement, result: BuildingOperationResult): void {
  for (const line of localPowerResultLines(result)) host.append(text('p', line));
  host.append(vectorLine('Ordinary supplies paid', result.paid), amountLine('Strategic supplies paid', strategicResourceAmounts(result.strategicPaid)), vectorLine('Actual ordinary output', result.produced));
}

function powerBeatDetails(record: LocalPowerBeatReceipt, key: string, label: string): HTMLDetailsElement {
  const details = townDisclosure(key, `${label} · Round ${record.round}`);
  details.classList.add('local-power-record');
  details.append(text('p', `Town ${record.cityId} · Recorded civilization ${record.civId} · Event ${record.eventId}`),
    text('strong', `Generated ${exactNumber(record.generated)} Power · Used ${exactNumber(record.consumed)} · Expired ${exactNumber(record.expired)}`));
  for (const entry of record.operations) {
    const section = text('section', '', 'local-power-operation');
    section.append(text('h5', `${BUILDINGS.find(building => building.id === entry.buildingId)?.name ?? entry.buildingId} · ${entry.phase === 'generator' ? 'Generator' : 'Powered consumer'}`));
    appendPowerResult(section, entry.result);
    const recipe = townDisclosure(`${key}:recipe:${entry.buildingId}`, `Recipe recorded then · Version ${entry.recipe.ruleVersion}`);
    recipe.append(vectorLine('Ordinary inputs', entry.recipe.inputs), amountLine('Strategic inputs', strategicResourceAmounts(entry.recipe.strategicInputs)), vectorLine('Base ordinary output before modifiers', entry.recipe.baseOutputs),
      text('p', `Requires ${exactNumber(entry.recipe.residentsRequired)} residents · Power input ${exactNumber(entry.recipe.localPowerInput)} · Power output ${exactNumber(entry.recipe.localPowerOutput)} · Emissions per paid operation ${exactNumber(entry.recipe.emissionsPerOperation)}`));
    section.append(recipe); details.append(section);
  }
  return details;
}

export function createLocalPowerInspection(city: Pick<City, 'id' | 'buildings' | 'buildingOperations' | 'localPower'>, power: CityLocalPower | undefined = city.localPower): HTMLElement | null {
  const view = localPowerPresentation(city, power);
  if (!view) return null;
  const section = text('section', '', 'local-power-inspection'); section.setAttribute('aria-label', 'Town local Power');
  section.append(text('h4', 'Local Power'));
  for (const line of view.current) section.append(text('p', line, 'local-power-current'));
  if (view.latest) section.append(text('strong', view.latest.balance, 'local-power-balance'), powerBeatDetails(view.latest.record, 'local-power-latest', 'Latest town Power attempt'));
  else section.append(text('p', 'No town Power attempt recorded yet. Completion does not generate Power or operate a Factory.'));
  if (view.productive) section.append(powerBeatDetails(view.productive.record, 'local-power-productive', 'Last positive powered output'));
  else section.append(text('p', 'No positive powered output recorded yet. Generation alone is not a productive Factory result.'));
  section.append(text('p', view.meaning, 'local-power-meaning'));
  return section;
}

export function renderSettlementInspection(host: HTMLElement, cities: readonly City[], selectedId: string | null, onSelect: (id: string) => void, support?: ResidentCapacityObservation, retainedWork = '', development?: TownDevelopmentFacts, territory?: TownTerritoryView, retainedTerritory?: { view: string; page: number }, onInspectWork?: () => void, rail?: RailObservation, power?: CityLocalPower): void {
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
  const people = text('p', `${city.population}${development?.growth ? ` / ${development.growth.capacity} housing` : ' people'} · ${city.wellbeing}% wellbeing`, 'settlement-facts');
  people.prepend(visualIcon('population'));
  host.append(heading, people, text('p', `Focus: ${city.focus} · ${city.damage}% damage`, 'settlement-facts'));
  if (townPicker) host.append(townPicker);
  if (territory) renderTerritoryInspection(host, territory, retainedTerritory);
  if (development?.growth) {
    const growth = development.growth;
    const housing = townDisclosure('housing', `Next population growth · ${exactNumber(growth.nextGrowthFoodCost)} Food`);
    housing.append(text('p', `Housing capacity: ${growth.baseCapacity} base${growth.sources.map(source => ` + ${source.capacity} from ${BUILDINGS.find(building => building.id === source.buildingId)?.name ?? source.buildingId}`).join('')} = ${growth.capacity}.`), text('p', 'Housing allows growth. A later productive season still needs food and the other growth conditions. Capacity does not add residents immediately.'));
    host.append(housing);
    if (development.lastGrowth) {
      const record = development.lastGrowth;
      const last = townDisclosure('last-growth', `Last growth · ${record.populationBefore} → ${record.populationAfter} residents`);
      last.append(text('p', `Paid ${exactNumber(record.foodPaid)} Food · Housing capacity then ${record.capacity} · Round ${record.round}.`), text('p', 'This is the recorded growth payment, not current food stock. The larger population can support work in later seasons.'));
      host.append(last);
    }
  }
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
    site.dataset['workId'] = `active:${activeDistrict.id}`;
    site.append(text('h4', `${definition?.name ?? activeDistrict.buildingId} · Under construction`));
    if (activeDistrict.highGround) site.append(text('p', `Retained high ground · Campus Tile ${activeDistrict.highGround.campusTileId} · Source Tile ${activeDistrict.highGround.sourceTileId}`, 'building-summary'));
    if (activeDistrict.catchmentTileId !== undefined) site.append(text('p', `Retained mountain source · Tile ${activeDistrict.catchmentTileId}`, 'building-summary'));
    if (definition?.housing) site.append(text('p', `After completion: +${definition.housing} housing. No residents are added immediately.`, 'building-summary'));
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
    card.dataset['workId'] = `active:${activeDistrict.id}`;
    const siteHeading = text('h4', `${definition?.name ?? activeDistrict.improvementId} · Under construction`);
    siteHeading.prepend(visualIcon(definition?.production.food ? 'food' : 'materials'));
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
    siteHeading.prepend(visualIcon(definition?.production.food ? 'food' : 'materials'));
    card.append(siteHeading, text('p', `Built · ${site.operation.enabled ? 'On' : 'Paused'} now`, 'building-current'));
    if (definition) card.append(text('p', `Needs ${definition.residentsRequired} local resident each operating season. People stay in this town.`, 'building-summary'),
      amountLine('Base before town productivity', RESOURCE_IDS.flatMap(resource => { const amount = definition.production[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })));
    if (definition?.operatingInputs) card.append(vectorLine('Opening supplies needed each operating season', definition.operatingInputs), text('p', 'All opening supplies and local support must be available. Base output is not a delivery or a recorded result.', 'building-summary'));
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
      for (const input of last.inputs ?? []) receipt.append(text('p', `${METRIC_LABELS[input.resource]} needed ${exactNumber(input.required)} · Available before that attempt ${exactNumber(input.available)}`, 'operation-input'));
      for (const shortage of last.shortages ?? []) receipt.append(text('p', `${METRIC_LABELS[shortage.resource]} needed ${exactNumber(shortage.required)} · Available then ${exactNumber(shortage.available)}`, 'operation-shortage'));
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
    name.prepend(visualIcon(appearance?.icon ?? (id === 'foundry' ? 'kiln' : id === 'observatory' ? 'science' : definition?.production.culture ? 'culture' : 'infrastructure')));
    card.append(name);
    const parent = definition?.district ? definition : BUILDINGS.find(item => item.district && definition?.requiresBuildings?.includes(item.id));
    if (parent) {
      const siteId = city.districtSites?.[parent.id];
      card.append(text('p', siteId === undefined ? `Exact ${parent.name} site unavailable` : `${parent.id === id ? 'Exact district site' : `At this town’s ${parent.name}`} · Tile ${siteId}`, 'building-summary'));
    }
    const highGround = city.buildingHighGround?.[id];
    if (highGround) card.append(text('p', `Retained high ground · Campus Tile ${highGround.campusTileId} · Source Tile ${highGround.sourceTileId}. The Observatory is at the Campus, not on the source tile.`, 'building-summary'));
    if (definition?.localPowerInput || definition?.localPowerOutput) {
      const operation = city.buildingOperations?.[id];
      card.append(text('p', `Built · ${operation ? operation.enabled ? 'On now' : 'Paused now' : 'Current state unavailable'}`, 'building-current'));
      if (operation?.lastResult) appendPowerResult(card, operation.lastResult);
      else card.append(text('p', 'No operating result recorded yet. A later season needs complete supplies, local Power where required, and residents.'));
      const productive = (power ?? city.localPower)?.lastProductiveBeat;
      const historical = productive?.cityId === city.id ? productive.operations.find(entry => entry.buildingId === id && entry.phase === 'consumer' && entry.result.status === 'operated' && Object.values(entry.result.produced).some(amount => amount > 0)) : undefined;
      if (historical) {
        const retained = townDisclosure(`power-positive:${id}`, `Last positive powered output · Round ${productive?.round}`);
        appendPowerResult(retained, historical.result); card.append(retained);
      }
      card.append(text('p', 'Generated Power expires in the same town and season if unused. These records are not spendable stock.', 'building-summary'));
      host.append(card); continue;
    }
    if (!definition?.operatingInputs) {
      card.append(text('p', 'Built', 'building-current'));
      if (definition?.housing) card.append(text('p', `Adds ${definition.housing} housing capacity. Population grows only in a later eligible season with food.`, 'building-summary'));
      const source = city.buildingCatchments?.[id];
      if (source !== undefined) card.append(text('p', `Retained mountain source · Tile ${source}. This is a source, not an occupied district or a pipe route.`, 'building-summary'));
      if (definition?.requiresBuildings?.length) card.append(text('p', `Built with this town’s ${definition.requiresBuildings.map(required => BUILDINGS.find(item => item.id === required)?.name ?? required).join(' and ')}.`, 'building-summary'));
      if (definition && Object.values(definition.production).some(amount => amount > 0)) card.append(amountLine(definition.district ? 'Building base before site bonus' : 'Base before town productivity', RESOURCE_IDS.flatMap(resource => { const amount = definition.production[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })), text('p', `${definition.district ? 'Research & buildings shows the exact site base and nearby sources. ' : ''}Later town production includes this contribution. No separate per-building output receipt is recorded.`, 'building-summary'));
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
      receipt.append(amountLine('Paid', [...view.last.paid, ...view.last.strategicPaid ?? []]), amountLine('Made', view.last.produced));
      for (const shortage of view.last.shortages) {
        receipt.append(text('p', `${METRIC_LABELS[shortage.resource]} needed ${shortage.required}; ${shortage.available} left in opening stock at round ${view.last.round}.`, 'operation-shortage'));
      }
      for (const shortage of view.last.strategicShortages ?? []) receipt.append(text('p', `${strategicResourceLabel(shortage.resource)} needed ${exactNumber(shortage.required)}; ${exactNumber(shortage.available)} left in opening stock at round ${view.last.round}.`, 'operation-shortage'));
      if (view.last.status === 'blocked' && !view.last.strategicPaid?.length && !view.last.paid.length && !view.last.produced.length) receipt.append(text('p', 'Nothing was paid or made in that record.', 'operation-shortage'));
      card.append(receipt);
    }
    host.append(card);
  }
  const wonderRows = wonderWorkRows(development?.wonders ?? [], city.id);
  for (const row of wonderRows) host.append(wonderCard(row));
  const rails = railWorkRows(city, rail);
  for (const row of rails) {
    const card = text('section', '', 'building-card rail-work'); card.dataset['workId'] = row.key;
    card.append(text('h4', row.heading), text('strong', row.state), text('p', row.progress),
      text('p', `Owner civilization ${row.owner} · Town ${city.name} · Edge ${row.record.edgeId}`),
      vectorLine('Paid once for this order', row.record.paid), amountLine('Strategic payment', strategicResourceAmounts(row.record.strategicPaid)),
      text('p', `Started round ${row.record.startedRound} · Order ${'id' in row.record ? row.record.id : row.record.orderId}`, 'settlement-facts'));
    if ('eventId' in row.record) card.append(text('p', `Completion event ${row.record.eventId}`, 'settlement-facts'));
    card.append(text('p', 'Rail belongs to this exact edge. Existing trade agreements keep their consented path and schedule.', 'building-summary'));
    host.append(card);
  }
  const cards = [...host.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overview);
  const work = text('section', '', 'town-work'); work.dataset['inspectionSection'] = 'work';
  const label = text('label', ''); label.append(text('span', 'Inspect work & buildings', 'sr-only'));
  const picker = text('select', '', 'work-picker'); picker.setAttribute('aria-label', 'Inspect work or building'); picker.dataset['inspectionFocus'] = 'work-picker';
  const detail = text('div', '', 'work-detail');
  for (const [index, card] of cards.entries()) {
    const key = card.dataset['workId'] ?? card.dataset['building'] ?? card.dataset['improvementTile'] ?? `active:${index}`;
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
    const wonder = wonderRows.find(row => row.key === key);
    const railway = rails.find(row => row.key === key);
    if (operation?.lastResult?.localPower) {
      preview.append(text('strong', `Built · ${operation.enabled ? 'On' : 'Paused'} now`));
      for (const line of localPowerResultLines(operation.lastResult).slice(0, 2)) preview.append(text('p', line));
      preview.append(vectorLine('Actual ordinary output', operation.lastResult.produced));
    }
    else if (railway) preview.append(text('strong', railway.state), text('p', railway.heading), text('p', railway.progress));
    else if (wonder) preview.append(wonderPreview(wonder));
    else if (key?.startsWith('active:') && activeDistrict) {
      preview.append(text('strong', 'Under construction'), text('p', `${exactNumber(activeDistrict.workDone)} / ${exactNumber(activeDistrict.workRequired)} work · Not built yet`));
      if ('buildingId' in activeDistrict && activeDistrict.catchmentTileId !== undefined) preview.append(text('p', `Mountain source · Tile ${activeDistrict.catchmentTileId}`));
      if ('kind' in activeDistrict && activeDistrict.kind === 'improvement') preview.append(text('p', `Reserved Tile ${activeDistrict.tileId} · No food or materials made yet`));
    } else {
      preview.append(text('strong', operation || worked ? `Built · ${(operation ?? worked?.operation)?.enabled ? 'On' : 'Paused'} now` : 'Built'));
      const last = operation?.lastResult ?? worked?.operation.lastResult;
      if (last) {
        preview.append(text('span', `Last recorded season · ${last.round}`, 'work-record-round'));
        const results = text('div', '', 'work-key-results');
        results.append(amountLine('Made', RESOURCE_IDS.flatMap(resource => { const amount = last.produced[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })),
          amountLine('Used', [...RESOURCE_IDS.flatMap(resource => { const amount = last.paid[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; }), ...strategicResourceAmounts('strategicPaid' in last ? last.strategicPaid : undefined)]));
        preview.append(results);
        if (last.status === 'blocked' && 'shortages' in last) for (const shortage of last.shortages ?? []) preview.append(text('p', `${METRIC_LABELS[shortage.resource]} needed ${exactNumber(shortage.required)} · Available then ${exactNumber(shortage.available)}`, 'operation-shortage'));
        if ('strategicShortages' in last) for (const shortage of last.strategicShortages ?? []) preview.append(text('p', `${strategicResourceLabel(shortage.resource)} needed ${exactNumber(shortage.required)} · Available then ${exactNumber(shortage.available)}`, 'operation-shortage'));
        if (last.status === 'blocked' && operation) preview.append(text('p', operationVisual(operation).last?.label ?? 'Could not operate', 'work-record-round'));
        if (last.status !== 'operated') preview.append(text('span', last.status === 'paused' ? 'Paused in that season' : 'Could not operate in that season', 'work-record-round'));
      } else {
        const definition = BUILDINGS.find(item => item.id === key);
        if (definition?.housing) preview.append(text('p', `+${definition.housing} housing capacity · Growth still needs food`));
        if (key && city.buildingCatchments?.[key] !== undefined) preview.append(text('p', `Mountain source · Tile ${city.buildingCatchments[key]}`));
        if (key === 'water-mill' && definition) {
          preview.append(amountLine('Base each season', RESOURCE_IDS.flatMap(resource => { const amount = definition.production[resource]; return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }]; })), text('p', 'Own-town Irrigation · Before productivity; actual town output is in Events.', 'work-record-round'));
        } else preview.append(text('span', operation || worked ? 'No operating result recorded yet' : 'Production records are separate from construction.', 'work-record-round'));
      }
    }
    const full = townDisclosure(`work:${key ?? ''}`, 'Site & full record'); full.className += ' work-full-record'; full.append(selected);
    detail.replaceChildren(preview, full);
  };
  picker.addEventListener('change', choose); label.append(picker); work.append(label, detail);
  for (const card of cards) card.remove();
  host.append(work); choose();
  const production = createTownProduction(city, buildingId => {
    picker.value = buildingId;
    choose();
    onInspectWork?.();
    picker.focus({ preventScroll: true });
  });
  const localPower = createLocalPowerInspection(city, power ?? city.localPower);
  if (localPower) overview.prepend(localPower);
  if (production) overview.prepend(production);
}

export function renderStrategicInspection(host: HTMLElement, facts: ReturnType<typeof observedStrategicResources>): void {
  if (facts.strategicCapacity === undefined) return;
  const section = text('section', '', 'strategic-stock'); section.dataset['inspectionSection'] = 'overview';
  section.setAttribute('aria-label', 'Civilization strategic resources');
  const capacities = facts.strategicCapacities ?? { iron: facts.strategicCapacity };
  for (const entry of strategicResourceAmounts(capacities)) {
    const heading = text('h3', entry.label); heading.prepend(visualIcon('materials'));
    const value = text('p', '', 'strategic-stock-value'); value.append(numberElement(facts.strategicResources?.[entry.resource] ?? 0), text('span', ` stored / ${exactNumber(entry.amount)} capacity`));
    const revealed = facts.revealedDeposits?.filter(deposit => deposit.resource === entry.resource) ?? [];
    const deposits = townDisclosure(`revealed-deposits:${entry.resource}`, `Known ${entry.label} sites · ${revealed.length}`);
    if (!revealed.length) deposits.append(text('p', 'No deposits are revealed to this civilization.'));
    for (const deposit of revealed) deposits.append(text('p', depositLabel(deposit)));
    section.append(heading, value, deposits);
  }
  section.append(text('p', 'Civilization stock. Finite deposits, ordinary Materials and Energy are separate.', 'building-summary'));
  host.append(section);
}

export function renderPastoralInspection(host: HTMLElement, facts: ReturnType<typeof observedPastoralSites>): void {
  if (!facts.revealedPastoralSites) return;
  const section = text('section', '', 'pastoral-sites'); section.dataset['inspectionSection'] = 'overview';
  const details = townDisclosure('known-horse-sites', `Known horse sites · ${facts.revealedPastoralSites.length}`);
  details.append(text('p', 'Known to this civilization. These are sites, not stored horses. A completed Pasture can make food when a local resident works it.'));
  if (!facts.revealedPastoralSites.length) details.append(text('p', 'No horse sites are revealed to this civilization.'));
  for (const site of facts.revealedPastoralSites) details.append(text('p', pastoralSiteLabel(site.tileId)));
  section.append(details); host.append(section);
}
