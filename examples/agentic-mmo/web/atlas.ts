import type { RouteResultCue } from '../visuals/route-cues.ts';
import type { VisualEvent } from '../visuals/world-visuals.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import type { SettlementFacts } from '../visuals/world-visuals.ts';

export type AtlasCue = VisualEvent | RouteResultCue;

export interface AtlasCivilization {
  id: number;
  name: string;
  shortName: string;
  capital: string;
  color: string;
  symbol: string;
  character: string;
  ambition: string;
  q: number;
  r: number;
  cityId?: string;
  population?: number;
  buildings?: string[];
  settlement?: SettlementFacts;
}

export interface AtlasTile {
  id?: number;
  q: number;
  r: number;
  owner: number | null;
  terrain: 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra';
  height: number;
}

export interface AtlasWorld {
  tiles: AtlasTile[];
  cities: AtlasCivilization[];
  routes: RouteView[];
  illustrative?: boolean;
}

export const TERRAIN_COLORS = {
  grassland: '#8c9b6e', forest: '#637f5c', desert: '#c5ad7a',
  mountain: '#8f9785', tundra: '#bbc4b4',
};

export const CIVILIZATIONS: readonly AtlasCivilization[] = [
  {
    id: 0,
    name: 'Aurelian League',
    shortName: 'Aurelian',
    capital: 'Aurelia',
    color: '#e7bf69',
    symbol: '✺',
    character: 'The builders',
    ambition: 'A shared future, built to endure.',
    q: -5,
    r: 0,
  },
  {
    id: 1,
    name: 'Verdant Union',
    shortName: 'Verdant',
    capital: 'Sylva',
    color: '#9ebc8a',
    symbol: '❋',
    character: 'The stewards',
    ambition: 'Prosperity in balance with the living world.',
    q: 0,
    r: -4,
  },
  {
    id: 2,
    name: 'Cobalt Assembly',
    shortName: 'Cobalt',
    capital: 'Kova',
    color: '#81b8d2',
    symbol: '◈',
    character: 'The discoverers',
    ambition: 'Beyond the horizon lies the next question.',
    q: 5,
    r: -1,
  },
  {
    id: 3,
    name: 'Saffron Compact',
    shortName: 'Saffron',
    capital: 'Sora',
    color: '#e7a376',
    symbol: '✧',
    character: 'The connectors',
    ambition: 'No civilization flourishes alone.',
    q: 2,
    r: 4,
  },
  {
    id: 4,
    name: 'Roseline Republic',
    shortName: 'Roseline',
    capital: 'Roselle',
    color: '#cda0b0',
    symbol: '✥',
    character: 'The storytellers',
    ambition: 'What we create is what we leave behind.',
    q: -5,
    r: 5,
  },
];

export function hexPosition(q: number, r: number): { x: number; z: number } {
  return { x: Math.sqrt(3) * (q + r / 2), z: 1.5 * r };
}

function terrainNoise(q: number, r: number): number {
  return Math.abs(Math.sin(q * 127.1 + r * 311.7) * 43758.5453) % 1;
}

function sampleTown(city: AtlasCivilization) {
  return { id: `sample:${city.id}`, name: city.capital, civilization: city.name, color: city.color, q: city.q, r: city.r };
}

export function createPreviewWorld(): AtlasWorld {
  const tiles: AtlasTile[] = [];
  for (let r = -7; r <= 7; r += 1) {
    for (let q = -11; q <= 11; q += 1) {
      const { x, z } = hexPosition(q, r);
      const angle = Math.atan2(z, x);
      const shore = 1 + Math.sin(angle * 5) * 0.13 + Math.cos(angle * 3) * 0.09;
      if ((x / 15.8) ** 2 + (z / 11.2) ** 2 > shore) continue;
      const noise = terrainNoise(q, r);
      const mountain =
        Math.abs(x * 0.32 + z * 0.55 + Math.sin(z * 0.6) * 1.7) < 1.15 && noise > 0.24;
      const terrain = mountain
        ? 'mountain'
        : z > 1 && x > 0 && noise > 0.3
          ? 'desert'
          : noise > 0.58
            ? 'forest'
            : 'grassland';
      const nearest = CIVILIZATIONS.reduce<AtlasCivilization | undefined>((closest, candidate) => {
        const point = hexPosition(candidate.q, candidate.r);
        if (!closest) return candidate;
        const previous = hexPosition(closest.q, closest.r);
        return Math.hypot(x - point.x, z - point.z) < Math.hypot(x - previous.x, z - previous.z)
          ? candidate
          : closest;
      }, undefined);
      tiles.push({ q, r, owner: nearest?.id ?? 0, terrain, height: 0.25 + noise * 0.22 });
    }
  }
  for (const city of CIVILIZATIONS) {
    const tile = tiles.find((entry) => entry.q === city.q && entry.r === city.r);
    if (tile) tile.terrain = 'grassland';
  }
  return {
    illustrative: true,
    tiles,
    cities: [...CIVILIZATIONS],
    routes: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [0, 3],
    ].map(([from, to], index) => {
      const origin = CIVILIZATIONS[from ?? 0];
      const destination = CIVILIZATIONS[to ?? 0];
      if (!origin || !destination) throw new Error('Sample route endpoint missing');
      return { id: `sample-route:${index}`, from: `sample:${origin.id}`, to: `sample:${destination.id}`, owner: origin.id, partner: destination.id,
        active: false, damage: 0, volume: 0, ownerName: origin.name, partnerName: destination.name, illustrative: true, fromTown: sampleTown(origin), toTown: sampleTown(destination) };
    }),
  };
}
