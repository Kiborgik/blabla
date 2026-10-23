import { renderTerritoryInspection } from '../web/settlement-inspection.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectCapabilities } from '../core/capabilities.ts';
import { ECONOMY_RULES } from '../core/content.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import type { Resources, WorldState } from '../core/types.ts';
import { projectAcquiredLand, selectedAcquiredLand, territoryPage, TERRITORY_OUTLINE_LIMIT, projectTownTerritory } from '../visuals/territory-visuals.ts';
import { ownedTerritoryForestJourney } from './fixtures/owned-territory-journey.ts';

const legal = ownedTerritoryForestJourney();
const pasture = legal.pasture;
const projection = (state: WorldState, cityId = pasture.cityId) => projectCapabilities(state, legal.seat, cityId, legal.journey.time());
const view = (state: WorldState, cityId = pasture.cityId) => projectTownTerritory(state, projection(state, cityId));
const pastureSite = (state: WorldState) => view(state).purchases.find(item => item.receipt.tileId === 164)?.site;

function expectedSiteOutput(state: WorldState, cityId: string, tileId: number, resource: 'food' | 'materials', base: number): number {
  const step = legal.journey.steps.find(candidate => candidate.result.state.revision === state.revision); assert.ok(step?.input.kind === 'strategy');
  const opening = step.before; const city = opening.cities.find(candidate => candidate.id === cityId); assert.ok(city);
  const tile = opening.tiles.find(candidate => candidate.id === city.tileId); assert.ok(tile);
  assert.deepEqual(city.buildings, []); assert.deepEqual(Object.keys(city.improvements ?? {}), [String(tileId)]); assert.deepEqual(opening.wonders, {});
  assert.equal(opening.unlockedFeatures.includes('civic-bootstrap'), false); assert.equal(opening.unlockedFeatures.includes('food-budget'), false);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
  const raw = ECONOMY_RULES.baseProduction[resource] + (focus[resource] ?? 0) + (siteProduction(opening, tile)[resource] ?? 0);
  const productivity = (0.5 + city.wellbeing / 100) * (1 - city.damage / 100) * (1 + city.infrastructure / 10);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return round(round((raw + base) * productivity) - round(raw * productivity));
}

