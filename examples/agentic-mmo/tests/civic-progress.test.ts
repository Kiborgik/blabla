import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import type { ConstructionOrder, WorldState } from '../core/types.ts';
import { civicBootstrapJourney } from './fixtures/civic-bootstrap-journey.ts';
import { secondGovernmentJourney } from './fixtures/second-government-journey.ts';
import { civicProgressPresentation, createCivicProgress, civicTreeNodes, type CivicProgressInput } from '../web/civic-progress.ts';

const journey = civicBootstrapJourney();
const catalogue = capabilityCatalogue();

function input(state: WorldState, cityId: string | null = journey.cityId): CivicProgressInput {
  const city = state.cities.find(candidate => candidate.id === cityId);
  return { catalogue, projection: projectCapabilities(state, journey.seat, cityId, journey.time()), ...(city ? { city } : {}), events: state.events };
}

await test('a legacy world has no invented civic surface', () => {
  assert.equal(civicProgressPresentation(input(journey.beforeRelease)), null);
  assert.equal(createCivicProgress(input(journey.beforeRelease)), null);
});

await test('the released empty lane asks for a civic without adopting a government', () => {
  const view = civicProgressPresentation(input(journey.adopted));
  assert.ok(view);
  assert.equal(view.status, 'required');
  assert.equal(view.heading, 'Awaiting a civic choice');
  assert.equal(view.progress, null);
  assert.deepEqual(view.choices, ['Code of laws · 16 Culture']);
  assert.equal(view.government.heading, 'No government adopted');
  assert.deepEqual(view.government.slots, []);
  assert.deepEqual(view.effects, []);
  assert.match(view.explanation, /Culture made by towns/);
  assert.match(view.explanation, /Science/);
});

await test('explicit selection uses the snapshotted Culture requirement and exact progress', () => {
  const source = input(journey.selected);
  const view = civicProgressPresentation(source);
  assert.ok(view);
  assert.equal(view.heading, 'Developing Code of laws');
  assert.equal(view.progress, '0 / 16 Culture');
  assert.equal(view.completion, null);
  const fractional = structuredClone(source);
  assert.ok(fractional.projection.governance?.civics?.active);
  fractional.projection.governance.civics.active.progress = 6.25;
  fractional.projection.governance.civics.active.requiredCulture = 17.5;
  assert.equal(civicProgressPresentation(fractional)?.progress, '6.25 / 17.5 Culture');
});

await test('actual completion remains separate from unchosen government and its unused reform', () => {
  const source = input(journey.completed);
  const view = civicProgressPresentation(source);
  const last = source.projection.governance?.civics?.lastCompleted;
  assert.ok(view && last);
  assert.equal(view.heading, 'Code of laws completed');
  assert.equal(view.progress, null);
  assert.equal(view.status, 'blocked');
  assert.match(view.completion ?? '', new RegExp(`Round ${last.completedRound}`));
  assert.match(view.completion ?? '', new RegExp(last.eventId));
  assert.equal(view.government.heading, 'No government adopted');
  assert.match(view.government.reform, /Unused reform · Code of laws/);
  assert.deepEqual(view.effects, []);
  assert.ok(view.blockers.includes('No further civic is available in this release.'));
});

await test('explicit adoption shows exact empty slots and base contributions without claiming credited output', () => {
  const source = input(journey.arranged);
  const before = structuredClone(source);
  const view = civicProgressPresentation(source);
  assert.ok(view);
  assert.equal(view.government.heading, 'Chiefdom');
  assert.deepEqual(view.government.slots, ['Military slot 1 · Empty', 'Economic slot 1 · Urban planning']);
  assert.equal(view.government.reform, 'No unused reform recorded.');
  assert.deepEqual(view.effects, ['+1 base Food', '+1 base construction work']);
  assert.equal(view.constructionCapacity, `${source.projection.governance?.cityConstructionWork} work · Current town capacity`);
  assert.match(view.effectExplanation, /not credited work or goods/);
  assert.ok(view.government.records.some(line => line.includes('Recorded effective round')));
  assert.ok(view.government.records.some(line => line.includes('Government commitment until round')));
  assert.ok(view.government.records.some(line => line.includes('Policy commitment until round')));
  assert.ok(view.government.events.some(line => line.includes('chooses Chiefdom')));
  assert.deepEqual(source, before);
});

