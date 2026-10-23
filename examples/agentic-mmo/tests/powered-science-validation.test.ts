import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, ECONOMY_RULES } from '../core/content.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { createWorld } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { LocalPowerBeatReceipt, Resources, WorldState } from '../core/types.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { poweredScienceJourney } from './fixtures/powered-science-journey.ts';

function required<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined); return value; }
let cached: ReturnType<typeof poweredScienceJourney> | undefined;
function story() { cached ??= poweredScienceJourney(); return cached; }
function actor(state: WorldState) { return required(state.civilizations.find(value => value.id === story().seat)); }
function town(state: WorldState) { return required(state.cities.find(value => value.id === story().cityId)); }
function proof(state: WorldState): LocalPowerBeatReceipt { return required(required(town(state).localPower).lastProductiveBeat); }
function lab(receipt: LocalPowerBeatReceipt) { return required(receipt.operations.find(operation => operation.buildingId === 'research-lab')); }
function corrupt(state: WorldState, change: (copy: WorldState) => void, label: string): void {
  const copy = structuredClone(state); change(copy); assert.equal(isWorldState(copy), false, label);
}

void test('old releases reject new powered-Science research targets and completions', () => {
  const original = createWorld(1701);
  assert.ok(isWorldState(original));
  for (const technologyId of ['sanitation', 'chemistry']) {
    const completed = structuredClone(original); const subject = completed.civilizations[0]; assert.ok(subject);
    subject.technologies.push(technologyId);
    assert.equal(isWorldState(completed), false, `unreleased completed ${technologyId}`);
    const active = structuredClone(original); const researcher = active.civilizations[0]; assert.ok(researcher);
    researcher.researchTarget = technologyId;
    assert.equal(isWorldState(active), false, `unreleased active ${technologyId}`);
  }
});

void test('every genuine powered-Science transition and older Power participant subset remains valid', async () => {
  const path = story();
  for (const step of path.steps) assert.ok(isWorldState(step.result.state), `legal frame ${step.result.state.revision}`);
  for (const state of [path.prepared, path.sanitationSelected, path.sanitationCompleted, path.chemistrySelected, path.chemistryCompleted, path.labStarted, path.labCompleted, path.productive, path.pruned, path.replacedByFactory])
    assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(state)), state);
  assert.equal(town(path.labCompleted).buildingOperations?.['research-lab']?.lastResult, null);
  assert.ok(!required(town(path.labCompleted).localPower).lastBeat?.operations.some(operation => operation.buildingId === 'research-lab'));
  assert.equal(path.state.year, path.initial.year); assert.equal(path.state.clockTicks, path.initial.clockTicks);
});

void test('new research completion prefixes and active targets reject corrupt or unreleased history after pruning', () => {
  const path = story();
  const completed = structuredClone(path.chemistryCompleted); completed.events = [];
  assert.ok(isWorldState(completed));
  corrupt(completed, copy => { actor(copy).technologies = actor(copy).technologies.filter(id => id !== 'education'); }, 'Sanitation needs prior Education');
  corrupt(completed, copy => { const ids = actor(copy).technologies; const first = ids.indexOf('sanitation'); const second = ids.indexOf('chemistry'); [ids[first], ids[second]] = [required(ids[second]), required(ids[first])]; }, 'Chemistry cannot precede Sanitation');
  corrupt(path.chemistrySelected, copy => { actor(copy).technologies = actor(copy).technologies.filter(id => id !== 'scientific-method'); }, 'active Chemistry prerequisite');
  corrupt(path.chemistrySelected, copy => { actor(copy).researchProgress = 260; }, 'active progress below snapshot cost');
  corrupt(path.chemistrySelected, copy => { actor(copy).technologies.push('chemistry'); }, 'completed target cannot stay active');
  corrupt(path.sanitationSelected, copy => { copy.unlockedFeatures = copy.unlockedFeatures.filter(id => id !== 'powered-science'); }, 'active released feature');
  corrupt(completed, copy => { copy.unlockedFeatures = copy.unlockedFeatures.filter(id => id !== 'powered-science'); }, 'completed released feature');
  for (const state of [path.sanitationCompleted, path.chemistryCompleted]) {
    const completion = required(actor(state).lastResearchCompletion);
    const completionEvent = (copy: WorldState) => required(copy.events.find(event => event.id === completion.eventId));
    corrupt(state, copy => { completionEvent(copy).actor = (path.seat + 1) % 5; }, 'retained branch completion actor');
    corrupt(state, copy => { completionEvent(copy).target = (path.seat + 1) % 5; }, 'retained branch completion target');
    corrupt(state, copy => { completionEvent(copy).round--; }, 'retained branch completion round');
    corrupt(state, copy => { completionEvent(copy).type = 'research-started'; }, 'retained branch completion kind');
    corrupt(state, copy => { completionEvent(copy).effects = ['Technology banking unlocked']; }, 'retained branch completion technology');
    const pruned = structuredClone(state); pruned.events = [];
    assert.ok(isWorldState(pruned), 'branch completion remains valid after event pruning');
  }
});

