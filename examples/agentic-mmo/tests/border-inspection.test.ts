import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borderInspection, renderBorderInspection } from '../web/border-inspection.ts';
import { createFlatBorderLayer } from '../web/flat-renderer.ts';
import { borderPartyBadgeOffsets, borderPartyWorldParts, projectBorderIncidents, projectBorderParties } from '../visuals/border-visuals.ts';
import { createBorderPartyLabels, updateBorderPartyLabels } from '../web/renderer.ts';
import { flatSceneFaces } from '../web/settlement-parts.ts';
import { borderAction, borderBeat, dispatchBorder, syntheticBorderCorridor } from './fixtures/border-current.ts';

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  open = false;
  hidden = false;
  disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: never) => void>();
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_value: string) { throw new Error('Unsafe HTML sink'); }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  addEventListener(name: string, listener: (event: never) => void): void { this.listeners.set(name, listener); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelectorAll(selector: string): ElementRecord[] { return this.children.flatMap(child => child.all()).filter(node => selector.startsWith('.') ? (node.className || node.attributes.get('class') || '').split(' ').includes(selector.slice(1)) : node.tag === selector); }
  querySelector(selector: string): ElementRecord | null { return this.querySelectorAll(selector)[0] ?? null; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].filter(Boolean).join(' '); }
  visibleContent(): string { return this.tag === 'details' && !this.open ? this.children.filter(child => child.tag === 'summary').map(child => child.content()).join(' ') : [this.textContent, ...this.children.map(child => child.visibleContent())].filter(Boolean).join(' '); }
}

function withDocument<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag) } });
  try { return run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
}

function departed() {
  const state = syntheticBorderCorridor(); dispatchBorder(state, 3); return state;
}

await test('inspector shows a concise human summary while exact paid people, supplies and receipts start collapsed', () => {
  const state = departed(); const view = projectBorderIncidents(state)[0]!; const before = structuredClone(view);
  const card = withDocument(() => borderInspection(view)) as unknown as ElementRecord;
  assert.match(card.visibleContent(), /A purchased plot is disputed\. 3 people away from home/);
  assert.match(card.visibleContent(), /Current control:/);
  assert.match(card.visibleContent(), /Phases describe the last committed record/);
  assert.doesNotMatch(card.visibleContent(), /Paid at departure|Household reserve|Departure receipt|Original purchase:/);
  assert.equal(card.querySelector('details')!.open, false);
  const body = card.content();
  assert.match(body, /3 people departed; 3 people survive; 0 people lost/);
  assert.match(body, /Paid at departure: 9 Materials · 6 Credits · 30 Food · 3 Trust/);
  assert.match(body, /Food: 30 remaining · 0 consumed/);
  assert.match(body, /No movement step recorded/);
  assert.match(body, /No return receipt recorded/);
  assert.match(body, new RegExp(view.incident.initiator.departureEventId));
  assert.deepEqual(view, before);
  assert.equal(card.querySelectorAll('button').length, 0);
});

await test('inspector refresh shows current phases and exact return facts without retaining phantom old cards', () => withDocument(() => {
  const state = departed(); const host = new ElementRecord('section');
  renderBorderInspection(host as unknown as HTMLElement, projectBorderIncidents(state), 'city-0');
  host.querySelector('details')!.open = true;
  const incident = state.border!.active[0]!;
  borderAction(state, 1, { type: 'respond-border', incidentId: incident.id, response: 'yield' });
  borderBeat(state);
  renderBorderInspection(host as unknown as HTMLElement, projectBorderIncidents(state), 'city-0');
  assert.equal(host.querySelectorAll('.border-inspection').length, 1);
  assert.equal(host.querySelector('details')!.open, true);
  assert.match(host.content(), /Recorded steps/);
  while (state.border!.active.length && state.round < 12) borderBeat(state);
  const view = projectBorderIncidents(state)[0]!;
  renderBorderInspection(host as unknown as HTMLElement, [view], 'city-0');
  assert.equal(host.querySelectorAll('.border-inspection').length, 1);
  assert.match(host.content(), /Residents returned\. 0 people away from home/);
  const receipt = view.incident.initiator.returned!;
  assert.ok(receipt);
  assert.match(host.content(), new RegExp(`Returned in round ${receipt.round}: ${receipt.people} people to ${receipt.sourceCityId}`));
  assert.ok(host.content().includes(`Unused Food refunded ${receipt.foodRefunded}`));
  assert.ok(host.content().includes(`Food stock ${receipt.foodStockBefore} → ${receipt.foodStockAfter}`));
  assert.match(host.content(), /Only this plot changed control; no city was captured/);
  assert.match(host.content(), /This purchase history does not describe current control/);
  renderBorderInspection(host as unknown as HTMLElement, [], 'city-0');
  assert.equal(host.querySelectorAll('.border-inspection').length, 0);
}));