await test('later legal construction progress and completion stay separate from current modifiers', () => {
  const started = input(journey.started);
  const active = started.city?.construction?.active;
  const working = civicProgressPresentation(started);
  assert.ok(active && working);
  assert.match(working.constructionRecord ?? '', new RegExp(`${active.workDone} / ${active.workRequired} work recorded`));
  const built = input(journey.built);
  const finished = civicProgressPresentation(built);
  assert.ok(finished && built.city?.construction?.lastCompleted);
  assert.match(finished.constructionRecord ?? '', /Last completed · Granary/);
  assert.ok(finished.constructionRecord?.includes(built.city.construction.lastCompleted.eventId));
  assert.deepEqual(finished.effects, working.effects);
  assert.notEqual(finished.constructionRecord, working.constructionRecord);
});

await test('a later real opening presents the credited construction progress rather than its base bonus', () => {
  const step = journey.steps.find(candidate => {
    const before = candidate.before.cities.find(city => city.id === journey.cityId)?.construction?.active;
    const after = candidate.result.state.cities.find(city => city.id === journey.cityId)?.construction?.active;
    return candidate.before.revision >= journey.started.revision && before && after && after.workDone > before.workDone;
  });
  assert.ok(step);
  const source = input(step.result.state);
  const work = source.city?.construction?.active;
  const view = civicProgressPresentation(source);
  assert.ok(view && work);
  assert.ok(work.workDone > 1);
  assert.ok(view.effects.includes('+1 base construction work'));
  assert.ok(view.constructionRecord?.includes(`${work.workDone} / ${work.workRequired} work recorded`));
});

await test('synthetic rail union records remain exact edge work rather than a wonder', () => {
  const source = structuredClone(input(journey.arranged));
  assert.ok(source.city);
  const active = { kind: 'rail' as const, ruleVersion: 1 as const, id: 'rail-fixture', cityId: source.city.id, edgeId: '10:11', tileId: 10, toTileId: 11, startedRound: 700, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, workDone: 1.25 };
  source.city.construction = { active, lastCompleted: null };
  assert.equal(civicProgressPresentation(source)?.constructionRecord, 'Rail · Tiles 10 ↔ 11 · Edge 10:11 · 1.25 / 2 work recorded · Order rail-fixture');
  const { id, workDone, ...base } = active;
  source.city.construction = { active: null, lastCompleted: { ...base, orderId: id, civId: journey.seat, completedRound: 702, eventId: 'rail-completion' } };
  assert.equal(civicProgressPresentation(source)?.constructionRecord, 'Last completed · Rail · Tiles 10 ↔ 11 · Edge 10:11 · Round 702 · Event rail-completion');
});

await test('a synthetic pending read model retains exact transition rounds and the supplied current output factor', () => {
  const source = structuredClone(input(journey.arranged));
  const governance = source.projection.governance;
  assert.ok(governance?.government?.active);
  governance.government.pending = { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: 70, completionRound: 72, paidCredits: 10, spentCompletionEventId: null };
  governance.modifiers.ordinaryOutputMultiplier = 0.75;
  const view = civicProgressPresentation(source);
  assert.ok(view);
  assert.match(view.government.pending.join(' '), /Accepted round 70 · Recorded transition end 72/);
  assert.ok(view.government.pending.includes('Paid 10 Credits'));
  assert.ok(view.government.pending.includes('Economic slot 1 · Empty'));
  assert.equal(view.outputFactor, 'Current ordinary output factor · 0.75');
  assert.deepEqual(view.effects, ['+1 base Food', '+1 base construction work']);
});

