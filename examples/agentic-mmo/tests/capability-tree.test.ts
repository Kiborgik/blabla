import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld } from '../core/engine.ts';
import { capabilityTreeNodes, createCapabilityTreeSheet } from '../web/capability-tree.ts';
import type { CapabilityTreeInput } from '../web/capability-tree.ts';

const time = '2026-10-16T00:00:00.000Z';
function fixture(): CapabilityTreeInput {
  const state = createWorld(1701, time);
  return { runId: 'fixture-a', civilizationName: 'Aster', towns: state.cities.filter(city => city.civId === 0).map(city => ({ id: city.id, name: city.name })), catalogue: capabilityCatalogue(), projection: projectCapabilities(state, 0, 'city-0', time) };
}

await test('complete tree retains every canonical node and both incoming fuel prerequisites', () => {
  const input = fixture();
  const before = structuredClone(input);
  const nodes = capabilityTreeNodes(input);
  assert.equal(nodes.length, 17);
  assert.equal(new Set(nodes.map(node => node.id)).size, 17);
  assert.equal(nodes.reduce((count, node) => count + node.requires.length, 0), 17);
  const fuel = nodes.find(node => node.id === 'technology:fuel-management');
  assert.ok(fuel);
  assert.deepEqual(fuel.requires.toSorted(), ['technology:civic-institutions', 'technology:kiln-firing']);
  for (const node of nodes) for (const id of node.requires) assert.ok((nodes.find(candidate => candidate.id === id)?.level ?? 999) < node.level);
  assert.deepEqual(input, before);
});

await test('presentation preserves canonical statuses, current research and unavailable facts without deciding rules', () => {
  const input = fixture();
  const agriculture = input.projection.technologies.find(row => row.nodeId === 'technology:agriculture');
  const farm = input.projection.buildings.find(row => row.nodeId === 'building:farm');
  assert.ok(agriculture && farm);
  agriculture.status = 'available'; agriculture.research = { progress: 3, cost: 10 }; agriculture.choiceRefs = [];
  farm.status = 'done'; farm.blockers = [];
  input.projection.buildings = input.projection.buildings.filter(row => row.nodeId !== 'building:kiln');
  const nodes = capabilityTreeNodes(input);
  assert.equal(nodes.find(node => node.id === agriculture.nodeId)?.status, 'available');
  assert.equal(nodes.find(node => node.id === agriculture.nodeId)?.research, 'Researching · 3 / 10 science');
  assert.equal(nodes.find(node => node.id === farm.nodeId)?.status, 'done');
  assert.equal(nodes.find(node => node.id === 'building:kiln')?.status, null);
  assert.equal(nodes.find(node => node.id === 'building:kiln')?.label, 'Facts unavailable');
  assert.equal(nodes.length, 17);
});

await test('planned source support and exact construction blockers use distinct familiar facts', () => {
  const input = fixture();
  const civic = input.projection.technologies.find(row => row.nodeId === 'technology:civic-institutions');
  const academy = input.projection.buildings.find(row => row.nodeId === 'building:academy');
  assert.ok(civic && academy);
  civic.status = 'done'; civic.blockers = [];
  academy.status = 'locked'; academy.blockers = [{ kind: 'era', required: 1, available: 0 }, { kind: 'resource', resource: 'materials', required: 16, available: 4 }];
  const nodes = capabilityTreeNodes(input);
  const building = nodes.find(node => node.id === academy.nodeId);
  assert.ok(building);
  assert.equal(building.label, 'Locked');
  assert.ok(building.blockers.some(text => /Cities and States.*The First Hearths/.test(text)));
  assert.ok(building.blockers.some(text => /Materials.*16.*4/.test(text)));
  assert.equal(nodes.find(node => node.id === 'technology:navigation')?.support, 'Catalogue only');
  assert.equal(nodes.find(node => node.id === 'technology:water-management')?.support, 'Included in another release');
});

await test('building detail separates one-time cost, operating inputs and potential production', () => {
  const node = capabilityTreeNodes(fixture()).find(candidate => candidate.id === 'building:academy');
  assert.ok(node);
  assert.ok(node.facts.some(fact => fact.label === 'Build once' && /16 Materials.*10 Credits/.test(fact.value)));
  assert.ok(node.facts.some(fact => fact.label === 'Uses each operating season' && /1 Credits.*2 Culture/.test(fact.value)));
  assert.ok(node.facts.some(fact => fact.label === 'Base production before productivity' && fact.value === '3 Science'));
  assert.ok(!node.facts.some(fact => /Made|Gained|Paid/.test(fact.label)));
});

