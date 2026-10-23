import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePlaceName, PLACE_NAMING_VERSION, type PlaceNameInput, type PlaceNameLocality } from '../core/place-names.ts';
import { CIV_COUNT } from '../core/types.ts';

const seeds = [0, 1, 73, 1701, 90210, 0x7fffffff, 0x80000000, 0xffffffff];
const terrains = ['grassland', 'forest', 'desert', 'tundra'] as const;
const localities: PlaceNameLocality[] = terrains.flatMap(terrain => [false, true].map(coastal => ({ terrain, coastal })));

function input(worldSeed = 1701, civId = 0, cityId = `city-${civId}`, locality: PlaceNameLocality = { terrain: 'grassland', coastal: false }): PlaceNameInput {
  return { worldSeed, civId, cityId, locality };
}

function collisionNames(request: PlaceNameInput): string[] {
  const occupied: string[] = [];
  for (let index = 0; index < 4; index++) occupied.push(generatePlaceName(request, occupied));
  return occupied;
}

function commonSuffix(names: readonly string[]): string {
  let suffix = names[0]!;
  for (const name of names.slice(1)) while (!name.endsWith(suffix)) suffix = suffix.slice(1);
  return suffix;
}

void test('version one gives reproducible bounded two- or three-syllable names across finite seeds, identities and actual locality categories', context => {
  assert.equal(PLACE_NAMING_VERSION, 1);
  const syllableCounts = new Set<number>();
  const initialShapes = new Set<string>();
  for (const seed of seeds) for (let civId = 0; civId < CIV_COUNT; civId++) {
    const ids = [`city-${civId}`, ...[0, 1, 17, 901, Number.MAX_SAFE_INTEGER].map(revision => `city-${civId}-${revision}`)];
    for (const cityId of ids) for (const locality of localities) {
      const request = Object.freeze({ ...input(seed, civId, cityId, Object.freeze({ ...locality })) });
      const before = JSON.stringify(request);
      const name = generatePlaceName(request);
      assert.equal(generatePlaceName(JSON.parse(before) as PlaceNameInput), name);
      assert.equal(JSON.stringify(request), before);
      assert.match(name, /^[A-Z][a-z]{4,9}$/);
      assert.doesNotMatch(name.toLowerCase(), /[bcdfghjklmnpqrstvwxyz]{3}|[aeiou]{2}/);
      assert.doesNotMatch(name.toLowerCase(), /shit/);
      const syllables = [...name.toLowerCase().matchAll(/([bcdfghjklmnpqrstvwxyz]*)([aeiou])/g)];
      assert.ok(syllables.length === 2 || syllables.length === 3);
      const onsets = syllables.map(match => /(?:kh|th|st)$/.exec(match[1]!)?.[0] ?? match[1]!.slice(-1)).filter(Boolean);
      assert.equal(new Set(onsets).size, onsets.length, 'Distinct syllable onsets avoid the rejected repeated CV rhythm');
      syllableCounts.add(syllables.length);
      initialShapes.add(/^[AEIOU]/.test(name) ? 'vowel' : /^(Kh|Th|St)/.test(name) ? 'cluster' : 'single');
    }
  }
  assert.deepEqual([...syllableCounts].sort(), [2, 3]);
  assert.deepEqual([...initialShapes].sort(), ['cluster', 'single', 'vowel']);
  for (const seed of [0, 1701, 90210]) {
    const capitals = Array.from({ length: CIV_COUNT }, (_, civId) => `${civId}: ${generatePlaceName(input(seed, civId))}`);
    context.diagnostic(`Capital-ID pronunciation sample, fixed inland grassland, not generated-world integration, seed ${seed}: ${capitals.join('; ')}`);
  }
  for (let civId = 0; civId < CIV_COUNT; civId++) {
    const sample = terrains.map(terrain => `${terrain}: ${generatePlaceName(input(1701, civId, `city-${civId}-17`, { terrain, coastal: false }))}`);
    sample.push(`shore: ${generatePlaceName(input(1701, civId, `city-${civId}-17`, { terrain: 'grassland', coastal: true }))}`);
    context.diagnostic(`Human pronunciation review only, seed 1701 civilization ${civId}: ${sample.join('; ')}`);
  }
  const longestIdentity = input(1701, 4, `city-4-${Number.MAX_SAFE_INTEGER}`);
  context.diagnostic(`Exceptional supported-ID fallback: ${generatePlaceName(longestIdentity, collisionNames(longestIdentity))}`);
});