await test('prerequisite eligibility does not imply legal adoption and missing town facts do not become zero', () => {
  const source = input(journey.completed, null);
  const view = civicProgressPresentation(source);
  assert.ok(view);
  assert.equal(view.constructionCapacity, null);
  assert.equal(view.constructionRecord, null);
  assert.ok(view.government.targets.some(line => line.includes('Chiefdom · Prerequisites met · Quote 0 Credits')));
  assert.match(view.government.choiceExplanation, /not permission/);
  assert.match(view.government.choiceExplanation, /explicit agent choice/);
});

await test('unknown civic records and canonical locked blockers remain honest', () => {
  const source = structuredClone(input(journey.adopted));
  assert.ok(source.projection.governance);
  source.projection.governance.civics = undefined;
  source.projection.governance.government = undefined;
  if (source.projection.decisions?.civic) {
    source.projection.decisions.civic.status = 'blocked';
    source.projection.decisions.civic.availableIds = [];
    source.projection.decisions.civic.blockers = [{ capabilityId: 'code-of-laws', reason: { kind: 'civic-prerequisite', civicId: 'missing-civic' } }];
  }
  const view = civicProgressPresentation(source);
  assert.ok(view);
  assert.equal(view.heading, 'Civic record unavailable');
  assert.equal(view.government.heading, 'Government record unavailable');
  assert.ok(view.blockers.includes('Complete civic: missing-civic.'));
  assert.deepEqual(view.effects, []);
});

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  open = false;
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  attributes = new Map<string, string>();
  constructor(tag: string) { this.tag = tag; }
  append(...children: ElementRecord[]): void { this.children.push(...children); }
  prepend(...children: ElementRecord[]): void { this.children.unshift(...children); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function render(source: CivicProgressInput): ElementRecord | null {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag) } });
  try { return createCivicProgress(source) as unknown as ElementRecord | null; }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
}

await test('the read-only renderer separates Culture, Government and current effects with retained native disclosures', () => {
  const section = render(input(journey.started));
  assert.ok(section);
  assert.equal(section.dataset['inspectionSection'], 'overview');
  assert.match(section.content(), /Culture · Civics/);
  assert.match(section.content(), /Government · Chiefdom/);
  assert.match(section.content(), /Urban planning/);
  assert.match(section.content(), /Government effects & construction/);
  assert.match(section.content(), /work recorded/);
  assert.equal(section.tag, 'details'); assert.equal(section.open, false); assert.equal(section.children[0]?.textContent, 'Civics & government');
  assert.deepEqual(section.all().filter(node => node.tag === 'details').map(node => node.dataset['townDisclosure']), ['civic-progress', 'civic-tree', 'civics', 'government', 'government-effects']);
  assert.ok(section.all().filter(node => node.tag === 'details').every(node => node.children[0]?.tag === 'summary'));
  assert.equal(section.all().filter(node => ['button', 'input', 'select', 'form'].includes(node.tag)).length, 0);
  assert.ok(section.all().some(node => node.tag === 'svg'));
});

await test('catalogue and event text stays text, with no fabricated HTML controls', () => {
  const source = structuredClone(input(journey.arranged));
  const definition = source.catalogue.governments.find(item => item.id === 'chiefdom');
  assert.ok(definition);
  definition.name = '<button>Adopt now</button>';
  const section = render(source);
  assert.ok(section);
  assert.match(section.content(), /<button>Adopt now<\/button>/);
  assert.equal(section.all().some(node => node.tag === 'button'), false);
});

const secondGovernment = secondGovernmentJourney();

function governmentInput(state: WorldState, cityId: string | null = secondGovernment.cityId): CivicProgressInput {
  const city = state.cities.find(candidate => candidate.id === cityId);
  return { catalogue, projection: projectCapabilities(state, secondGovernment.seat, cityId, secondGovernment.time()), ...(city ? { city } : {}), events: state.events };
}