await test('tree order is stable across catalogue order and labels preserve unknown future content', () => {
  const input = fixture();
  const before = capabilityTreeNodes(input).map(node => node.id);
  input.catalogue.technologies.reverse(); input.catalogue.buildings.reverse(); input.catalogue.edges.reverse();
  assert.deepEqual(capabilityTreeNodes(input).map(node => node.id), before);
  input.catalogue.technologies.push({ id: 'future-example', name: 'Future example', requiredFeatures: [], era: 0, cost: 5, requires: [], capability: 'Fixture only' });
  assert.equal(capabilityTreeNodes(input).find(node => node.id === 'technology:future-example')?.label, 'Facts unavailable');
});


class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  id = '';
  type = '';
  value = '';
  hidden = false;
  disabled = false;
  open = false;
  tabIndex = 0;
  scrollTop = 0;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  listeners = new Map<string, Set<(event: { preventDefault: () => void }) => void>>();
  focusedWithoutScroll = false;
  constructor(tag: string) { this.tag = tag; }
  get isConnected(): boolean { return true; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { for (const child of children.toReversed()) { child.parent = this; this.children.unshift(child); } }
  replaceChildren(...children: ElementRecord[]): void { this.children = []; this.append(...children); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return name === 'data-tree-focus' ? this.dataset['treeFocus'] ?? null : this.attributes.get(name) ?? null; }
  addEventListener(name: string, listener: (event: { preventDefault: () => void }) => void): void {
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(listener); this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: (event: { preventDefault: () => void }) => void): void { this.listeners.get(name)?.delete(listener); }
  dispatch(name: string): void { for (const listener of this.listeners.get(name) ?? []) listener({ preventDefault: () => undefined }); }
  focus(options?: { preventScroll?: boolean }): void { dom.activeElement = this; this.focusedWithoutScroll = options?.preventScroll === true; }
  scrollIntoView(): void { return; }
  contains(node: ElementRecord | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  showModal(): void { this.open = true; }
  close(): void { this.open = false; this.dispatch('close'); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  control(key: string): ElementRecord { const value = this.all().find(node => node.dataset['treeFocus'] === key); assert.ok(value, key); return value; }
}

const dom = { activeElement: null as ElementRecord | null, createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_namespace: string, tag: string) => new ElementRecord(tag) };
function withDom(run: (dialog: HTMLDialogElement, record: ElementRecord) => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom });
  try {
    const dialog = document.createElement('dialog');
    assert.ok(dialog instanceof ElementRecord);
    run(dialog, dialog);
  } finally {
    dom.activeElement = null;
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

await test('native sheet exposes all node disclosures, exact town choice and multi-parent navigation', () => withDom((dialog, record) => {
  const choices: string[] = [];
  const input = fixture(); input.towns.push({ id: 'frontier', name: 'Far Hearth' });
  const sheet = createCapabilityTreeSheet(dialog, id => choices.push(id));
  assert.ok(sheet);
  sheet.open(input);
  assert.equal(record.open, true);
  assert.equal(record.all().filter(node => node.dataset['nodeId']).length, 17);
  assert.match(record.content(), /Options now/);
  assert.match(record.content(), /Aster.*Dawnwell/);
  assert.equal(record.control('town').tag, 'select');
  record.control('town').value = 'frontier'; record.control('town').dispatch('change');
  assert.deepEqual(choices, ['frontier']);
  record.control('requires:technology:fuel-management:technology:kiln-firing').dispatch('click');
  assert.equal(dom.activeElement, record.control('node:technology:kiln-firing'));
  assert.equal(record.control('node:technology:kiln-firing').parent?.open, true);
  assert.ok(record.all().filter(node => node.tag === 'button').every(node => node.type === 'button'));
  sheet.destroy();
}));

await test('new observations preserve captured content and focus until an explicit refresh', () => withDom((dialog, record) => {
  const input = fixture(); input.projection.revision = 10;
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  assert.ok(sheet);
  sheet.open(input);
  const summary = record.control('node:technology:agriculture');
  assert.ok(summary.parent); summary.parent.open = true; summary.focus();
  record.scrollTop = 320;
  sheet.observe(structuredClone(input));
  assert.equal(record.control('node:technology:agriculture'), summary);
  const newer = structuredClone(input); newer.projection.revision = 11;
  const first = newer.projection.technologies[0]; assert.ok(first); first.status = 'done';
  sheet.observe(newer);
  assert.match(record.content(), /Revision 10/);
  assert.equal(dom.activeElement, summary);
  assert.equal(record.control('refresh').hidden, false);
  sheet.refresh();
  assert.match(record.content(), /Revision 11/);
  assert.equal(record.control('node:technology:agriculture').parent?.open, true);
  assert.equal(dom.activeElement, record.control('node:technology:agriculture'));
  assert.equal(record.scrollTop, 320);
  assert.equal(dom.activeElement?.focusedWithoutScroll, true);
  sheet.destroy();
}));

await test('stale updates cannot roll back the captured run and explicit town context resets old facts', () => withDom((dialog, record) => {
  const input = fixture(); input.projection.revision = 10;
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  assert.ok(sheet); sheet.open(input);
  const older = structuredClone(input); older.projection.revision = 9; older.civilizationName = 'Old name';
  sheet.observe(older); sheet.refresh();
  assert.doesNotMatch(record.content(), /Old name/);
  const changed = structuredClone(input); changed.projection.cityId = 'missing-town';
  changed.projection.buildings.forEach(row => { row.status = 'locked'; row.blockers = [{ kind: 'missing-city', cityId: 'missing-town' }]; });
  sheet.observe(changed);
  assert.match(record.content(), /Town unavailable: missing-town/);
  assert.match(record.content(), /Buildings: missing-town/);
  const otherRun = fixture(); otherRun.runId = 'fixture-b'; otherRun.projection.revision = 1;
  sheet.observe(otherRun);
  assert.match(record.content(), /Revision 1/);
  sheet.destroy();
}));

await test('Close and Escape return focus without issuing a town action and disposal removes listeners', () => withDom((dialog, record) => {
  const opener = document.createElement('button');
  assert.ok(opener instanceof ElementRecord);
  const choices: string[] = [];
  const sheet = createCapabilityTreeSheet(dialog, id => choices.push(id));
  assert.ok(sheet);
  sheet.open(fixture(), opener);
  record.control('close').dispatch('click');
  assert.equal(record.open, false); assert.equal(dom.activeElement, opener);
  assert.equal(opener.focusedWithoutScroll, true);
  sheet.open(fixture(), opener);
  record.dispatch('cancel');
  assert.equal(record.open, false); assert.equal(dom.activeElement, opener);
  assert.deepEqual(choices, []);
  sheet.destroy();
  assert.equal(record.listeners.get('cancel')?.size, 0);
  assert.equal(record.listeners.get('close')?.size, 0);
}));

await test('refresh activation lands on a visible heading instead of its newly hidden button', () => withDom((dialog, record) => {
  const input = fixture();
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  sheet.open(input);
  const newer = structuredClone(input); newer.projection.revision += 1;
  sheet.observe(newer);
  record.control('refresh').focus(); record.control('refresh').dispatch('click');
  assert.equal(dom.activeElement, record.control('heading'));
  assert.equal(record.control('refresh').hidden, true);
  sheet.destroy();
}));

await test('selected-town Done and missing-town blockers are consumed from separate canonical projections', () => {
  const state = createWorld(1701, time);
  const home = state.cities[0]; assert.ok(home);
  home.buildings.push('farm');
  state.cities.push({ ...structuredClone(home), id: 'frontier', name: 'Far Hearth', buildings: [] });
  const input = fixture();
  input.projection = projectCapabilities(state, 0, home.id, time);
  assert.equal(capabilityTreeNodes(input).find(node => node.id === 'building:farm')?.label, 'Done');
  input.projection = projectCapabilities(state, 0, 'frontier', time);
  assert.notEqual(capabilityTreeNodes(input).find(node => node.id === 'building:farm')?.label, 'Done');
  input.projection = projectCapabilities(state, 0, null, time);
  assert.ok(capabilityTreeNodes(input).find(node => node.id === 'building:farm')?.blockers.includes('Choose a town to inspect building requirements'));
});

// Entirely legal canonical prefix; no stocks, technologies or order facts are edited.
function committedFixture(): CapabilityTreeInput {
  let state = createWorld(1701, time);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1', 'settlement-decisions-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: time });
    assert.ok(result.ok, result.error); state = result.state;
  }
  const researched = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time, action: { type: 'research', technology: 'agriculture' } });
  assert.ok(researched.ok); state = researched.state;
  const caught = catchUpStrategy(state, '2026-10-16T00:03:00.000Z');
  assert.ok(caught.ok); state = caught.state;
  const started = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: '2026-10-16T00:03:01.000Z', action: { type: 'build', project: 'farm', cityId: 'city-0' } });
  assert.ok(started.ok); state = started.state;
  const input = fixture();
  input.projection = projectCapabilities(state, 0, 'city-0', '2026-10-16T00:03:01.000Z');
  return input;
}

