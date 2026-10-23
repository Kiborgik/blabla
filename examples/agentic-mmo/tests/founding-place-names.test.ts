import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { generateGeography } from '../core/generated-geography.ts';
import { generatePlaceName, type PlaceNameInput } from '../core/place-names.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { isWorldState } from '../core/validation.ts';
import { CIV_COUNT, DIRECTOR_SEAT, type City, type Command, type GameAction, type TransitionResult, type WorldState } from '../core/types.ts';
import { choiceActionId, createChoicePage, parseChoicePageRequest } from '../protocol/choice-pages.ts';
import { ACTIVE_LOCAL_RELEASE_ID, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';

const EPOCH = '2000-01-01T00:00:00.000Z';
const NAMING_VERSION = 'cultural-toponyms-v1';
const authoredCapitals = ['Dawnwell', 'Willowmere', 'Cinderhold', 'Tidehaven', 'Lumen'];
const timestamp = (seconds: number): string => new Date(Date.parse(EPOCH) + seconds * 1000).toISOString();

function namingInput(state: WorldState, city: Pick<City, 'id' | 'civId' | 'tileId'>): PlaceNameInput {
  const tile = state.tiles.find(candidate => candidate.id === city.tileId);
  assert.ok(tile && tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  return { worldSeed: state.seed, civId: city.civId, cityId: city.id, locality: { terrain: tile.terrain, coastal: isCoastalSite(state, tile.id) } };
}

function withoutNaming(state: WorldState): WorldState {
  const copy = structuredClone(state);
  assert.ok(copy.origin);
  delete copy.origin.namingVersion;
  return copy;
}

function normalizedFounding(result: TransitionResult): TransitionResult {
  const copy = structuredClone(result);
  copy.state = withoutNaming(copy.state);
  const founded = copy.state.cities.at(-1);
  assert.ok(founded);
  const name = founded.name;
  founded.name = '<founded-name>';
  for (const event of [...copy.events, ...copy.state.events]) {
    if (event.tileId === founded.tileId && ['settlement-founded', 'coastal-founded'].includes(event.type)) {
      assert.ok(event.title.startsWith(`${name} is founded`));
      event.title = `<founded-name>${event.title.slice(name.length)}`;
    }
  }
  return copy;
}

function paidFounding(state: WorldState, command: Command): TransitionResult {
  assert.ok(command.action.type === 'settle' || command.action.type === 'settle-coast');
  const action = command.action;
  const before = structuredClone(state);
  const result = applyCommand(state, command);
  const legacy = withoutNaming(state);
  const nameFree = applyCommand(legacy, command);
  assert.equal(result.ok, true, result.error);
  assert.equal(nameFree.ok, true, nameFree.error);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state));
  const founded = result.state.cities.at(-1);
  const source = before.cities.find(city => city.id === action.sourceCityId);
  assert.ok(founded && source);
  assert.equal(founded.id, `city-${command.seat}-${before.revision + 1}`);
  assert.equal(founded.name, generatePlaceName(namingInput(before, founded), before.cities.map(city => city.name)));
  assert.equal(nameFree.state.cities.at(-1)?.name, `${before.civilizations[command.seat]!.name} ${before.cities.filter(city => city.civId === command.seat).length + 1}`);
  assert.equal(result.state.rng, before.rng);
  assert.equal(result.state.cities.length, before.cities.length + 1);
  assert.deepEqual(result.state.cities.slice(0, -1).map(city => [city.id, city.name]), before.cities.map(city => [city.id, city.name]));
  assert.equal(result.state.cities.find(city => city.id === source.id)?.population, source.population - ECONOMY_RULES.settle.population);
  assert.equal(result.state.cities.reduce((sum, city) => sum + city.population, 0), before.cities.reduce((sum, city) => sum + city.population, 0));
  for (const resource of RESOURCE_IDS) assert.equal(result.state.civilizations[command.seat]!.resources[resource], before.civilizations[command.seat]!.resources[resource] - (Reflect.get(ECONOMY_RULES.settle.cost, resource) ?? 0));
  assert.deepEqual(normalizedFounding(result), normalizedFounding(nameFree));
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)), command), result);
  const duplicate = applyCommand(result.state, command);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.state, result.state);
  assert.deepEqual(duplicate.events, []);
  return result;
}

