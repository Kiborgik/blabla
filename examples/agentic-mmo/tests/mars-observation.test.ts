import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld } from '../core/engine.ts';
import { RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../core/content.ts';
import type { MarsCivilizationState, MarsMission, Resources, WorldState } from '../core/types.ts';
import { marsObservation, renderMarsObservation, worldJourney } from '../web/mars-observation.ts';

const zero = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const empty = (): MarsCivilizationState => ({ missionsLaunched: 0, activeMission: null, colony: null, lastDeparture: null, lastArrival: null, lastUpkeep: null, lastHabitatWork: null });

void test('the journey keeps a reachable narrow-screen opener, theme-owned button contrast and return focus', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/mars-observation.css', import.meta.url), 'utf8');
  assert.match(main, /id="journey-nav"[^>]+data-open-journey[^>]+aria-controls="journey-dialog"/);
  assert.match(main, /journeyOpener = button; window\.location\.hash = 'journey'/);
  assert.match(main, /narrowLayout\.matches \? '#journey-nav' : '#journey-open'/);
  assert.match(main, /#journey-refresh'\)\.addEventListener\('click', \(\) => \{ renderJourney\(true\)/);
  assert.match(main, /preserveInspection && current\?\.identity === journeyIdentity/);
  assert.match(main, /scrollHost: element\('#journey-dialog'\), scrollTop: element\('#journey-dialog'\)\.scrollTop/);
  assert.match(main, /#era-name'\)\.textContent = journey\?\.headline/);
  assert.match(main, /journey\?\.outcome \? journey\.roundLabel/);
  assert.match(css, /@media \(max-width: 1000px\)\s*\{\s*#app \.journey-nav \{ display: inline-flex/);
  const buttonStyle = css.match(/\.mars-transport button, #journey-refresh \{([^}]+)\}/)?.[1] ?? '';
  assert.match(buttonStyle, /color: var\(--ink\)/); assert.match(buttonStyle, /background: var\(--surface\)/); assert.match(buttonStyle, /min-height: 44px/);
});
function world(): WorldState {
  const state = createWorld(1701, '2026-10-22T00:00:00.000Z');
  state.unlockedFeatures.push(SPACEFLIGHT_RULES.featureId); state.spaceflight = { ruleVersion: 1, civilizations: state.civilizations.map(empty) }; state.round = 20;
  return state;
}
function departure(state: WorldState): MarsMission {
  const city = state.cities.find(item => item.civId === 0); assert.ok(city);
  const launchCost: Partial<Resources> = { ...SPACEFLIGHT_RULES.settle.launchCost }; const cargo: Partial<Resources> = { ...SPACEFLIGHT_RULES.settle.cargo };
  const totalCost = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, (launchCost[resource] ?? 0) + (cargo[resource] ?? 0)]));
  return { ruleVersion: 1, civId: 0, id: 'mission-1', eventId: 'departure-1', mission: 'settle', sourceCityId: city.id, departureRound: 18, arrivalRound: 22, settlers: 3, sourcePopulationBefore: 12, sourcePopulationAfter: 9, launchCost, cargo, totalCost, paid: { ...totalCost } };
}
function arrivedWorld(): WorldState {
  const state = world(); const ledger = state.spaceflight!.civilizations[0]!; const civilization = state.civilizations[0]!; const mission = departure(state);
  state.round = 25; ledger.missionsLaunched = 1; ledger.lastDeparture = mission;
  ledger.colony = { establishedRound: 22, stock: { ...zero(), food: 9, materials: 18, energy: 12 }, shortageRounds: 0 };
  ledger.lastArrival = { ruleVersion: 1, missionId: mission.id, civId: 0, sourceCityId: mission.sourceCityId, round: 22, eventId: 'arrival-1', settlers: 3, cargo: mission.cargo, populationBefore: 0, populationAfter: 3, stockBefore: zero(), stockAfter: { ...zero(), ...mission.cargo } };
  civilization.marsPopulation = 3; civilization.marsProgress = 25;
  ledger.lastHabitatWork = { ruleVersion: 1, civId: 0, round: 24, eventId: 'habitat-1', paid: { ...SPACEFLIGHT_RULES.habitat.costPerBeat }, progressBefore: 0, progressAfter: 25 };
  return state;
}

void test('spacefaring preparation, research and an installed launch complex are not a transport or colony', () => {
  const state = world(); const civilization = state.civilizations[0]!; const city = state.cities.find(item => item.civId === 0)!;
  civilization.era = 5; civilization.technologies.push('spaceflight'); city.buildings.push('launchpad'); state.calendarMilestones.push('beyond-earth');
  const before = structuredClone(state); const view = marsObservation(state, 0); assert.ok(view);
  assert.equal(worldJourney(state).stage, 'Spacefaring preparation'); assert.equal(view.status, 'Earth preparation'); assert.equal(view.technology, true);
  assert.equal(view.sites.length, 1); assert.equal(view.sites[0]?.operation, null); assert.equal(view.sites[0]?.power, null);
  assert.equal(view.mission, null); assert.equal(view.colony, null); assert.equal(view.arrived, false); assert.equal(view.achieved, false); assert.deepEqual(state, before);
});

void test('legacy generic Mars counters cannot establish physical mission, habitat or outcome evidence', () => {
  const state = world(); delete state.spaceflight; const civilization = state.civilizations[0]!;
  civilization.marsPopulation = 100; civilization.marsProgress = 100; civilization.marsSupplyStreak = 100;
  state.outcome = { kind: 'mars', winners: [0], round: state.round, reason: 'Earlier counter-based record' };
  const view = marsObservation(state, 0); assert.ok(view);
  assert.equal(view.status, 'Detailed mission records unavailable'); assert.equal(view.colony, null); assert.equal(view.mission, null); assert.equal(view.achieved, false);
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== SPACEFLIGHT_RULES.featureId);
  assert.equal(marsObservation(state, 0)?.status, 'Not released'); assert.equal(marsObservation(state, 99), null);
});

void test('paid transit retains its exact source, settlers, cargo and strategic arrival without inventing arrival', () => {
  const state = world(); const ledger = state.spaceflight!.civilizations[0]!; const mission = departure(state);
  ledger.activeMission = mission; ledger.lastDeparture = mission; ledger.missionsLaunched = 1;
  const view = marsObservation(state, 0); assert.ok(view?.mission);
  assert.equal(view.mission.sourceName, state.cities.find(city => city.id === mission.sourceCityId)?.name);
  assert.equal(view.mission.elapsed, 2); assert.equal(view.mission.duration, 4); assert.equal(view.mission.settlers, 3); assert.deepEqual(view.mission.paid, mission.paid);
  assert.equal(view.arrived, false); assert.equal(view.colony, null);
  state.round = 24;
  assert.equal(marsObservation(state, 0)?.mission?.elapsed, 4); assert.equal(marsObservation(state, 0)?.arrived, false);
});

void test('delivered colony stocks remain separate from Earth inventory and in-transit resupply', () => {
  const state = arrivedWorld(); const civilization = state.civilizations[0]!; const ledger = state.spaceflight!.civilizations[0]!;
  civilization.resources.food = 987654; ledger.activeMission = { ...departure(state), id: 'resupply-2', mission: 'resupply', settlers: 0 };
  const before = structuredClone(state); const view = marsObservation(state, 0); assert.ok(view?.colony);
  assert.equal(view.arrived, true); assert.equal(view.colony.stock.food, 9); assert.equal(view.mission?.cargo.food, 18); assert.equal(view.colony.population, 3);
  assert.equal(view.colony.habitatWork, 25); assert.equal(view.colony.habitable, false); assert.equal(view.achieved, false); assert.deepEqual(state, before);
  view.colony.stock.food = 100; assert.equal(ledger.colony?.stock.food, 9);
});

void test('completed habitat, retained supply receipts, shortages and terminal outcome remain distinct after event eviction', () => {
  const state = arrivedWorld(); const civilization = state.civilizations[0]!; const ledger = state.spaceflight!.civilizations[0]!;
  civilization.marsProgress = SPACEFLIGHT_RULES.habitat.requiredWork; civilization.marsSupplyStreak = VICTORY_RULES.mars.suppliedRounds;
  ledger.lastHabitatWork!.progressBefore = 75; ledger.lastHabitatWork!.progressAfter = civilization.marsProgress; state.events = [];
  let view = marsObservation(state, 0); assert.ok(view?.colony); assert.equal(view.colony.habitable, true); assert.equal(view.achieved, false);
  ledger.lastUpkeep = { ruleVersion: 1, civId: 0, round: 25, eventId: 'upkeep-1', status: 'shortage', required: { food: 3 }, paid: { food: 1 }, missing: { food: 2 }, stockBefore: { ...zero(), food: 1 }, stockAfter: zero(), populationBefore: 3, populationAfter: 3, habitableBefore: true, supplyStreakBefore: 2, supplyStreakAfter: 0, shortageRoundsBefore: 0, shortageRoundsAfter: 1 };
  civilization.marsSupplyStreak = 0; view = marsObservation(state, 0);
  assert.equal(view?.status, 'Colony supply shortage'); assert.equal(view?.colony?.supplyStreak, 0); assert.equal(view?.ledger?.lastUpkeep?.missing.food, 2);
  civilization.marsPopulation = 0; assert.equal(marsObservation(state, 0)?.status, 'Uninhabited colony');
  civilization.marsPopulation = 3; civilization.marsSupplyStreak = VICTORY_RULES.mars.suppliedRounds; state.round = 27;
  ledger.lastUpkeep = { ...ledger.lastUpkeep, round: 27, status: 'supplied', paid: { food: 3 }, missing: {}, stockBefore: { ...zero(), food: 3 }, supplyStreakBefore: 2, supplyStreakAfter: civilization.marsSupplyStreak, shortageRoundsBefore: 0, shortageRoundsAfter: 0 };
  state.outcome = { kind: 'mars', winners: [0], round: 27, reason: 'Recorded sustained colony' };
  assert.equal(marsObservation(state, 0)?.status, 'Sustained Mars home'); assert.equal(marsObservation(state, 1)?.achieved, false);
});

void test('world milestones retain their own proof and never invent a round for an older archive', () => {
  const state = world(); state.calendarMilestones.push('first-harvest', 'industrial-world');
  state.milestoneProofs = { 'first-harvest': { ruleVersion: 1, milestoneId: 'first-harvest', round: 7, revision: 30, eventId: 'harvest-proof', year: -9500, targetYear: -9500, era: 0 } };
  const view = worldJourney(state);
  assert.equal(view.milestones.find(item => item.id === 'first-harvest')?.proof?.round, 7);
  assert.equal(view.milestones.find(item => item.id === 'industrial-world')?.proof, null);
  assert.equal(view.milestones.find(item => item.id === 'industrial-world')?.status, 'recorded');
});

void test('terminal journey names the actual outcome and winners without promoting a rival still in transit', () => {
  const state = arrivedWorld(); const civilization = state.civilizations[0]!; const ledger = state.spaceflight!.civilizations[0]!;
  civilization.era = 5; civilization.marsProgress = SPACEFLIGHT_RULES.habitat.requiredWork; civilization.marsSupplyStreak = VICTORY_RULES.mars.suppliedRounds;
  ledger.lastHabitatWork!.progressBefore = 75; ledger.lastHabitatWork!.progressAfter = civilization.marsProgress;
  ledger.lastUpkeep = { ruleVersion: 1, civId: 0, round: 122, eventId: 'supplied-122', status: 'supplied', required: { food: 3 }, paid: { food: 3 }, missing: {}, stockBefore: { ...zero(), food: 6 }, stockAfter: { ...zero(), food: 3 }, populationBefore: 3, populationAfter: 3, habitableBefore: true, supplyStreakBefore: 2, supplyStreakAfter: civilization.marsSupplyStreak, shortageRoundsBefore: 0, shortageRoundsAfter: 0 };
  state.round = 122; state.outcome = { kind: 'mars', winners: [0], round: 122, reason: 'A sustained human presence on Mars' };
  const rival = state.spaceflight!.civilizations[1]!;
  rival.activeMission = { ...departure(state), civId: 1, sourceCityId: state.cities.find(city => city.civId === 1)!.id, id: 'rival-mission', departureRound: 119, arrivalRound: 123 };
  const before = structuredClone(state); const journey = worldJourney(state);
  assert.equal(journey.stage, 'Spacefaring preparation'); assert.equal(journey.headline, 'Sustained Mars home');
  assert.deepEqual(journey.outcome?.winners, [civilization.name]); assert.equal(journey.outcome?.round, 122);
  assert.equal(journey.roundLabel, 'Round 122 · World complete');
  assert.equal(marsObservation(state, 1)?.status, 'Transport in flight'); assert.equal(marsObservation(state, 1)?.arrived, false);
  assert.equal(marsObservation(state, 1)?.mission?.arrivalRound, 123); assert.deepEqual(state, before);
  delete state.spaceflight;
  assert.equal(worldJourney(state).headline, 'Mars outcome recorded');
  state.outcome = { kind: 'federation', winners: [0, 2], round: 122, reason: 'Recorded alliance outcome' };
  assert.equal(worldJourney(state).headline, 'Federation outcome recorded');
  assert.deepEqual(worldJourney(state).outcome?.winners, [state.civilizations[0]!.name, state.civilizations[2]!.name]);
  state.outcome = null;
  assert.equal(worldJourney(state).headline, 'Spacefaring preparation'); assert.equal(worldJourney(state).roundLabel, 'Round 122');
});

class ElementRecord {
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  textContent = ''; className = ''; open = false; type = ''; max = 0; value = 0; scrollTop = 0;
  onReplace: (() => void) | null = null;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); children: ElementRecord[] = []; listeners = new Map<string, () => void>();
  style = { setProperty: (_name: string, _value: string): void => {} };
  append(...children: ElementRecord[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementRecord[]): void { this.children = children; this.onReplace?.(); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelectorAll(selector: string): ElementRecord[] {
    assert.equal(selector, 'details[data-journey-record]');
    return this.all().filter(node => node.tag === 'details' && node.dataset['journeyRecord'] !== undefined);
  }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}

void test('journey rendering uses native disclosures, inert text, factual schematics and only observer navigation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'); const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_ns: string, tag: string) => createElement(tag) } });
  try {
    const state = arrivedWorld(); const ledger = state.spaceflight!.civilizations[0]!; ledger.activeMission = departure(state); state.civilizations[0]!.name = '<img src=x>';
    const host = new ElementRecord('div'); let inspected = '';
    renderMarsObservation(host as unknown as HTMLElement, state, 0, id => { inspected = id; });
    assert.match(host.content(), /<img src=x>/); assert.equal(host.all().some(node => node.tag === 'img'), false);
    assert.match(host.content(), /Not yet in colony stores/); assert.match(host.content(), /separate from Earth reserves/); assert.match(host.content(), /not a surface map/);
    const cards = host.all().filter(node => node.className === 'mars-civilization'); assert.equal(cards.length, 5); assert.equal(cards[0]?.open, true); assert.equal(cards[1]?.open, false);
    const buttons = host.all().filter(node => node.tag === 'button'); assert.equal(buttons.length, 1); assert.equal(buttons[0]?.textContent, 'Inspect departure town');
    buttons[0]?.listeners.get('click')?.(); assert.equal(inspected, ledger.activeMission.sourceCityId);
    assert.equal(host.all().some(node => ['input', 'select', 'form'].includes(node.tag)), false);
    assert.ok(host.all().some(node => node.attributes.get('class') === 'mars-lander'));
    assert.ok(host.all().some(node => node.attributes.get('class') === 'mars-habitat building'));
    assert.equal(host.all().some(node => node.attributes.get('class') === 'mars-habitat complete'), false);
    assert.ok(host.all().filter(node => node.tag === 'details').every(node => node.children[0]?.tag === 'summary'));
    state.outcome = { kind: 'mars', winners: [0], round: state.round, reason: 'Earlier outcome without completed habitat proof' };
    renderMarsObservation(host as unknown as HTMLElement, state, 0, () => {});
    assert.equal(host.all().find(node => node.className === 'journey-world-records')?.children[0]?.textContent, 'Mars outcome recorded · World history');
    assert.match(host.content(), /unfinished missions remain in their recorded state/);
    assert.match(host.content(), /This transport has no recorded arrival/);
    assert.doesNotMatch(host.content(), /Sustained Mars home/);
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
});