await test('government choices show canonical distributed Food versus capital work and every slot count', () => {
  const source = governmentInput(secondGovernment.completed);
  const view = civicProgressPresentation(source);
  assert.ok(view);
  const chiefdom = view.government.targets.find(line => line.startsWith('Chiefdom ·'));
  const autocracy = view.government.targets.find(line => line.startsWith('Autocracy ·'));
  assert.ok(chiefdom && autocracy);
  assert.match(chiefdom, /Slots: 1 military · 1 economic · 0 diplomatic · 0 wildcard/);
  assert.match(chiefdom, /\+1 base Food in every owned town/);
  assert.match(autocracy, /Prerequisites met · Quote 0 Credits/);
  assert.match(autocracy, /Slots: 2 military · 1 economic · 0 diplomatic · 1 wildcard/);
  assert.match(autocracy, /\+15% construction work in the owned original capital/);
  assert.equal(view.government.heading, 'Chiefdom');
  assert.ok(view.effects.includes('+1 base Food'));
  assert.ok(!view.effects.some(line => line.includes('15%')));
  const changed = structuredClone(source);
  const definition = changed.catalogue.governments.find(candidate => candidate.id === 'autocracy');
  const target = changed.projection.governance?.targets.find(candidate => candidate.governmentId === 'autocracy');
  assert.ok(definition && target);
  definition.capitalConstructionWorkPercent = 12.5;
  target.slots.wildcard = 2;
  const changedView = civicProgressPresentation(changed);
  assert.ok(changedView?.government.targets.some(line => line.includes('+12.5% construction work') && line.includes('2 wildcard')));
});

await test('real transition snapshots keep active and pending arrangements separate until the next opening', () => {
  for (const state of [secondGovernment.accepted, secondGovernment.firstTransitionBeat]) {
    const source = governmentInput(state);
    const view = civicProgressPresentation(source);
    const pending = source.projection.governance?.government?.pending;
    assert.ok(view && pending);
    assert.equal(view.government.heading, 'Chiefdom');
    assert.ok(view.government.pending.includes('Pending arrangement · Autocracy'));
    assert.ok(view.government.pending.includes(`Accepted round ${pending.acceptedRound} · Recorded transition end ${pending.completionRound}`));
    assert.ok(view.government.pending.includes('Military slot 2 · Empty'));
    assert.ok(view.government.pending.includes('Wildcard slot 1 · Empty'));
    assert.ok(view.government.pending.some(line => line.includes('does not apply early')));
    assert.deepEqual(view.effects, ['+1 base Food', '+1 base construction work']);
  }
  assert.equal(civicProgressPresentation(governmentInput(secondGovernment.firstTransitionBeat))?.outputFactor, 'Current ordinary output factor · 0.75');
  const completed = civicProgressPresentation(governmentInput(secondGovernment.transitionCompleted));
  assert.ok(completed);
  assert.equal(completed.government.heading, 'Autocracy');
  assert.deepEqual(completed.government.pending, []);
  assert.deepEqual(completed.government.slots, ['Military slot 1 · Empty', 'Military slot 2 · Empty', 'Economic slot 1 · Urban planning', 'Wildcard slot 1 · Empty']);
  assert.deepEqual(completed.effects, ['+1 base construction work', '+15% construction work in this town · Owned original capital']);
  for (const state of [secondGovernment.returnAccepted, secondGovernment.returnFirstBeat]) {
    const view = civicProgressPresentation(governmentInput(state));
    assert.ok(view);
    assert.equal(view.government.heading, 'Autocracy');
    assert.ok(view.government.pending.includes('Pending arrangement · Chiefdom'));
    assert.ok(view.effects.some(line => line.includes('+15%')));
    assert.ok(!view.effects.includes('+1 base Food'));
  }
  const returned = civicProgressPresentation(governmentInput(secondGovernment.returned));
  assert.ok(returned);
  assert.equal(returned.government.heading, 'Chiefdom');
  assert.deepEqual(returned.effects, ['+1 base Food', '+1 base construction work']);
});