void test('optional origin naming metadata admits only the exact supported present value without mutating saves', () => {
  const run = createLocalSimulation(1701);
  assert.equal(run.state.origin?.namingVersion, NAMING_VERSION);
  assert.ok(isWorldState(run.state));
  const saved = JSON.stringify(run);
  assert.equal(JSON.stringify(parseLocalSimulation(JSON.parse(saved))), saved);
  for (const value of [undefined, null, '', 1, true, {}, [], 'cultural-toponyms-v2', ' cultural-toponyms-v1', 'cultural-toponyms-v1\n']) {
    const invalid = structuredClone(run);
    assert.ok(invalid.state.origin);
    Reflect.set(invalid.state.origin, 'namingVersion', value);
    const before = structuredClone(invalid);
    assert.equal(isWorldState(invalid.state), false, `Invalid present naming version: ${String(value)}`);
    assert.equal(parseLocalSimulation(invalid), null);
    assert.deepEqual(invalid, before);
  }
  const extra = structuredClone(run);
  assert.ok(extra.state.origin);
  Reflect.set(extra.state.origin, 'namingRevision', 1);
  assert.equal(isWorldState(extra.state), false);
  assert.equal(parseLocalSimulation(extra), null);
  for (const value of [null, '', 1, 'cultural-toponyms-v2']) assert.throws(() => createGeneratedWorld(1701, EPOCH, ACTIVE_LOCAL_RELEASE_ID, value as typeof NAMING_VERSION), RangeError);
  assert.equal(JSON.stringify(run), saved);
});

void test('versioned capitals use relocated authoritative coastal geography while every non-name foundation byte stays legacy', () => {
  for (const seed of [0, 1701, 0xffffffff]) {
    const legacy = createGeneratedWorld(seed, EPOCH, ACTIVE_LOCAL_RELEASE_ID);
    const current = createGeneratedWorld(seed, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION);
    const geography = generateGeography(seed);
    const occupied: string[] = [];
    for (const city of current.cities) {
      assert.equal(city.tileId, geography.capitalTileIds[city.civId]);
      assert.equal(city.name, generatePlaceName(namingInput(current, city), occupied));
      occupied.push(city.name);
    }
    assert.equal(new Set(occupied.map(name => name.toLowerCase())).size, CIV_COUNT);
    assert.ok(current.cities.some(city => isCoastalSite(current, city.tileId)));
    assert.ok(current.cities.some(city => !isCoastalSite(current, city.tileId)));
    assert.deepEqual(createGeneratedWorld(seed, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION), current);
    const normalized = withoutNaming(current);
    normalized.cities.forEach((city, index) => { city.name = legacy.cities[index]!.name; });
    assert.deepEqual(normalized, legacy);
    assert.deepEqual(legacy.cities.map(city => city.name), authoredCapitals);
    assert.equal(Object.hasOwn(legacy.origin!, 'namingVersion'), false);
    assert.deepEqual(createGeneratedWorld(seed, EPOCH, ACTIVE_LOCAL_RELEASE_ID, undefined), legacy);
  }
  assert.deepEqual(createWorld(1701, EPOCH).cities.map(city => city.name), authoredCapitals);
  assert.equal(createWorld(1701, EPOCH).origin, undefined);
  const defaultFactory = createGeneratedWorld(1701, EPOCH);
  assert.deepEqual(defaultFactory, createGeneratedWorld(1701, EPOCH, 'settlement-living-partnerships-1'));
  assert.equal(Object.hasOwn(defaultFactory.origin!, 'namingVersion'), false);
});

void test('actual paid land founding names every civilization once without changing supplies residents IDs RNG or append order', () => {
  for (let seat = 0; seat < CIV_COUNT; seat++) {
    const state = createGeneratedWorld(1701, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION);
    const option = legalActions(state, seat, EPOCH).find(candidate => candidate.action.type === 'settle');
    assert.ok(option);
    paidFounding(state, { seat, expectedRevision: state.revision, timestamp: EPOCH, action: option.action });
  }
});

void test('real founding resolves occupied names independently of city-array order without renaming prior settlements', () => {
  const state = createGeneratedWorld(1701, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION);
  const option = legalActions(state, 0, EPOCH).find(candidate => candidate.action.type === 'settle');
  assert.ok(option?.action.type === 'settle');
  const input = namingInput(state, { id: `city-0-${state.revision + 1}`, civId: 0, tileId: option.action.tileId });
  const first = generatePlaceName(input);
  state.cities[1]!.name = ` ${first.toUpperCase()} `;
  const expected = generatePlaceName(input, state.cities.map(city => city.name));
  assert.notEqual(expected, first);
  assert.ok(isWorldState(state));
  const command = { seat: 0, expectedRevision: state.revision, timestamp: EPOCH, action: option.action };
  const ordinary = paidFounding(state, command);
  const reversed = { ...structuredClone(state), cities: structuredClone(state.cities).reverse() };
  const result = paidFounding(reversed, command);
  assert.equal(ordinary.state.cities.at(-1)?.name, expected);
  assert.equal(result.state.cities.at(-1)?.name, expected);
});

