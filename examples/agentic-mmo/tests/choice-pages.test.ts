import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, createWorld } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { choiceActionId, createChoicePage, parseChoicePageRequest, ChoicePageError } from '../protocol/choice-pages.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();

function world(): WorldState {
  let state = createWorld(1701, epoch, 'settlement-operating-exchange-1');
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'mountain' && tile.terrain !== 'ocean');
  for (let index = 5; index < 25; index++) {
    const template = capitals[index % 5];
    const site = sites[index - 5];
    assert.ok(template && site);
    site.owner = template.civId;
    state.cities.push({ ...structuredClone(template), id: `exchange-fixture-${index}`, name: `Exchange fixture ${index}`, tileId: site.id, population: 3 });
  }
  assert.ok(isWorldState(state));
  return state;
}

function encode(value: Record<string, unknown>): string { return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))).toString('base64url'); }

function source(state = world(), scope = 'main') { return { initial: createWorld(1701, epoch, state.releaseId), state, scope }; }
function request(choiceCursor?: string, now = epoch) { return parseChoicePageRequest({ seat: 0, ...(choiceCursor === undefined ? {} : { choiceCursor }) }, 'host', now); }
function failure(code: string, status: number, reason?: string) {
  return (value: unknown): boolean => value instanceof ChoicePageError && value.code === code && value.status === status && (reason === undefined || value.details.reason === reason);
}

await test('twenty-entry pages reconstruct every exact geographic choice with one complete context and global indexes', async () => {
  const input = source();
  const before = structuredClone(input);
  const full = observeCompactTrade(input.state, 0, epoch);
  assert.equal(full.legalActions.length, 237);
  const entries = [];
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    const page = await createChoicePage(input, request(cursor));
    assert.equal(page.observationFormat, 'compact-trade-pages-v1');
    assert.equal(page.page.offset, entries.length);
    assert.equal(page.page.total, full.legalActions.length);
    assert.equal(page.page.limit, 20);
    assert.ok(page.legalActions.length > 0 && page.legalActions.length <= 20);
    if (pageCount === 0) {
      assert.ok(page.context);
      assert.equal('legalActions' in page.context, false);
      assert.deepEqual(page.context.tradeFacts, full.tradeFacts);
      assert.deepEqual(page.context.tradeOffers, full.tradeOffers);
      assert.deepEqual(page.context.routes, full.routes);
      assert.deepEqual(page.context.actionPlan, full.actionPlan);
    } else assert.equal(page.context, undefined);
    entries.push(...page.legalActions);
    cursor = page.page.nextCursor ?? undefined;
    pageCount++;
    assert.ok(pageCount <= 12);
  } while (cursor !== undefined);
  assert.equal(pageCount, 12);
  assert.deepEqual(entries.map(({ choice, actionId, ...option }, index) => { assert.equal(choice, index); assert.match(actionId, /^[0-9a-f]{64}$/); return option; }), full.legalActions);
  assert.equal(new Set(entries.map(option => option.actionId)).size, entries.length);
  assert.deepEqual(input, before);
});

await test('continuations pin time through tactical and due-strategy boundaries at an unchanged revision', async () => {
  const input = source();
  const waited = applyCommand(input.state, { seat: 0, expectedRevision: input.state.revision, action: { type: 'wait' }, timestamp: epoch });
  assert.equal(waited.ok, true);
  input.state = waited.state;
  assert.equal(observeCompactTrade(input.state, 0, epoch).legalActions.length, 0);
  const first = await createChoicePage(input, request(undefined, at(10)));
  assert.ok(first.page.nextCursor);
  const later = await createChoicePage(input, request(first.page.nextCursor, at(60)));
  assert.equal(observeCompactTrade(input.state, 0, at(60)).legalActions.length, 0);
  assert.equal(later.page.observedAt, at(10));
  assert.equal(later.page.viewDigest, first.page.viewDigest);
  assert.equal(later.page.offset, 20);
  assert.deepEqual(later.legalActions.map(option => option.action), observeCompactTrade(input.state, 0, at(10)).legalActions.slice(20, 40).map(option => option.action));
});

await test('a zero-choice view returns one complete terminal page', async () => {
  const input = source();
  const page = await createChoicePage(input, request(undefined, at(60)));
  assert.equal(page.page.total, 0);
  assert.equal(page.page.nextCursor, null);
  assert.deepEqual(page.legalActions, []);
  assert.ok(page.context);
});