await test('exact-town historical purchases keep their original Credits and connectivity, separate from current quotes', () => {
  const input = projection(pasture.operated); const result = projectTownTerritory(pasture.operated, input);
  assert.equal(result.status, 'available'); assert.equal(result.cityName, 'Ember 2');
  assert.deepEqual(result.purchases.map(item => item.receipt.tileId), [164, 181]);
  const horse = result.purchases.find(item => item.receipt.tileId === 164); assert.ok(horse);
  assert.equal(horse.receipt.paid.credits, 18);
  const retained = pasture.purchased.tileAcquisitions?.['164']; assert.ok(retained); assert.deepEqual(horse.receipt, retained);
  const event = pasture.purchased.events.find(candidate => candidate.id === retained.eventId); assert.equal(event?.type, 'territory-acquired'); assert.deepEqual(event?.territoryAcquisition, retained);
  assert.deepEqual(horse.historicalPath?.map(point => point.tileId), [199, 181, 164]);
  assert.deepEqual(result.available.map(item => item.quote), input.territory?.cities.find(city => city.cityId === pasture.cityId)?.available);
  assert.deepEqual(result.blocked, input.territory?.cities.find(city => city.cityId === pasture.cityId)?.blocked);
  assert.deepEqual(input.legalActions, []); assert.equal(input.choiceReferenceState, 'not-provided');
});
await test('land purchase, active Pasture, installed site and later actual food output remain distinct', () => {
  assert.equal(pastureSite(pasture.purchased)?.work, null);
  const active = pastureSite(pasture.started)?.work; assert.ok(active);
  assert.equal(active.name, 'Pasture'); assert.equal(active.status, 'building');
  assert.equal(active.construction?.workDone, 0); assert.equal(active.construction?.workRequired, 3); assert.equal(active.installed, null);
  const built = pastureSite(pasture.completed)?.work; assert.equal(built?.status, 'built'); assert.equal(built?.installed?.operation.lastResult, null);
  const worked = pastureSite(pasture.operated)?.work;
  const retained = pasture.operated.cities.find(city => city.id === pasture.cityId)?.improvements?.['164']?.operation.lastResult; assert.ok(retained);
  assert.deepEqual(worked?.installed?.operation.lastResult, retained);
  assert.equal(retained.produced.food, expectedSiteOutput(pasture.operated, pasture.cityId, 164, 'food', 2));
  assert.equal(worked?.installed?.operation.lastResult?.residents.allocated, 1);
});
await test('new-row acquired forest stays bound to Ember 3 and the exact staffed Lumber mill', () => {
  const result = view(legal.operated, legal.cityId); assert.equal(result.cityName, 'Ember 3');
  assert.deepEqual(result.purchases.map(item => item.receipt.tileId), [219, 237]);
  const forest = result.purchases.find(item => item.receipt.tileId === 237); assert.ok(forest?.site);
  assert.equal(forest.site.terrain, 'forest'); assert.equal(forest.site.work?.name, 'Lumber mill');
  assert.equal(forest.receipt.paid.credits, 22); assert.deepEqual(forest.historicalPath?.map(point => point.tileId), [218, 219, 237]);
  const retained = legal.operated.cities.find(city => city.id === legal.cityId)?.improvements?.['237']?.operation.lastResult; assert.ok(retained);
  assert.deepEqual(forest.site.work?.installed?.operation.lastResult, retained);
  assert.equal(retained.produced.materials, expectedSiteOutput(legal.operated, legal.cityId, 237, 'materials', 4));
  const tile = legal.operated.tiles.find(candidate => candidate.id === 237); assert.ok(tile);
  assert.equal(forest.site.q, tile.q - (legal.operated.width - 1) / 2);
  assert.equal(forest.site.r, tile.r - (legal.operated.height - 1) / 2);
});
await test('resource identity follows supplied canonical reveal facts, never hidden raw resource layers', () => {
  const input = projection(pasture.purchased);
  const horse = projectTownTerritory(pasture.purchased, input).purchases.find(item => item.receipt.tileId === 164)?.site;
  assert.ok(horse?.resources.some(resource => resource.id === 'horses'));
  const hidden = structuredClone(input); hidden.pastoral = { revealedPastoralSites: [] }; hidden.strategic = { revealedDeposits: [] };
  const unknown = projectTownTerritory(pasture.purchased, hidden).purchases.find(item => item.receipt.tileId === 164)?.site;
  assert.ok(unknown); assert.ok(unknown.resources.every(resource => resource.id !== 'horses' && resource.id !== 'iron'));
});
await test('current ownership is observed separately and missing exact geometry never becomes a guessed path', () => {
  const state = structuredClone(pasture.operated); const input = projection(state);
  const tile = state.tiles.find(candidate => candidate.id === 164); assert.ok(tile); tile.owner = null;
  state.tiles = state.tiles.filter(candidate => candidate.id !== 181);
  const result = projectTownTerritory(state, input); const horse = result.purchases.find(item => item.receipt.tileId === 164);
  assert.ok(horse); assert.equal(horse.site?.owner, null); assert.equal(horse.historicalPath, null); assert.equal(horse.receipt.paid.credits, 18);
  assert.equal(result.purchases.find(item => item.receipt.tileId === 181)?.site, null);
});
await test('stale or foreign town contexts have explicit non-actionable states', () => {
  const input = projection(pasture.operated); input.revision--;
  const stale = projectTownTerritory(pasture.operated, input); assert.equal(stale.status, 'unavailable'); assert.match(stale.reason ?? '', /revision/i);
  const foreign = projection(pasture.operated, 'city-0');
  assert.equal(projectTownTerritory(pasture.operated, foreign).status, 'unavailable');
});
await test('detached stable rows preserve inputs and do not grant output or manufacture a horse stock', () => {
  const state = structuredClone(legal.operated); const input = projection(state, legal.cityId); const before = structuredClone([state, input]);
  const result = projectTownTerritory(state, input); assert.equal(result.status, 'available');
  result.purchases[0]?.receipt.pathTileIds.push(9999);
  const work = result.purchases.find(item => item.receipt.tileId === 237)?.site?.work;
  if (work?.installed?.operation.lastResult) work.installed.operation.lastResult.produced.materials = 999;
  assert.deepEqual([state, input], before);
  const reversed = structuredClone(input); reversed.territory?.purchases.reverse();
  assert.deepEqual(projectTownTerritory(state, reversed), projectTownTerritory(state, input));
  assert.equal(Object.hasOwn(result, 'horseStock'), false);
});
await test('a real pause keeps installed forest identity and the immutable previous staffed output', () => {
  legal.journey.act({ type: 'set-improvement-operation', cityId: legal.cityId, tileId: 237, improvementId: 'lumber-mill', enabled: false });
  const paused = view(legal.journey.state, legal.cityId).purchases.find(item => item.receipt.tileId === 237)?.site;
  assert.equal(paused?.terrain, 'forest'); assert.equal(paused?.work?.status, 'built');
  assert.equal(paused?.work?.installed?.operation.enabled, false);
  assert.deepEqual(paused?.work?.installed?.operation.lastResult, legal.operated.cities.find(city => city.id === legal.cityId)?.improvements?.['237']?.operation.lastResult);
  assert.equal(paused?.work?.installed?.operation.lastResult?.produced.materials, expectedSiteOutput(legal.operated, legal.cityId, 237, 'materials', 4));
});