void test('rejected land and coastal attempts consume neither city identities nor naming or simulation randomness', () => {
  const state = createGeneratedWorld(1701, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION);
  const option = legalActions(state, 0, EPOCH).find(candidate => candidate.action.type === 'settle');
  assert.ok(option?.action.type === 'settle');
  const valid = { seat: 0, expectedRevision: state.revision, timestamp: EPOCH, action: option.action };
  const attempts: Command[] = [
    { ...valid, expectedRevision: state.revision + 1 },
    { ...valid, action: { ...option.action, tileId: state.cities[0]!.tileId } },
    { ...valid, action: { ...option.action, sourceCityId: 'missing' } },
    { ...valid, action: { type: 'settle-coast', sourceCityId: 'city-0', tileId: option.action.tileId } },
  ];
  const before = structuredClone(state);
  for (const command of attempts) {
    const result = applyCommand(state, command);
    assert.equal(result.ok, false);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.state, before);
    assert.deepEqual(state, before);
    assert.deepEqual(applyCommand(result.state, valid), applyCommand(before, valid));
  }
  paidFounding(state, valid);
});

void test('earned research and timed Boat yard enable paid coastal naming whose stored bytes survive locality ownership round and restart changes', context => {
  let state = createLocalSimulation(1701).state;
  const capital = state.cities.find(city => isCoastalSite(state, city.tileId));
  assert.ok(capital);
  const seat = capital.civId;
  const sourceId = capital.id;
  let seconds = 0;
  let actions = 0;
  const perform = (action: GameAction): void => {
    assert.ok(legalActions(state, seat, timestamp(seconds)).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify(action));
    const before = structuredClone(state);
    const command = { seat, expectedRevision: state.revision, timestamp: timestamp(seconds), action };
    const result = applyCommand(state, command);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state, before);
    assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(before)), command), result);
    state = result.state;
    seconds += 10;
    actions++;
  };
  const until = (complete: () => boolean): void => {
    for (let count = 0; count < 48 && !complete(); count++) {
      assert.ok(state.independentTurns);
      seconds = (state.independentTurns.strategyTicks + 1) * 60;
      const result = catchUpStrategy(state, timestamp(seconds));
      assert.equal(result.ok, true, result.error);
      state = result.state;
      seconds += 10;
    }
    assert.ok(complete(), 'Finite earned prefix must complete its declared commitment');
  };
  if (capital.focus !== 'research') perform({ type: 'focus', cityId: sourceId, focus: 'research' });
  for (const technology of ['agriculture', 'water-management', 'civic-institutions', 'navigation']) {
    perform({ type: 'research', technology });
    until(() => state.civilizations[seat]!.technologies.includes(technology));
    if (technology === 'agriculture') {
      perform({ type: 'build', cityId: sourceId, project: 'farm' });
      until(() => state.cities.find(city => city.id === sourceId)!.buildings.includes('farm'));
    }
  }
  perform({ type: 'build', cityId: sourceId, project: 'boat-yard' });
  assert.equal(legalActions(state, seat, timestamp(seconds)).some(option => option.action.type === 'settle-coast'), false);
  until(() => state.cities.find(city => city.id === sourceId)!.buildings.includes('boat-yard'));
  const options = legalActions(state, seat, timestamp(seconds));
  const deposits = new Set([...(state.strategicDeposits?.tileIds ?? []), ...(state.pastoralSites?.tileIds ?? []), ...(state.coalDeposits?.tileIds ?? [])]);
  const option = options.find(candidate => {
    const action = candidate.action;
    return action.type === 'settle-coast' && !deposits.has(action.tileId)
      && !options.some(land => land.action.type === 'settle' && land.action.tileId === action.tileId);
  });
  assert.ok(option?.action.type === 'settle-coast');
  const result = paidFounding(state, { seat, expectedRevision: state.revision, timestamp: timestamp(seconds), action: option.action });
  const founded = result.state.cities.at(-1)!;
  assert.ok(founded.coastalFounding && option.coastalQuote);
  assert.deepEqual(founded.coastalFounding.pathTileIds, option.coastalQuote.tileIds);
  assert.deepEqual(founded.coastalFounding.paid, ECONOMY_RULES.settle.cost);
  assert.equal(founded.coastalFounding.population, ECONOMY_RULES.settle.population);
  assert.ok(isCoastalSite(result.state, founded.tileId));
  const changed = structuredClone(result.state);
  const retained = changed.cities.at(-1)!;
  const tile = changed.tiles.find(candidate => candidate.id === retained.tileId)!;
  tile.terrain = tile.terrain === 'tundra' ? 'forest' : 'tundra';
  retained.civId = (retained.civId + 1) % CIV_COUNT;
  tile.owner = retained.civId;
  assert.ok(isWorldState(changed), 'Labeled post-founding locality/ownership mutation is a valid saved-state fixture, not a claimed conquest');
  const nextTime = timestamp((changed.independentTurns!.strategyTicks + 1) * 60);
  const later = catchUpStrategy(changed, nextTime);
  assert.equal(later.ok, true, later.error);
  assert.ok(later.state.round > result.state.round);
  assert.equal(later.state.cities.find(city => city.id === founded.id)?.name, founded.name);
  const saved = { ...createLocalSimulation(1701), state: later.state, timestamp: nextTime, steps: (Date.parse(nextTime) - Date.parse(EPOCH)) / 10_000 };
  const bytes = JSON.stringify(saved);
  const restored = parseLocalSimulation(JSON.parse(bytes));
  assert.ok(restored);
  assert.equal(JSON.stringify(restored), bytes);
  assert.equal(restored.state.cities.find(city => city.id === founded.id)?.name, founded.name);
  context.diagnostic(JSON.stringify({ seed: 1701, earnedActions: actions, earnedStrategyTicks: state.independentTurns!.strategyTicks, sourceId, destination: founded.tileId, name: founded.name, receipt: founded.coastalFounding }));
});