void test('explicit journey refresh preserves manual disclosures and dialog scroll while displaying the new records', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'); const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_ns: string, tag: string) => createElement(tag) } });
  try {
    const state = arrivedWorld(); const host = new ElementRecord('div'); const dialog = new ElementRecord('dialog');
    const render = (refresh = false): void => renderMarsObservation(host as unknown as HTMLElement, state, 1, () => {}, refresh ? { scrollHost: dialog as unknown as HTMLElement, scrollTop: dialog.scrollTop } : undefined);
    render();
    const disclosures = host.all().filter(node => node.tag === 'details');
    const aster = disclosures.find(node => node.className === 'mars-civilization' && node.dataset['civilization'] === '0');
    const verdant = disclosures.find(node => node.className === 'mars-civilization' && node.dataset['civilization'] === '1');
    const receipt = disclosures.find(node => node.children[0]?.textContent.startsWith('Last habitat work'));
    const history = disclosures.find(node => node.className === 'journey-world-records');
    assert.ok(aster && verdant && receipt && history);
    aster.open = true; verdant.open = false; receipt.open = true; history.open = true; dialog.scrollTop = 311;
    host.onReplace = () => { dialog.scrollTop = 0; };
    state.spaceflight!.civilizations[0]!.lastHabitatWork!.round = 26;
    const before = structuredClone(state); render(true);
    const restored = host.all().filter(node => node.tag === 'details');
    assert.equal(restored.find(node => node.dataset['civilization'] === '0')?.open, true);
    assert.equal(restored.find(node => node.dataset['civilization'] === '1')?.open, false);
    assert.equal(restored.find(node => node.children[0]?.textContent === 'Last habitat work · Round 26')?.open, true);
    assert.equal(restored.find(node => node.className === 'journey-world-records')?.open, true);
    assert.equal(dialog.scrollTop, 311); assert.deepEqual(state, before);
    for (const record of restored) record.open = false;
    render(true);
    assert.equal(host.all().filter(node => node.tag === 'details').some(node => node.open), false);
    render();
    assert.equal(host.all().find(node => node.dataset['civilization'] === '1')?.open, true);
    assert.equal(host.all().find(node => node.dataset['civilization'] === '0')?.open, false);
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
});
