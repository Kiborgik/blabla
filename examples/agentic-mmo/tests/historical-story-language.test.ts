import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyHistoryAdvance, createWorld } from '../core/engine.ts';
import { CIVICS, ERAS, FEATURES, TECHNOLOGIES } from '../core/content.ts';
import { chooseCivic, resolveCivics } from '../core/simulation/civics.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { adoptGovernment, resolveGovernmentTransitions } from '../core/simulation/government.ts';
import { nextEarnedHistoryAdvance, resolveHistory } from '../core/simulation/history.ts';
import { completeResearch } from '../core/simulation/research.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { storyLanguage } from '../web/story-language.ts';
import { renderSpectatorChronicle, spectatorChronicle, type SpectatorDestination } from '../web/spectator-hud.ts';

const epoch = '2026-10-16T00:00:00.000Z';
let baseline: WorldState | undefined;
function world(): WorldState {
  baseline ??= createWorld(1701, epoch, 'settlement-knowledge-compacts-1');
  return structuredClone(baseline);
}
function language(state: WorldState, event: GameEvent) {
  const entry = eventLogEntries([event], { civilizations: state.civilizations })[0]; assert.ok(entry);
  const before = structuredClone({ state, event, entry });
  const display = storyLanguage(state, event, entry);
  assert.deepEqual({ state, event, entry }, before);
  return display;
}
function last(events: GameEvent[], type: string): GameEvent {
  const event = events.findLast(candidate => candidate.type === type); assert.ok(event, type); return event;
}
function civicHistory() {
  const state = world(); const events: GameEvent[] = [];
  const actor = state.civilizations[0]!;
  actor.name = 'Aster 1701 / city-999';
  for (const civic of CIVICS) {
    chooseCivic(state, actor.id, civic.id, events);
    state.round += 1; actor.resources.culture += civic.cost;
    resolveCivics(state, actor.id, civic.cost, events);
  }
  return { state, events, actor };
}

void test('actual civic producers distinguish chosen work from completion using exact actor and catalogue names', () => {
  const { state, events, actor } = civicHistory();
  for (const civic of CIVICS) {
    const started = events.find(event => event.type === 'civic-started' && event.effects[0] === `Civic ${civic.id}`)!;
    const completed = events.find(event => event.type === 'civic-completed' && event.effects[0] === `Completed civic ${civic.id}`)!;
    const selection = language(state, started); const result = language(state, completed);
    assert.equal(selection.title, `${actor.name} began developing ${civic.name}`);
    assert.equal(result.title, `${actor.name} completed ${civic.name}`);
    assert.match(selection.consequence, new RegExp(`${civic.cost} Culture.*not complete`));
    assert.match(result.cause, new RegExp(`${civic.cost} Culture`));
    assert.match(result.consequence, /One free government or policy change was earned; none happened automatically/);
    assert.equal(selection.cause, '');
    assert.doesNotMatch(JSON.stringify([selection, result]), /released cultural commitment|construction work|15%|Food \+/);
    actor.civics!.active = null; actor.government!.active = null; actor.resources.culture = 9999;
    assert.deepEqual(language(state, completed), result);
  }
});

void test('actual government choices, paid reslot and completed transition describe only recorded stages', () => {
  const { state, events, actor } = civicHistory();
  const assignments = [{ slotType: 'economic' as const, slotIndex: 0, policyId: 'urban-planning' }];
  adoptGovernment(state, actor.id, 'chiefdom', assignments, events);
  const selected = last(events, 'arrangement-accepted');
  const choice = language(state, selected);
  assert.equal(choice.title, `${actor.name} chose Chiefdom`);
  assert.match(choice.consequence, /Urban planning.*Paid 0 Credits.*round/);
  state.round = actor.government!.active!.policyLockUntilRound;
  adoptGovernment(state, actor.id, 'chiefdom', [], events);
  assert.match(language(state, last(events, 'arrangement-accepted')).consequence, /No policies were selected.*Paid 8 Credits/);
  state.round = actor.government!.active!.policyLockUntilRound;
  adoptGovernment(state, actor.id, 'autocracy', assignments, events);
  const accepted = last(events, 'arrangement-accepted'); const pending = language(state, accepted);
  assert.equal(pending.title, `${actor.name} chose Autocracy`);
  assert.match(pending.consequence, /not finished.*Paid 10 Credits/);
  assert.doesNotMatch(JSON.stringify(pending), /15|construction work|made|produced|more Food/);
  state.round = actor.government!.pending!.completionRound;
  resolveGovernmentTransitions(state, events);
  const completion = last(events, 'transition-completed'); const completed = language(state, completion);
  assert.equal(completed.title, `${actor.name} completed the change to Autocracy`);
  assert.match(completed.consequence, /next season.*round/);
  delete actor.government; delete actor.civics;
  assert.deepEqual(language(state, accepted), pending); assert.deepEqual(language(state, completion), completed);
  assert.deepEqual(language(state, selected), choice);
});