void test('each culture shares coherent terrain morphemes and a shore morpheme across different city identities', () => {
  const cultureSignatures: Array<{ seed: number; civId: number; signature: string }> = [];
  for (const seed of [1, 1701, 90210]) for (let civId = 0; civId < CIV_COUNT; civId++) {
    const suffixes = localities.map(locality => {
      const names = Array.from({ length: 64 }, (_, index) => generatePlaceName(input(seed, civId, `city-${civId}-${index}`, locality)));
      const suffix = commonSuffix(names);
      assert.ok(suffix.length >= 2 && suffix.length <= 4, `shared bounded morpheme for ${seed}/${civId}/${JSON.stringify(locality)}`);
      assert.ok(new Set(names).size > 1, 'City identity supplies different roots within a culture, not a repeated authored full name');
      return suffix;
    });
    const inland = suffixes.filter((_, index) => index % 2 === 0);
    const shores = suffixes.filter((_, index) => index % 2 === 1);
    assert.equal(new Set([...inland, shores[0]!]).size, 5);
    assert.equal(new Set(shores).size, 1);
    cultureSignatures.push({ seed, civId, signature: suffixes.join('/') });
  }
  for (const seed of [1, 1701, 90210]) assert.ok(new Set(cultureSignatures.filter(entry => entry.seed === seed).map(entry => entry.signature)).size > 1, 'Civilization changes the sound family within a world');
  for (let civId = 0; civId < CIV_COUNT; civId++) assert.ok(new Set(cultureSignatures.filter(entry => entry.civId === civId).map(entry => entry.signature)).size > 1, 'World seed changes the sound family of the same civilization');
});

void test('coastal terrain still informs the root without claiming rivers, bays, mountains or buildings', () => {
  for (let civId = 0; civId < CIV_COUNT; civId++) {
    const names = terrains.map(terrain => generatePlaceName(input(1701, civId, `city-${civId}-17`, { terrain, coastal: true })));
    assert.ok(new Set(names).size > 1);
    assert.ok(commonSuffix(names).length >= 2);
  }
});

void test('identity candidates are independent of call order, reload and unrelated mutable simulation or rendering fields', () => {
  const requests = Array.from({ length: 40 }, (_, index) => input(90210, index % CIV_COUNT, `city-${index % CIV_COUNT}-${index}`, localities[index % localities.length]!));
  const expected = new Map(requests.map(request => [request.cityId, generatePlaceName(request)]));
  for (const request of requests.toReversed()) assert.equal(generatePlaceName(request), expected.get(request.cityId));
  for (const request of requests) {
    const snapshot = { ...request, rng: 123, round: 99, revision: 842, clockTicks: 17, lod: 'far', cityName: 'Legacy town' };
    const before = structuredClone(snapshot);
    assert.equal(generatePlaceName(Object.freeze(snapshot)), expected.get(request.cityId));
    assert.deepEqual(snapshot, before);
    const changed = { ...snapshot, rng: 999, round: 100, revision: 843, clockTicks: 18, lod: 'close', cityName: 'Unrelated display text' };
    assert.equal(generatePlaceName(changed), expected.get(request.cityId));
  }
});

void test('four cultural collision alternatives precede a bounded injective canonical-ID fallback and then explicit refusal', () => {
  const fallbacks: string[] = [];
  for (let civId = 0; civId < CIV_COUNT; civId++) for (const revision of [undefined, 0, 17, Number.MAX_SAFE_INTEGER]) {
    const cityId = revision === undefined ? `city-${civId}` : `city-${civId}-${revision}`;
    const request = input(1701, civId, cityId, { terrain: 'forest', coastal: true });
    const candidates = collisionNames(request);
    assert.equal(new Set(candidates).size, 4);
    for (const name of candidates) assert.match(name, /^[A-Z][a-z]{4,9}$/);
    const occupied = Object.freeze(candidates.map(name => ` ${name.toUpperCase()} `));
    const before = JSON.stringify(occupied);
    const fallback = generatePlaceName(request, occupied);
    const discriminator = `C${civId}${revision === undefined ? '' : `R${revision.toString(36)}`}`;
    assert.equal(fallback, `${candidates[0]} ${discriminator}`);
    assert.ok(fallback.length <= 25);
    assert.match(fallback, /^[A-Z][a-z]{4,9} C[0-4](?:R[0-9a-z]{1,11})?$/);
    assert.equal(generatePlaceName(request, [...occupied].reverse()), fallback);
    assert.equal(JSON.stringify(occupied), before);
    assert.throws(() => generatePlaceName(request, [...occupied, fallback.toLowerCase()]), /occupied|collision/i);
    fallbacks.push(fallback);
  }
  assert.equal(new Set(fallbacks).size, fallbacks.length);
});