await test('actual released active-commitment blockers render safely and construction is work rather than Done', () => {
  const input = committedFixture();
  assert.ok(input.projection.buildings.some(row => row.blockers.some(blocker => blocker.kind === 'active-commitment')));
  const nodes = capabilityTreeNodes(input);
  const farm = nodes.find(node => node.id === 'building:farm');
  assert.ok(farm);
  assert.equal(farm.status, 'available');
  assert.ok(farm.facts.some(fact => fact.label === 'Construction work' && fact.value === '0 / 4'));
  assert.ok(farm.facts.some(fact => fact.label === 'Already paid for this order' && fact.value.includes('8 Materials')));
  assert.ok(nodes.find(node => node.id === 'building:workshop')?.blockers.some(value => /Finish the active commitment.*Terraced fields/.test(value)));
});

await test('native sheet exposes required research, exact-town active work and separate retained completion', () => withDom((dialog, record) => {
  const input = committedFixture();
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  sheet.open(input);
  assert.match(record.content(), /Choose research.*Required/);
  assert.match(record.content(), /Dawnwell.*Construction.*Active/);
  assert.match(record.content(), /Construction work.*0 \/ 4/);
  assert.match(record.content(), /Last research completed.*Cultivation.*Round 2/);
  assert.match(record.content(), /Under construction/);
  assert.doesNotMatch(record.content(), /Last construction completed/);
  sheet.destroy();
}));

