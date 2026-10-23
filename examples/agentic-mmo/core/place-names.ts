import { CIV_COUNT, type Terrain } from './types.ts';

export const PLACE_NAMING_VERSION = 1;

export interface PlaceNameLocality {
  readonly terrain: Exclude<Terrain, 'ocean' | 'mountain'>;
  readonly coastal: boolean;
}

export interface PlaceNameInput {
  readonly worldSeed: number;
  readonly civId: number;
  readonly cityId: string;
  readonly locality: PlaceNameLocality;
}

const INLAND_TERRAINS = ['grassland', 'forest', 'desert', 'tundra'] as const;

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function ranked(values: readonly string[], domain: string): string[] {
  return values.map(value => ({ value, rank: hash(`${domain}/${value}`) }))
    .sort((left, right) => left.rank - right.rank || (left.value < right.value ? -1 : left.value > right.value ? 1 : 0))
    .map(entry => entry.value);
}

function cultureProfile(domain: string) {
  const resonants = ranked(['l', 'm', 'n', 'r'], `${domain}/resonants`).slice(0, 2);
  const obstruents = ranked(['b', 'd', 'f', 'g', 'k', 'p', 's', 't', 'v'], `${domain}/obstruents`).slice(0, 3);
  if (hash(`${domain}/cluster`) % 3 === 0) obstruents[2] = ranked(['kh', 'th', 'st'], `${domain}/cluster-kind`)[0]!;
  const vowels = ranked(['a', 'e', 'i', 'o', 'u'], `${domain}/vowels`).slice(0, 3);
  const syllables = [...resonants, ...obstruents].flatMap(onset => vowels.map(vowel => `${onset}${vowel}`));
  const morphemes = ranked(syllables, `${domain}/locality`).slice(0, 5);
  const coda = ranked(['', 'n', 'r', 'l', 's'], `${domain}/coda`)[0]!;
  const cadence = ranked(['compact', 'medial', 'flowing', 'vowel'], `${domain}/cadence`)[0]!;
  const medialCodas = ranked(['l', 'n', 'r'], `${domain}/medial-codas`);
  return { vowels, syllables, morphemes, coda, cadence, medialCodas };
}

function admittedIdentity(input: PlaceNameInput): { revision: number | undefined } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Place-name input requires an immutable identity and locality');
  if (!Number.isInteger(input.worldSeed) || input.worldSeed < 0 || input.worldSeed > 0xffffffff) throw new RangeError('Place-name world seed must be an explicit uint32');
  if (!Number.isInteger(input.civId) || input.civId < 0 || input.civId >= CIV_COUNT) throw new RangeError('Place-name civilization must be a supported seat');
  if (typeof input.cityId !== 'string') throw new RangeError('Place-name city identity must use the canonical city ID grammar');
  const match = /^city-([0-4])(?:-(0|[1-9][0-9]{0,15}))?$/.exec(input.cityId);
  if (!match || match[0] !== input.cityId || Number(match[1]) !== input.civId) throw new RangeError('Place-name city identity must match its civilization and canonical city ID grammar');
  const revision = match[2] === undefined ? undefined : Number(match[2]);
  if (revision !== undefined && !Number.isSafeInteger(revision)) throw new RangeError('Place-name city identity requires a safe founding revision');
  if (!input.locality || typeof input.locality !== 'object' || Array.isArray(input.locality)
    || !INLAND_TERRAINS.includes(input.locality.terrain) || typeof input.locality.coastal !== 'boolean') {
    throw new RangeError('Place-name locality requires an inhabitable terrain and an explicit coastal fact');
  }
  return { revision };
}

function settlementCandidates(input: PlaceNameInput): string[] {
  const cultureDomain = `place-names-v${PLACE_NAMING_VERSION}/${input.worldSeed}/${input.civId}`;
  const culture = cultureProfile(cultureDomain);
  const category = input.locality.coastal ? 4 : INLAND_TERRAINS.indexOf(input.locality.terrain);
  const morpheme = culture.morphemes[category]!;
  const localityOnset = morpheme.slice(0, -1);
  const rootDomain = `${cultureDomain}/city/${input.cityId}/${input.locality.terrain}/${input.locality.coastal ? 'shore' : 'inland'}`;
  const availableShapes = ['flowing', ...(culture.coda ? ['compact'] : []), ...(localityOnset.length === 1 ? ['medial', ...(culture.coda ? ['vowel'] : [])] : [])];
  const shape = hash(`${rootDomain}/cadence`) % 4 !== 0 && availableShapes.includes(culture.cadence)
    ? culture.cadence : ranked(availableShapes, `${rootDomain}/cadence`)[0]!;
  const medialCodas = culture.medialCodas.filter(coda => coda !== localityOnset);
  const rootSyllables = culture.syllables.filter(syllable => syllable.slice(0, -1) !== localityOnset);
  const firstSyllables = ranked(shape === 'vowel'
    ? culture.vowels.flatMap(vowel => medialCodas.map(coda => `${vowel}${coda}`))
    : rootSyllables, `${rootDomain}/first`);
  return firstSyllables.slice(0, 4).map((first, candidate) => {
    let root = first;
    if (shape === 'flowing') root += ranked(rootSyllables.filter(syllable => syllable.slice(0, -1) !== first.slice(0, -1)), `${rootDomain}/candidate/${candidate}/second`)[0]!;
    if (shape === 'medial') root += medialCodas[hash(`${rootDomain}/candidate/${candidate}/medial`) % medialCodas.length]!;
    const name = `${root}${morpheme}${culture.coda}`;
    return `${name[0]!.toUpperCase()}${name.slice(1)}`;
  });
}

export function generatePlaceName(input: PlaceNameInput, occupiedNames: readonly string[] = []): string {
  const identity = admittedIdentity(input);
  if (!Array.isArray(occupiedNames)) throw new RangeError('Occupied place names must be an array of strings');
  for (const name of occupiedNames) if (typeof name !== 'string') throw new RangeError('Occupied place names must be an array of strings');
  const occupied = new Set(occupiedNames.map(name => name.trim().toLowerCase()));
  const candidates = settlementCandidates(input);
  for (const candidate of candidates) if (!occupied.has(candidate.toLowerCase())) return candidate;
  const discriminator = `C${input.civId}${identity.revision === undefined ? '' : `R${identity.revision.toString(36)}`}`;
  const fallback = `${candidates[0]} ${discriminator}`;
  if (occupied.has(fallback.toLowerCase())) throw new RangeError('Place-name collision fallback is already occupied; existing names must remain unchanged');
  return fallback;
}