void test('allocation preserves existing names and is occupied-set-order independent, not birth-order independent', () => {
  const request = input();
  const first = generatePlaceName(request);
  const existing = ['Dawnwell', ` ${first.toUpperCase()} `, 'Willowmere'];
  const before = structuredClone(existing);
  const alternate = generatePlaceName(request, existing);
  assert.notEqual(alternate, first);
  assert.equal(generatePlaceName(request, existing.toReversed()), alternate);
  assert.equal(generatePlaceName(request, [...existing, ...existing]), alternate);
  assert.equal(generatePlaceName(request, [first, alternate]), collisionNames(request)[2]);
  assert.deepEqual(existing, before);
  assert.equal(generatePlaceName(request), first);
});

void test('unsupported or mismatched city identities are refused without normalization or a speculative encoding', () => {
  const unsupported = ['', 'city', 'city-5', 'city--1', 'city-00', 'city-0-00', 'city-0-01', 'city-0--1', 'city-0-1.0', 'city-0-1e2', 'city-0-9007199254740992', 'city-0-10000000000000000', 'city-0-0-extra', 'city-1', ' city-0', 'city-0 ', 'city-0\n', 'CITY-0', 'colony-0'];
  for (const cityId of unsupported) assert.throws(() => generatePlaceName(input(1701, 0, cityId)), /city|identity/i, cityId);
  for (const cityId of [null, 0, {}, []]) assert.throws(() => generatePlaceName({ ...input(), cityId } as unknown as PlaceNameInput), /city|identity/i);
});

void test('unsupported seeds, civilization seats, locality and occupied-name inputs are explicitly refused', () => {
  for (const request of [null, undefined, 'name', []]) assert.throws(() => generatePlaceName(request as unknown as PlaceNameInput), /input|identity/i);
  for (const worldSeed of [-1, 1.5, 0x100000000, Number.MAX_SAFE_INTEGER, NaN, Infinity, '1701', null]) {
    assert.throws(() => generatePlaceName({ ...input(), worldSeed } as unknown as PlaceNameInput), /seed/i);
  }
  for (const civId of [-1, CIV_COUNT, 0.5, NaN, '0', null]) {
    assert.throws(() => generatePlaceName({ ...input(), civId } as unknown as PlaceNameInput), /civilization/i);
  }
  for (const locality of [null, {}, { terrain: 'ocean', coastal: true }, { terrain: 'mountain', coastal: false }, { terrain: 'ice', coastal: false }, { terrain: 'forest' }, { terrain: 'forest', coastal: 'false' }]) {
    assert.throws(() => generatePlaceName({ ...input(), locality } as unknown as PlaceNameInput), /locality|terrain|coastal/i);
  }
  for (const occupied of [null, {}, [null], [17], Array(1)]) assert.throws(() => generatePlaceName(input(), occupied as unknown as readonly string[]), /occupied/i);
});

void test('generation needs neither ambient randomness, clock reads nor network access', context => {
  const refuse = () => { throw new Error('Ambient service is forbidden for pure place names'); };
  context.mock.method(Math, 'random', refuse);
  context.mock.method(Date, 'now', refuse);
  context.mock.method(globalThis, 'fetch', refuse);
  const request = Object.freeze(input(73, 4, 'city-4-901', Object.freeze({ terrain: 'tundra', coastal: false })));
  const names = collisionNames(request);
  assert.match(generatePlaceName(request, Object.freeze(names)), / C4Rp1$/);
});