await test('supplied blocked lane and historical completion stay separate from the current selected town', () => withDom((dialog, record) => {
  const input = committedFixture();
  // Explicit presentation fixture: core semantics are covered by the separate legal-cycle tests.
  assert.ok(input.projection.decisions);
  input.projection.decisions.research = { kind: 'research', cityId: null, status: 'blocked', targetId: null, progress: null, availableIds: [], blockers: [{ capabilityId: null, reason: { kind: 'no-available-choice' } }] };
  input.projection.decisions.construction[0] = { kind: 'construction', cityId: 'city-0', status: 'blocked', targetId: 'farm', progress: { done: 1, required: 4 }, availableIds: [], blockers: [{ capabilityId: 'farm', reason: { kind: 'zero-work' } }] };
  input.projection.lastConstructionCompletion = { orderId: 'construction-10', cityId: 'city-0', buildingId: 'workshop', startedRound: 1, completedRound: 2, paid: { materials: 8 }, workRequired: 4, eventId: '15:0' };
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  sheet.open(input);
  assert.match(record.content(), /No available choice/);
  assert.match(record.content(), /No work can be done with the current town condition/);
  assert.match(record.content(), /Last construction completed.*Artisan quarter.*Round 2/);
  const other = structuredClone(input); other.projection.cityId = 'missing-town'; delete other.projection.lastConstructionCompletion;
  sheet.observe(other);
  assert.doesNotMatch(record.content(), /Last construction completed/);
  assert.match(record.content(), /Current construction facts are unavailable for this town/);
  sheet.destroy();
}));

await test('spectator timing explains a due season in simple English without hiding canonical option status', () => withDom((dialog, record) => {
  const input = fixture();
  input.projection.admission.reason = 'strategy_catchup_required: realize due strategic beats before admitting this action';
  const sheet = createCapabilityTreeSheet(dialog, () => undefined);
  sheet.open(input);
  assert.match(record.content(), /next world season is waiting to be recorded/);
  assert.doesNotMatch(record.content(), /strategy_catchup_required/);
  assert.match(record.content(), /Available entries and ongoing projects/);
  sheet.destroy();
}));