void test('Lab commitment snapshots preserve exact payment, local Campus and active admission', () => {
  const path = story();
  corrupt(path.labStarted, copy => { required(town(copy).construction?.active).paid.credits = 0; }, 'start payment');
  corrupt(path.labStarted, copy => { required(town(copy).construction?.active).workRequired = 17; }, 'start work');
  corrupt(path.labCompleted, copy => { required(town(copy).construction?.lastCompleted).paid.materials = 41; }, 'completed payment');
  corrupt(path.labCompleted, copy => { required(town(copy).construction?.lastCompleted).workRequired = 19; }, 'completed work');
  corrupt(path.labStarted, copy => { actor(copy).era = 2; }, 'active Lab explicit era gate');
  corrupt(path.labStarted, copy => { actor(copy).technologies = actor(copy).technologies.filter(id => id !== 'chemistry'); }, 'active Lab Chemistry');
  corrupt(path.labStarted, copy => { town(copy).buildings = town(copy).buildings.filter(id => id !== 'campus'); }, 'same-town Campus');
  for (const state of [path.labStarted, path.labCompleted, path.productive, path.pruned])
    corrupt(state, copy => { copy.unlockedFeatures = copy.unlockedFeatures.filter(id => id !== 'powered-science'); }, 'unreleased Lab reference');
  const historical = structuredClone(path.pruned); historical.events = [];
  actor(historical).technologies = actor(historical).technologies.filter(id => !['sanitation', 'chemistry'].includes(id));
  delete actor(historical).lastResearchCompletion;
  assert.ok(isWorldState(historical), 'installed historical Lab does not impose current owner research admission');
  corrupt(historical, copy => { copy.unlockedFeatures = copy.unlockedFeatures.filter(id => id !== 'powered-science'); }, 'Lab release refusal independent of research references');
});

void test('pruned Lab receipts retain exact Science recipe, full atomic payments and historical identity', () => {
  const state = structuredClone(story().pruned); state.events = [];
  assert.ok(isWorldState(state));
  const receipt = proof(state); const operation = lab(receipt);
  assert.equal(receipt.generated, 8); assert.equal(receipt.consumed, 6); assert.equal(receipt.expired, 2);
  assert.deepEqual(operation.recipe.inputs, { credits: 2 }); assert.deepEqual(operation.recipe.baseOutputs, { science: 12 });
  const path = story(); const step = path.steps.find(candidate => candidate.result.state.revision === path.productive.revision); assert.ok(step?.input.kind === 'strategy');
  const opening = town(step.before); const tile = step.before.tiles.find(candidate => candidate.id === opening.tileId); const campus = BUILDINGS.find(building => building.id === 'campus'); assert.ok(tile && campus);
  assert.deepEqual(opening.buildings.toSorted(), ['campus', 'coal-plant', 'factory', 'industrial-zone', 'library', 'research-lab']);
  assert.equal(opening.buildingOperations?.library?.enabled, false); assert.deepEqual(step.before.wonders, {}); assert.equal(actor(step.before).government?.active, null);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[opening.focus];
  const raw = ECONOMY_RULES.baseProduction.science + (focus.science ?? 0) + (siteProduction(step.before, tile).science ?? 0) + (buildingBaseProduction(step.before, opening, campus).science ?? 0);
  const productivity = (0.5 + opening.wellbeing / 100) * (1 - opening.damage / 100) * (1 + opening.infrastructure / 10);
  const rounded = (value: number): number => Math.round(value * 100) / 100;
  const science = rounded(rounded((raw + 12) * productivity) - rounded(raw * productivity));
  assert.deepEqual(receipt, proof(path.productive)); assert.deepEqual(receipt, step.result.events.find(event => event.id === receipt.eventId)?.localPower);
  assert.equal(operation.result.produced.science, science); assert.equal(operation.result.residents.allocated, 3);
  const changes: Array<(copy: WorldState) => void> = [
    copy => { lab(proof(copy)).recipe.baseOutputs.science = 13; },
    copy => { lab(proof(copy)).result.paid.credits = 1; },
    copy => { lab(proof(copy)).result.localPower.consumed = 2; },
    copy => { lab(proof(copy)).result.residents.allocated = 0; },
    copy => { lab(proof(copy)).result.produced.materials = 1; },
    copy => { lab(proof(copy)).result.operationEventId = proof(copy).eventId; },
    copy => { proof(copy).expired++; },
    copy => { proof(copy).operations.reverse(); },
  ];
  for (const [index, change] of changes.entries()) corrupt(state, change, `pruned Lab corruption ${index}`);
  const historical = structuredClone(state); proof(historical).civId = (proof(historical).civId + 1) % 5;
  assert.ok(isWorldState(historical), 'historical receipt ownership is not current town ownership');
});

void test('retained Lab events cross-check and town-wide positive history survives pruning then real replacement', () => {
  const path = story(); const receipt = proof(path.productive); const operation = lab(receipt);
  corrupt(path.productive, copy => { required(copy.events.find(event => event.id === operation.result.operationEventId)).actor = (receipt.civId + 1) % 5; }, 'retained operation owner');
  corrupt(path.productive, copy => { required(required(copy.events.find(event => event.id === receipt.eventId)).localPower).expired++; }, 'retained closed beat');
  assert.deepEqual(proof(path.nonproductive), receipt); assert.deepEqual(proof(path.pruned), receipt);
  assert.ok(!path.pruned.events.some(event => event.id === receipt.eventId));
  const latest = required(required(town(path.pruned).localPower).lastBeat);
  assert.equal(latest.consumed, 0); assert.equal(latest.expired, 8);
  corrupt(path.pruned, copy => { required(town(copy).localPower).lastProductiveBeat = structuredClone(latest); }, 'generation-only cannot replace productive proof');
  const replacement = proof(path.replacedByFactory);
  assert.ok(replacement.round > receipt.round); assert.equal(lab(replacement).result.status, 'paused');
  assert.ok((replacement.operations.find(value => value.buildingId === 'factory')?.result.produced.materials ?? 0) > 0);
});