await test('synthetic selected-town identity uses only the canonical owned original capital', () => {
  const source = structuredClone(governmentInput(secondGovernment.transitionCompleted));
  assert.ok(source.projection.governance && source.city);
  source.city.name = 'An unrelated display name';
  assert.ok(civicProgressPresentation(source)?.effects.some(line => line.includes('+15%')));
  source.projection.cityId = 'another-owned-town';
  source.city.id = 'another-owned-town';
  source.city.name = 'Original capital';
  const elsewhere = civicProgressPresentation(source);
  assert.ok(elsewhere);
  assert.ok(!elsewhere.effects.some(line => line.includes('+15%')));
  assert.equal(elsewhere.capitalApplicability, `No capital construction bonus in this town. It applies only to the owned original capital · ${secondGovernment.cityId}.`);
  source.projection.cityId = null;
  assert.equal(civicProgressPresentation(source)?.capitalApplicability, 'Select a town to inspect its capital construction bonus.');
  source.projection.cityId = secondGovernment.cityId;
  source.city.id = secondGovernment.cityId;
  source.projection.governance.originalCapitalCityId = null;
  const lost = civicProgressPresentation(source);
  assert.ok(lost);
  assert.ok(!lost.effects.some(line => line.includes('+15%')));
  assert.equal(lost.capitalApplicability, 'The original capital is not owned. No capital construction bonus applies.');
  source.projection.governance.modifiers.constructionWork = 0;
  assert.equal(civicProgressPresentation(source)?.emptyEffects, 'No government or policy bonus applies to this town.');
});

await test('actual paid capital work displays exact current capacity and recorded order work separately', () => {
  const source = governmentInput(secondGovernment.firstWorkBeat);
  const before = structuredClone(source);
  const view = civicProgressPresentation(source);
  const order = source.city?.construction?.active;
  assert.ok(view && order && source.projection.governance);
  assert.equal(order.workDone, 4.49);
  assert.match(view.constructionRecord ?? '', /^Theater square · 4.49 \/ 10 work recorded/);
  assert.equal(view.constructionCapacity, `${source.projection.governance.cityConstructionWork} work · Current town capacity`);
  assert.match(view.effectExplanation, /already includes focus, productivity and any applicable capital bonus/);
  assert.match(view.effectExplanation, /does not identify which government produced it/);
  assert.deepEqual(source, before);
  const reslotted = civicProgressPresentation(governmentInput(secondGovernment.reslotted));
  assert.ok(reslotted);
  assert.ok(reslotted.government.slots.includes('Economic slot 1 · Empty'));
  assert.ok(reslotted.government.slots.includes('Wildcard slot 1 · Urban planning'));
  assert.ok(reslotted.government.records.includes(`Policy commitment until round ${secondGovernment.reslotted.civilizations.find(actor => actor.id === secondGovernment.seat)?.government?.active?.policyLockUntilRound}`));
});

await test('synthetic records for all four construction families do not acquire current-government attribution', () => {
  const source = structuredClone(governmentInput(secondGovernment.transitionCompleted));
  assert.ok(source.city && source.projection.governance);
  const base = { ruleVersion: 1 as const, id: 'historical-order', cityId: source.city.id, tileId: 10, startedRound: 700, paid: { materials: 4 }, workRequired: 20, workDone: 7.25 };
  const records: Array<{ order: ConstructionOrder; label: string }> = [
    { order: { ...base, buildingId: 'theater-square' }, label: 'Theater square' },
    { order: { ...base, kind: 'improvement', improvementId: 'mine' }, label: 'Mine' },
    { order: { ...base, kind: 'wonder', wonderId: 'great-library' }, label: 'Great library' },
    { order: { ...base, kind: 'rail', edgeId: '10:11', toTileId: 11, strategicPaid: { iron: 1, coal: 1 } }, label: 'Rail · Tiles 10 ↔ 11 · Edge 10:11' },
  ];
  for (const { order, label } of records) {
    source.city.construction = { active: order, lastCompleted: null };
    source.projection.governance.modifiers.capitalConstructionWorkPercent = 15;
    source.projection.governance.cityConstructionWork = 4.49;
    const boosted = civicProgressPresentation(source);
    source.projection.governance.modifiers.capitalConstructionWorkPercent = 0;
    source.projection.governance.cityConstructionWork = 3.9;
    const ordinary = civicProgressPresentation(source);
    assert.ok(boosted && ordinary);
    assert.equal(boosted.constructionRecord, `${label} · 7.25 / 20 work recorded · Order historical-order`);
    assert.equal(boosted.constructionRecord, ordinary.constructionRecord);
    assert.equal(boosted.constructionCapacity, '4.49 work · Current town capacity');
    assert.equal(ordinary.constructionCapacity, '3.9 work · Current town capacity');
  }
  const completed = governmentInput(secondGovernment.built);
  const retained = civicProgressPresentation(completed)?.constructionRecord;
  assert.match(retained ?? '', /^Last completed · Theater square/);
  assert.ok(completed.projection.governance);
  completed.projection.governance.modifiers.capitalConstructionWorkPercent = 0;
  assert.equal(civicProgressPresentation(completed)?.constructionRecord, retained);
});