void test('research start and completion use exact known IDs and never turn capability prose into production', () => {
  for (const productive of [true, false]) {
    const state = world(); const events: GameEvent[] = []; const actor = state.civilizations[1]!;
    actor.name = 'Verdant 23';
    if (!productive) state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'productive-research');
    const technology = TECHNOLOGIES.find(candidate => candidate.id === 'chemistry')!;
    executeAction(state, actor.id, { type: 'research', technology: technology.id }, events);
    const selection = language(state, last(events, 'research-started'));
    assert.equal(selection.title, `${actor.name} began researching ${technology.name}`);
    assert.match(selection.consequence, /not complete/);
    assert.match(selection.cause, productive ? /towns.*Science/ : /Stored.*future Science/);
    completeResearch(state, actor.id, technology, events);
    const completed = last(events, 'research-completed'); const display = language(state, completed);
    assert.equal(display.title, `${actor.name} discovered ${technology.name}`);
    assert.match(display.cause, new RegExp(`${technology.cost} Science`));
    assert.match(display.consequence, /Building and production are separate/);
    assert.doesNotMatch(JSON.stringify(display), /12 Science|laborator|Power|unlocked/);
    actor.technologies = []; actor.researchTarget = 'agriculture';
    assert.deepEqual(language(state, completed), display);
  }
});

void test('real milestone and calendar producers distinguish reached era from dated advancement', () => {
  const state = world(); const events: GameEvent[] = [];
  state.cities[0]!.buildings.push('farm');
  for (const actor of state.civilizations.slice(0, 2)) actor.technologies.push('agriculture', 'civic-institutions');
  state.routes = [0, 1, 2].map(index => ({ id: `route-history-${index}`, from: state.cities[index]!.id, to: state.cities[index + 1]!.id, owner: index, partner: index + 1, active: true, damage: 0, volume: 1 }));
  resolveHistory(state, events);
  const milestone = last(events, 'history-milestone');
  assert.equal(milestone.effects[1], 'Historical milestone rise-of-states recorded');
  const reached = language(state, milestone);
  assert.equal(reached.title, 'The rise of states');
  assert.match(reached.consequence, /Cities and States.*10,000 BCE.*unchanged/);
  assert.doesNotMatch(JSON.stringify(reached), /build|produced|delivered|unlocked/);
  const command = nextEarnedHistoryAdvance(state, epoch); assert.ok(command);
  const result = applyHistoryAdvance(state, command); assert.ok(result.ok, result.error);
  const advanced = last(result.events, 'history-advanced'); const dated = language(result.state, advanced);
  assert.equal(dated.title, 'The calendar reached 3,000 BCE');
  assert.match(dated.consequence, /10,000 BCE → 3,000 BCE.*7,000 years.*capabilities did not change/);
  assert.equal(dated.cause, 'The rise of states was the recorded milestone.');
  result.state.year = 9999; result.state.calendarMilestones = []; result.state.milestoneProofs = {};
  for (const actor of result.state.civilizations) actor.era = ERAS.length - 1;
  assert.deepEqual(language(result.state, advanced), dated); assert.deepEqual(language(result.state, milestone), reached);
  const feature = FEATURES.find(candidate => candidate.id === 'history-advancement')!;
  const unchanged = applyHistoryAdvance(state, { expectedRevision: state.revision, cause: { kind: 'feature', id: feature.id }, reason: 'Recorded release boundary', deltaYears: 0, timestamp: epoch });
  assert.ok(unchanged.ok, unchanged.error);
  const noYears = language(unchanged.state, last(unchanged.events, 'history-advanced'));
  assert.equal(noYears.title, 'The calendar stayed at 10,000 BCE');
  assert.match(noYears.consequence, /0 years added/);
  assert.equal(noYears.cause, `${feature.name} was the recorded reason for this calendar change.`);
});