await test('missing identities, targets and purchase evidence remain explicitly unknown and raw names stay text', () => withDocument(() => {
  const state = departed(); const incident = state.border!.active[0]!;
  state.civilizations[0]!.name = '<script>not markup</script>';
  state.cities = state.cities.filter(city => city.id !== incident.sourceCityId);
  state.tiles = state.tiles.filter(tile => tile.id !== incident.tileId && tile.id !== incident.initiator.positionTileId);
  delete state.tileAcquisitions![String(incident.tileId)];
  const card = borderInspection(projectBorderIncidents(state)[0]!) as unknown as ElementRecord;
  assert.match(card.content(), /Current control: unavailable/);
  assert.match(card.content(), /Original purchase receipt unavailable\. No payment is inferred/);
  assert.match(card.content(), /Exact map position unavailable/);
  assert.match(card.content(), /Town unavailable/);
  assert.ok(card.content().includes('<script>not markup</script>'));
  assert.equal(card.querySelectorAll('script').length, 0);
}));

await test('flat renderer shares the world-space painter recipe and far count with exact source-town inspection', () => withDocument(() => {
  const views = projectBorderIncidents(departed()); const party = projectBorderParties(views)[0]!;
  const selected: string[] = [];
  const mid = createFlatBorderLayer(views, 'mid', 24, cityId => selected.push(cityId)) as unknown as ElementRecord;
  const recipe = borderPartyWorldParts([party], 'mid');
  const expected = flatSceneFaces(recipe.map(row => row.part), .72);
  const polygons = mid.querySelectorAll('polygon');
  assert.deepEqual(polygons.map(face => face.getAttribute('data-border-part')), expected.map(face => face.part.id));
  assert.deepEqual(polygons.map(face => face.getAttribute('points')), expected.map(face => face.points));
  const marker = mid.querySelectorAll('.flat-border-party')[0]!;
  assert.equal(marker.getAttribute('data-position-tile'), String(party.party.positionTileId));
  assert.equal(marker.getAttribute('aria-label')?.includes('Last recorded phase: outbound'), true);
  marker.listeners.get('click')!({} as never);
  let prevented = false;
  marker.listeners.get('keydown')!({ key: 'Enter', preventDefault: () => { prevented = true; } } as never);
  assert.deepEqual(selected, [party.sourceCityId, party.sourceCityId]); assert.equal(prevented, true);
  const far = createFlatBorderLayer(views, 'far', 12) as unknown as ElementRecord;
  assert.equal(far.querySelectorAll('polygon').length, 0);
  assert.equal(far.querySelector('text')?.textContent, '3');
  assert.equal(far.querySelectorAll('.flat-border-party').length, 1);
  const outline = far.querySelector('polyline')!;
  assert.equal(outline.getAttribute('stroke-dasharray'), '4 3');
  assert.equal(outline.getAttribute('stroke'), views[0]!.currentController?.color);
}));

await test('zero or returned rows never create flat hit targets or far counts', () => withDocument(() => {
  const views = projectBorderIncidents(departed());
  for (const state of ['zero', 'returned'] as const) {
    const synthetic = structuredClone(views);
    if (state === 'zero') synthetic[0]!.parties[0]!.party.people = 0; else synthetic[0]!.parties[0]!.party.phase = 'returned';
    for (const detail of ['far', 'mid', 'close'] as const) {
      const layer = createFlatBorderLayer(synthetic, detail) as unknown as ElementRecord;
      assert.equal(layer.querySelectorAll('.flat-border-party').length, 0);
      assert.equal(layer.querySelectorAll('polygon').length, 0);
      assert.equal(layer.querySelectorAll('text').length, 0);
    }
  }
}));

await test('far co-located border badges stay separated and individually inspectable without moving authoritative tiles', () => withDocument(() => {
  const state = departed();
  borderAction(state, 1, { type: 'respond-border', incidentId: state.border!.active[0]!.id, response: 'defend', sourceCityId: 'city-1', people: 2 });
  for (let step = 0; step < 3; step++) borderBeat(state);
  const views = projectBorderIncidents(state); const before = structuredClone(views);
  const parties = projectBorderParties(views);
  assert.equal(parties.length, 2);
  assert.equal(parties[0]!.point.tileId, parties[1]!.point.tileId);
  const selected: string[] = [];
  for (const scale of [4, 9, 11]) {
    const layer = createFlatBorderLayer(views, 'far', scale, cityId => selected.push(cityId)) as unknown as ElementRecord;
    const markers = layer.querySelectorAll('.flat-border-party');
    assert.equal(markers.length, 2);
    assert.deepEqual(markers.map(marker => marker.querySelector('text')!.textContent), ['2', '3']);
    assert.ok(markers.every(marker => marker.getAttribute('data-position-tile') === String(parties[0]!.point.tileId)));
    assert.equal(markers[0]!.getAttribute('data-border-x'), markers[1]!.getAttribute('data-border-x'));
    assert.equal(markers[0]!.getAttribute('data-border-z'), markers[1]!.getAttribute('data-border-z'));
    const offsets = markers.map(marker => ({ x: Number(marker.getAttribute('data-screen-offset-x')), y: Number(marker.getAttribute('data-screen-offset-y')) }));
    assert.ok(Math.hypot(offsets[0]!.x - offsets[1]!.x, offsets[0]!.y - offsets[1]!.y) >= 24);
    assert.ok(Math.abs(offsets[0]!.x + offsets[1]!.x) < 1e-12);
    assert.ok(Math.abs(offsets[0]!.y + offsets[1]!.y) < 1e-12);
    for (const [index, marker] of markers.entries()) {
      assert.equal(marker.getAttribute('role'), 'button');
      assert.equal(marker.getAttribute('tabindex'), '0');
      assert.equal(marker.querySelector('line')!.getAttribute('x1'), '0');
      assert.equal(marker.querySelector('line')!.getAttribute('y1'), '0');
      assert.ok(marker.querySelector('.border-count-badge'));
      marker.listeners.get('click')!({} as never);
      assert.equal(selected.at(-1), parties[index]!.sourceCityId);
    }
    const reversed = structuredClone(views); reversed[0]!.parties.reverse();
    const reordered = createFlatBorderLayer(reversed, 'far', scale) as unknown as ElementRecord;
    assert.deepEqual(reordered.querySelectorAll('.flat-border-party').map(marker => [marker.getAttribute('data-border-party'), marker.getAttribute('data-screen-offset-x'), marker.getAttribute('data-screen-offset-y')]), markers.map(marker => [marker.getAttribute('data-border-party'), marker.getAttribute('data-screen-offset-x'), marker.getAttribute('data-screen-offset-y')]));
  }
  assert.deepEqual(views, before);
}));