await test('second-government comparison and effects stay inside the existing safe native disclosures', () => {
  const source = structuredClone(governmentInput(secondGovernment.accepted));
  const definition = source.catalogue.governments.find(candidate => candidate.id === 'autocracy');
  assert.ok(definition);
  definition.name = '<button>Switch government</button>';
  const section = render(source);
  assert.ok(section);
  assert.deepEqual(section.all().filter(node => node.tag === 'details').map(node => node.dataset['townDisclosure']), ['civic-progress', 'civic-tree', 'civics', 'government', 'government-effects']);
  assert.ok(section.all().filter(node => node.tag === 'details').every(node => node.children[0]?.tag === 'summary'));
  assert.match(section.content(), /<button>Switch government<\/button>/);
  assert.match(section.content(), /0 diplomatic · 1 wildcard/);
  assert.match(section.content(), /Current effects still use the active arrangement/);
  assert.equal(section.all().filter(node => ['button', 'input', 'select', 'form'].includes(node.tag)).length, 0);
});

await test('the civic dependency view derives every node and multi-parent edge from the catalogue', () => {
  const source = input(journey.selected);
  const before = structuredClone(source);
  const nodes = civicTreeNodes(source);
  assert.equal(nodes.length, source.catalogue.civics.length);
  assert.equal(nodes.find(node => node.id === 'code-of-laws')?.status, 'developing');
  assert.equal(nodes.find(node => node.id === 'craftsmanship')?.status, 'unreleased');
  const workforce = nodes.find(node => node.id === 'state-workforce');
  assert.deepEqual(workforce?.requires.map(parent => parent.id), ['craftsmanship', 'early-empire']);
  for (const node of nodes) for (const parent of node.requires) assert.ok(node.level > (nodes.find(candidate => candidate.id === parent.id)?.level ?? -1));
  assert.deepEqual(source, before);
});

await test('civic statuses distinguish released choice, unknown record and completed history', () => {
  assert.equal(civicTreeNodes(input(journey.adopted)).find(node => node.id === 'code-of-laws')?.status, 'available');
  assert.equal(civicTreeNodes(input(journey.completed)).find(node => node.id === 'code-of-laws')?.status, 'completed');
  const unknown = input(journey.adopted);
  delete unknown.projection.governance;
  assert.equal(civicTreeNodes(unknown).find(node => node.id === 'code-of-laws')?.status, 'unknown');
  const expanded = input(journey.selected);
  expanded.catalogue = structuredClone(expanded.catalogue);
  expanded.catalogue.civics.push({ id: 'future-civic', name: 'Future civic', requires: ['code-of-laws'], requiredFeatures: ['not-released'], cost: 80, capability: 'Future catalogue branch.' });
  assert.equal(civicTreeNodes(expanded).find(node => node.id === 'future-civic')?.status, 'unreleased');
});