await test('CLI structural time remains null and cannot become a hosted cursor', async () => {
  const input = { ...source(), lastValid: true };
  const first = await createChoicePage(input, parseChoicePageRequest({ seat: 0 }, 'cli'));
  assert.equal(first.page.observedAt, null);
  assert.equal(first.context?.last_valid, true);
  assert.equal(first.context?.serverTimestamp, undefined);
  assert.ok(first.page.nextCursor);
  const next = await createChoicePage(input, parseChoicePageRequest({ choiceCursor: first.page.nextCursor }, 'cli'));
  assert.equal(next.page.observedAt, null);
  assert.equal(next.page.seat, 0);
  assert.throws(() => parseChoicePageRequest({ choiceCursor: first.page.nextCursor }, 'host', epoch), failure('invalid_choice_cursor', 400));
});

await test('current revision and run mismatch refuse without replacement pages', async () => {
  const input = source();
  const first = await createChoicePage(input, request());
  assert.ok(first.page.nextCursor);
  const nextRequest = request(first.page.nextCursor);
  await assert.rejects(createChoicePage({ ...input, scope: 'another-run' }, nextRequest), failure('stale_choice_cursor', 409, 'run_changed'));
  const changed = structuredClone(input);
  changed.state.revision++;
  await assert.rejects(createChoicePage(changed, nextRequest), failure('stale_choice_cursor', 409, 'revision_changed'));
  const otherInitial = structuredClone(input);
  otherInitial.initial.seed++;
  await assert.rejects(createChoicePage(otherInitial, nextRequest), failure('stale_choice_cursor', 409, 'run_changed'));
});

await test('same-revision world and catalogue changes invalidate the complete projected digest', async () => {
  const input = source();
  const first = await createChoicePage(input, request());
  assert.ok(first.page.nextCursor);
  const nextRequest = request(first.page.nextCursor);
  const changed = structuredClone(input);
  const city = changed.state.cities[0];
  assert.ok(city);
  city.name = 'Changed city';
  await assert.rejects(createChoicePage(changed, nextRequest), failure('stale_choice_cursor', 409, 'projection_changed'));
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'energy-for-materials');
  assert.ok(recipe);
  const previous = recipe.description;
  try {
    recipe.description = 'Changed current proposal description';
    await assert.rejects(createChoicePage(input, nextRequest), failure('stale_choice_cursor', 409, 'projection_changed'));
  } finally { recipe.description = previous; }
});

await test('action identities are canonical and distinguish every exact action field', async () => {
  const action: GameAction = { type: 'propose-trade', partner: 1, recipeId: 'energy-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' };
  const reordered: GameAction = { recipientCityId: 'city-1', sourceCityId: 'city-0', recipeId: 'energy-for-materials', partner: 1, type: 'propose-trade' };
  assert.equal(await choiceActionId(action), await choiceActionId(reordered));
  assert.notEqual(await choiceActionId(action), await choiceActionId({ ...action, sourceCityId: 'other-city' }));
  assert.notEqual(await choiceActionId(action), await choiceActionId({ ...action, recipientCityId: 'other-city' }));
  assert.notEqual(await choiceActionId({ type: 'respond-trade', offerId: 'offer-1', accept: true }), await choiceActionId({ type: 'respond-trade', offerId: 'offer-1', accept: false }));
});

await test('page results are detached from state, other pages and canonical catalogue facts', async () => {
  const input = source();
  const before = structuredClone(input);
  const first = await createChoicePage(input, request());
  assert.ok(first.context);
  const town = first.context.tradeFacts.cities[0];
  assert.ok(town);
  town.name = 'Mutated response';
  const choice = first.legalActions[0];
  assert.ok(choice);
  choice.label = 'Mutated label';
  assert.deepEqual(input, before);
  const second = await createChoicePage(input, request());
  assert.notEqual(second.context?.tradeFacts.cities[0]?.name, 'Mutated response');
  assert.notEqual(second.legalActions[0]?.label, 'Mutated label');
});