void test('name-only metamorphism preserves complete legal payload order action IDs and weighted strategic memory, not display digests', async () => {
  const state = createGeneratedWorld(1701, EPOCH, ACTIVE_LOCAL_RELEASE_ID, NAMING_VERSION);
  const renamed = structuredClone(state);
  renamed.cities.forEach((city, index) => { city.name = `Distinct town ${index}`; });
  const before = structuredClone(state);
  const beforeRenamed = structuredClone(renamed);
  const neutralText = (text: string, world: WorldState): string => world.cities.reduce((value, city) => value.replaceAll(city.name, `<${city.id}>`), text);
  let changedDisplay = false;
  for (let seat = 0; seat <= DIRECTOR_SEAT; seat++) {
    const options = legalActions(state, seat, EPOCH);
    const renamedOptions = legalActions(renamed, seat, EPOCH);
    const payloads = (values: typeof options) => values.map(({ label, reason, ...payload }) => payload);
    assert.deepEqual(payloads(renamedOptions), payloads(options));
    assert.deepEqual(await Promise.all(renamedOptions.map(option => choiceActionId(option.action))), await Promise.all(options.map(option => choiceActionId(option.action))));
    changedDisplay ||= options.some((option, index) => option.label !== renamedOptions[index]!.label || option.reason !== renamedOptions[index]!.reason);
    for (const decisionCount of [0, 1, 7, 31]) {
      const memory = { ...createBehaviorMemory(state, seat), decisionCount };
      const selected = chooseCivilizationBehavior(state, seat, memory, EPOCH);
      const other = chooseCivilizationBehavior(renamed, seat, structuredClone(memory), EPOCH);
      assert.deepEqual(other.action, selected.action);
      assert.deepEqual(other.memory, selected.memory);
      assert.deepEqual({ ...other.explanation, reason: neutralText(other.explanation.reason, renamed) }, { ...selected.explanation, reason: neutralText(selected.explanation.reason, state) });
    }
  }
  assert.equal(changedDisplay, true);
  const request = parseChoicePageRequest({ seat: 0, timestamp: EPOCH }, 'cli');
  const page = await createChoicePage({ initial: state, state, scope: 'naming-metamorphism' }, request);
  const other = await createChoicePage({ initial: renamed, state: renamed, scope: 'naming-metamorphism' }, request);
  const indexed = (value: typeof page) => value.legalActions.map(({ choice, actionId, action }) => ({ choice, actionId, action }));
  assert.deepEqual(indexed(other), indexed(page));
  assert.equal(other.page.total, page.page.total);
  assert.notEqual(other.page.runFingerprint, page.page.runFingerprint);
  assert.notEqual(other.page.viewDigest, page.page.viewDigest);
  assert.deepEqual(state, before);
  assert.deepEqual(renamed, beforeRenamed);
});