await test('flat and Three far badges share separated screen slots and distinct count hit targets on unchanged committed tiles', () => withDocument(() => {
  const state = departed();
  borderAction(state, 1, { type: 'respond-border', incidentId: state.border!.active[0]!.id, response: 'defend', sourceCityId: 'city-1', people: 2 });
  for (let step = 0; step < 3; step++) borderBeat(state);
  const views = projectBorderIncidents(state); const before = structuredClone(views);
  const parties = projectBorderParties(views); const offsets = borderPartyBadgeOffsets(parties);
  assert.deepEqual([...offsets], [...borderPartyBadgeOffsets(parties.toReversed())]);
  const labels = new ElementRecord('div'); const selected: string[] = [];
  const markers = createBorderPartyLabels(views, labels as unknown as HTMLElement, cityId => selected.push(cityId));
  const anchors: Array<{ x: number; z: number; height: number }> = [];
  updateBorderPartyLabels(markers, 'far', point => { anchors.push(point); return { x: 350, y: 220, visible: true }; });
  assert.equal(markers.length, 2);
  assert.deepEqual(anchors[0], anchors[1]);
  const flat = createFlatBorderLayer(views, 'far', 9, cityId => selected.push(cityId)) as unknown as ElementRecord;
  const flatMarkers = flat.querySelectorAll('.flat-border-party');
  const centers = markers.map(marker => ({ x: Number.parseFloat(marker.element.style.left), y: Number.parseFloat(marker.element.style.top) }));
  assert.ok(Math.hypot(centers[0]!.x - centers[1]!.x, centers[0]!.y - centers[1]!.y) >= 24);
  for (const [index, marker] of markers.entries()) {
    const expected = offsets.get(marker.party.party.id)!; const button = marker.element as unknown as ElementRecord;
    assert.equal(button.textContent, String(marker.party.party.people));
    assert.equal(button.disabled, false); assert.equal(button.hidden, false);
    assert.equal(button.style['width'], '22px'); assert.equal(button.style['height'], '22px');
    assert.equal(button.style['border'], `2px solid ${marker.party.identity.color}`);
    assert.equal(button.dataset['positionTile'], String(marker.party.point.tileId));
    assert.equal(centers[index]!.x, 350 + expected.x); assert.equal(centers[index]!.y, 220 + expected.y);
    assert.equal(marker.leader.hidden, false); assert.equal(marker.leader.style.left, '350px'); assert.equal(marker.leader.style.top, '220px');
    assert.equal(Number(flatMarkers[index]!.getAttribute('data-screen-offset-x')), expected.x);
    assert.equal(Number(flatMarkers[index]!.getAttribute('data-screen-offset-y')), expected.y);
    assert.equal(flatMarkers[index]!.querySelector('text')!.textContent, button.textContent);
    button.listeners.get('click')!({} as never); flatMarkers[index]!.listeners.get('click')!({} as never);
    assert.deepEqual(selected.slice(-2), [marker.party.sourceCityId, marker.party.sourceCityId]);
  }
  updateBorderPartyLabels(markers, 'mid', point => ({ x: point.x, y: point.z, visible: true }));
  assert.ok(markers.every(marker => marker.leader.hidden && marker.element.textContent === ''));
  assert.notEqual(markers[0]!.element.style.left, markers[1]!.element.style.left);
  updateBorderPartyLabels(markers, 'far', () => ({ x: 0, y: 0, visible: false }));
  assert.ok(markers.every(marker => marker.element.hidden && marker.leader.hidden));
  assert.deepEqual(views, before);
}));