await test('malformed, conflicting and oversized cursor inputs fail synchronously before a source is available', async () => {
  const first = await createChoicePage(source(), request());
  assert.ok(first.page.nextCursor);
  for (const choiceCursor of [null, 1, [], {}, '', '!', 'a'.repeat(2049), `${first.page.nextCursor}=`, Buffer.from('{}').toString('base64url'), Buffer.from([0xff]).toString('base64url')]) {
    assert.throws(() => parseChoicePageRequest({ choiceCursor }, 'host', epoch), failure('invalid_choice_cursor', 400));
  }
  assert.throws(() => parseChoicePageRequest({ choiceCursor: first.page.nextCursor, seat: 1 }, 'host', epoch), failure('invalid_choice_cursor', 400));
  assert.throws(() => parseChoicePageRequest({ choiceCursor: first.page.nextCursor, timestamp: epoch }, 'cli'), failure('invalid_choice_cursor', 400));
  assert.throws(() => parseChoicePageRequest({ timestamp: epoch }, 'host', epoch), failure('invalid_choice_cursor', 400));
  assert.throws(() => parseChoicePageRequest({ seat: 6 }, 'host', epoch), failure('invalid_seat', 400));
  assert.throws(() => parseChoicePageRequest({ timestamp: '2026-02-30T00:00:00.000Z' }, 'cli'), failure('invalid_utc_timestamp', 400));
  assert.throws(() => parseChoicePageRequest({ choiceCursor: first.page.nextCursor }, 'host', '2026-10-15T23:59:59.000Z'), failure('invalid_choice_cursor', 400));
});

await test('cursor exact shape, canonical encoding and bounded offsets are enforced', async () => {
  const input = source();
  const first = await createChoicePage(input, request());
  assert.ok(first.page.nextCursor);
  const text = Buffer.from(first.page.nextCursor, 'base64url').toString('utf8');
  const decoded: unknown = JSON.parse(text);
  assert.ok(typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded));
  const fields = Object.fromEntries(Object.entries(decoded));
  for (const patch of [{ v: 2 }, { extra: true }, { limit: 21 }, { seat: -1 }, { revision: 1.5 }, { next: 0 }, { next: 21 }, { next: Number.MAX_SAFE_INTEGER + 1 }, { run: 'x' }, { digest: 'F'.repeat(64) }, { time: 'yesterday' }]) {
    assert.throws(() => parseChoicePageRequest({ choiceCursor: encode({ ...fields, ...patch }) }, 'host', epoch), failure('invalid_choice_cursor', 400));
  }
  assert.throws(() => parseChoicePageRequest({ choiceCursor: Buffer.from(`${text} `).toString('base64url') }, 'host', epoch), failure('invalid_choice_cursor', 400));
  const outOfRange = request(encode({ ...fields, next: 240 }));
  await assert.rejects(createChoicePage(input, outOfRange), failure('invalid_choice_cursor', 400));
});

await test('page context preserves bounded plans and immutable pending or accepted consent after current recipe changes', async () => {
  const input = source(world());
  const action: GameAction = { type: 'propose-trade', partner: 4, recipeId: 'energy-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' };
  const proposed = applyCommand(input.state, { seat: 1, action, plan: [{ action, reason: 'Offer operating energy for materials' }, { action: { type: 'wait' }, reason: 'Review the recipient response before choosing another command' }], expectedRevision: input.state.revision, timestamp: epoch });
  assert.equal(proposed.ok, true, proposed.error);
  input.state = proposed.state;
  const offer = input.state.tradeOffers?.find(candidate => candidate.status === 'pending');
  assert.ok(offer);
  const terms = structuredClone(offer.terms);
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'energy-for-materials');
  assert.ok(recipe);
  const original = structuredClone(recipe.terms);
  try {
    recipe.terms.proposerCargo.energy = 400;
    const observed = observeCompactTrade(input.state, 1, at(10));
    const pending = await createChoicePage(input, parseChoicePageRequest({ seat: 1 }, 'host', at(10)));
    assert.deepEqual(pending.context?.tradeOffers, observed.tradeOffers);
    assert.deepEqual(pending.context?.tradeOffers?.find(candidate => candidate.id === offer.id)?.terms, terms);
    assert.deepEqual(pending.context?.actionPlan, observed.actionPlan);
    const accepted = applyCommand(input.state, { seat: 4, action: { type: 'respond-trade', offerId: offer.id, accept: true }, expectedRevision: input.state.revision, timestamp: at(10) });
    assert.equal(accepted.ok, true, accepted.error);
    input.state = accepted.state;
    const page = await createChoicePage(input, parseChoicePageRequest({ seat: 1 }, 'host', at(10)));
    assert.deepEqual(page.context?.routes.find(route => route.agreement?.offerId === offer.id)?.agreement?.terms, terms);
    assert.deepEqual(page.context?.actionPlan, observeCompactTrade(input.state, 1, at(10)).actionPlan);
  } finally { recipe.terms = original; }
});

await test('unsupported page controls are rejected rather than silently ignored', () => {
  assert.throws(() => parseChoicePageRequest({ seat: 0, choiceLimit: 100 }, 'host', epoch), failure('invalid_choice_cursor', 400));
});