await test('selected-town map outlines use real retained plots within a finite cap, including orphan-receipt handling', () => {
  const plots = projectAcquiredLand(legal.operated);
  assert.deepEqual(plots.map(plot => plot.receipt.tileId), [164, 181, 219, 237]);
  assert.deepEqual(selectedAcquiredLand(plots, legal.cityId).map(plot => plot.receipt.tileId), [219, 237]);
  const state = structuredClone(legal.operated); state.cities = state.cities.filter(city => city.id !== legal.cityId);
  const orphan = projectAcquiredLand(state); assert.equal(orphan.find(plot => plot.receipt.tileId === 237)?.townName, null);
  assert.equal(selectedAcquiredLand(orphan, legal.cityId).length, 0);
  assert.equal(selectedAcquiredLand(Array.from({ length: 100 }, () => plots.find(plot => plot.receipt.tileId === 237)).filter(plot => plot !== undefined), legal.cityId).length, TERRITORY_OUTLINE_LIMIT);
});
await test('land detail pages are six rows, stable and clamped without losing any retained records', () => {
  const rows = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(territoryPage(rows, 0), { rows: [0, 1, 2, 3, 4, 5], page: 0, pages: 4, total: 20 });
  assert.deepEqual(territoryPage(rows, 99).rows, [18, 19]); assert.equal(territoryPage(rows, Number.NaN).page, 0);
  assert.deepEqual(Array.from({ length: 4 }, (_, page) => territoryPage(rows, page).rows).flat(), rows);
  assert.deepEqual(territoryPage([], -1), { rows: [], page: 0, pages: 1, total: 0 });
});

class TerritoryElement {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  value = '';
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  children: TerritoryElement[] = [];
  open = false;
  scrolled: ScrollIntoViewOptions | null = null;
  get firstElementChild(): TerritoryElement | null { return this.children[0] ?? null; }
  scrollIntoView(options: ScrollIntoViewOptions): void { this.scrolled = options; }
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  constructor(tag: string) { this.tag = tag; }
  get classList() { return { add: (...values: string[]) => { this.className += ' ' + values.join(' '); } }; }
  append(...children: TerritoryElement[]): void { this.children.push(...children); }
  prepend(...children: TerritoryElement[]): void { this.children.unshift(...children); }
  replaceChildren(...children: TerritoryElement[]): void { this.children = [...children]; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  all(): TerritoryElement[] { return [this, ...this.children.flatMap(child => child.all())]; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}
const createTerritoryElement = (tag: string) => new TerritoryElement(tag);
await test('native Land detail leads with actual worked output and pages current quotes without mutation actions', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const frames: FrameRequestCallback[] = [];
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: createTerritoryElement, createElementNS: (_ns: string, tag: string) => createTerritoryElement(tag), createTextNode: (value: string) => { const item = createTerritoryElement('#text'); item.textContent = value; return item; } } });
  try {
    const host = document.createElement('section'); assert.ok(host instanceof TerritoryElement);
    const territory = view(legal.operated, legal.cityId); const before = structuredClone(territory);
    renderTerritoryInspection(host, territory);
    const land = host.all().find(node => node.dataset['townDisclosure'] === 'land'); assert.ok(land);
    land.firstElementChild?.listeners.get('click')?.(); land.open = true; frames.shift()?.(0);
    assert.deepEqual(land.scrolled, { block: 'start', inline: 'nearest', behavior: 'instant' });
    const list = host.all().find(node => node.className === 'territory-records'); assert.ok(list);
    const output = expectedSiteOutput(legal.operated, legal.cityId, 237, 'materials', 4);
    assert.match(list.children[0]?.content() ?? '', new RegExp(`Lumber mill · Tile 237.*Forest.*${String(output).replaceAll('.', '\\.')} Materials.*22 Credits`));
    const selector = host.all().find(node => node.attributes.get('aria-label') === 'Land information'); assert.ok(selector);
    selector.value = 'available'; selector.listeners.get('change')?.();
    assert.match(list.content(), /Cost now:.*No payment has been made/);
    const pages = Math.ceil(territory.available.length / 6); assert.ok(pages > 1);
    const next = host.all().find(node => node.dataset['inspectionFocus'] === 'land-next'); assert.ok(next && !next.disabled);
    const seen: number[] = [];
    for (let page = 0; page < pages; page++) {
      const expected = territory.available.slice(page * 6, page * 6 + 6).map(item => item.quote.tileId);
      const actual: number[] = list.children.map(row => Number(/Tile (\d+)/.exec(row.content())?.[1]));
      assert.deepEqual(actual, expected); assert.ok(list.children.length <= 6); seen.push(...actual);
      assert.equal(next.disabled, page === pages - 1); if (page < pages - 1) next.listeners.get('click')?.();
    }
    assert.deepEqual(seen, territory.available.map(item => item.quote.tileId));
    assert.ok(host.all().filter(node => node.tag === 'button').every(node => ['Previous', 'Next'].includes(node.textContent)));
    const restored = document.createElement('section'); assert.ok(restored instanceof TerritoryElement);
    renderTerritoryInspection(restored, territory, { view: 'available', page: 1 });
    const restoredRows = restored.all().find(node => node.className === 'territory-records'); assert.ok(restoredRows);
    assert.deepEqual(restoredRows.children.map(row => Number(/Tile (\d+)/.exec(row.content())?.[1])), territory.available.slice(6, 12).map(item => item.quote.tileId));
    assert.deepEqual(territory, before);
  } finally {
    if (previousFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', previousFrame); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