void test('unknown and malformed historical IDs or patterns retain the original fallback without consulting current choices', () => {
  const { state, events } = civicHistory();
  adoptGovernment(state, 0, 'chiefdom', [], events);
  const original = last(events, 'civic-started');
  const variants: GameEvent[] = [
    { ...original, effects: ['Civic future-civic', 'Required Culture 16', 'Science research remains independent'] },
    { ...original, effects: ['Civic code-of-laws trailing', 'Required Culture 16', 'Science research remains independent'] },
    { ...original, effects: ['Civic code-of-laws', 'Required Culture 1e999', 'Science research remains independent'] },
    { ...original, cause: 'A similar but unknown cultural selection' },
    { ...original, actor: null },
    { ...original, target: 1 },
    { ...last(events, 'civic-completed'), cause: 'Civic code-of-laws received 16 Culture' },
    { ...last(events, 'arrangement-accepted'), detail: 'economic:0 future-policy' },
    { ...last(events, 'arrangement-accepted'), detail: 'economic:99 urban-planning' },
    { ...last(events, 'arrangement-accepted'), effects: ['Government future-government', 'Credits paid 0', 'Reform completion none', 'Policy commitment until round 9'] },
    { ...original, type: 'transition-completed', detail: 'Government missing applies at the next opening', cause: 'The two-beat transition accepted at round 3 completed', effects: ['Effective round 5', 'Commitment until round 9'] },
    { ...original, type: 'history-milestone', cause: 'Released features statecraft and observed world conditions satisfied future-milestone', effects: ['Capability stage 1 attained in year -3000', 'Historical milestone future-milestone recorded'] },
    { ...original, type: 'history-advanced', cause: `milestone rise-of-states justified an explicit advancement at ${epoch}`, effects: ['Calendar -3000 → -5000', 'Reason: Not monotonic', 'Authoritative clock accounting and released capabilities remain unchanged'] },
    { ...original, type: 'research-started', detail: 'unknown-tech', effects: ['Research target unknown-tech'] },
    { ...original, type: 'research-completed', effects: ['Technology chemistry unlocked', 'Technology agriculture unlocked'] },
  ];
  for (const [index, variant] of variants.entries()) {
    variant.title = `Original record ${index}`;
    const row = eventLogEntries([variant], { civilizations: state.civilizations })[0]!;
    const display = language(state, variant);
    assert.equal(display.title, row.title);
    assert.equal(display.cause, row.cause);
    assert.equal(display.consequence, row.summary || row.effects.slice(0, 2).join(' '));
  }
  const unrelated = { ...original, type: 'future-history', title: '<b>Unknown history</b>', cause: 'Unrecognized cause', effects: ['Only this effect was recorded'] };
  assert.deepEqual(language(state, unrelated), { title: unrelated.title, cause: unrelated.cause, consequence: unrelated.effects[0] });
});

void test('Chronicle renders exact inert text with result before cause in DOM and accessible name while preserving Details, focus and navigation', () => {
  class ElementRecord {
    tag: string;
    textContent = '';
    className = '';
    dataset: Record<string, string> = {};
    children: ElementRecord[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    constructor(tag: string) { this.tag = tag; }
    set innerHTML(_value: string) { throw new Error('Event text must remain inert'); }
    append(...children: ElementRecord[]): void { this.children.push(...children); }
    replaceChildren(...children: ElementRecord[]): void { this.children = children; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    addEventListener(name: string, callback: () => void): void { this.listeners.set(name, callback); }
    contains(node: ElementRecord): boolean { return this.all().includes(node); }
    focus(): void { documentRecord.activeElement = this; }
    all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const documentRecord = { activeElement: null as ElementRecord | null, createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_ns: string, tag: string) => new ElementRecord(tag) };
  const originals = new Map(['document', 'HTMLElement', 'HTMLButtonElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ document: documentRecord, HTMLElement: ElementRecord, HTMLButtonElement: ElementRecord })) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const { state, events, actor } = civicHistory();
    actor.name = '<img src=x onerror=alert(1)> 42';
    state.events = [last(events, 'civic-completed')];
    const before = structuredClone(state);
    const story = spectatorChronicle(state)[0]!;
    assert.deepEqual(story.event, eventLogEntries(state.events, { civilizations: state.civilizations })[0]);
    assert.equal(story.event.detail, state.events[0]!.detail); assert.equal(story.event.cause, state.events[0]!.cause); assert.deepEqual(story.event.effects, state.events[0]!.effects);
    const host = new ElementRecord('ol'); let destination: SpectatorDestination | null = null;
    const render = (identity: string) => renderSpectatorChronicle(host as unknown as HTMLElement, [story], target => { destination = target; }, identity);
    render('same-world');
    const nodes = host.all(); const button = nodes.find(node => node.tag === 'button')!;
    assert.equal(nodes.find(node => node.tag === 'strong')?.textContent, `${actor.name} completed Political philosophy`);
    const result = nodes.findIndex(node => node.className === 'chronicle-result'); const cause = nodes.findIndex(node => node.className === 'chronicle-cause');
    assert.ok(result >= 0 && cause > result);
    const label = button.attributes.get('aria-label')!; assert.ok(label.indexOf('Result:') < label.indexOf('Why:'));
    assert.equal(nodes.some(node => node.tag === 'img'), false);
    button.listeners.get('click')?.(); assert.deepEqual(destination, story.destination);
    button.focus(); render('same-world');
    assert.notStrictEqual(documentRecord.activeElement, button); assert.equal(documentRecord.activeElement?.dataset['storyId'], story.event.id);
    const previousFocus = documentRecord.activeElement; render('different-world'); assert.strictEqual(documentRecord.activeElement, previousFocus);
    assert.deepEqual(state, before);
    state.events = [last(events, 'civic-started')];
    renderSpectatorChronicle(host as unknown as HTMLElement, spectatorChronicle(state), () => {});
    assert.equal(host.all().some(node => node.className === 'chronicle-cause'), false);
  } finally {
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
