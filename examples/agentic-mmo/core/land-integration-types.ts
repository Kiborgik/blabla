import type { Resources, ResolvedTradeDelivery } from './types.ts';

export interface LandFoundingReceipt {
  ruleVersion: 1;
  mode: 'ordinary';
  civId: number;
  sourceCityId: string;
  foundedCityId: string;
  sourceTileId: number;
  destinationTileId: number;
  population: number;
  sourcePopulationBefore: number;
  sourcePopulationAfter: number;
  paid: Partial<Resources>;
  round: number;
  revision: number;
  eventId: string;
}

export interface LandIntegrationWitness {
  ruleVersion: 1;
  kind: 'land';
  founding: LandFoundingReceipt;
  delivery: ResolvedTradeDelivery;
}

export type ConnectionWitness = { kind: 'coastal' } | LandIntegrationWitness;
