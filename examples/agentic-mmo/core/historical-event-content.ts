import type { DirectorEventDefinition } from './types.ts';

export type HistoricalEventId = 'cultivated-harvest' | 'forest-fire' | 'coastal-storm' | 'trade-fair' | 'industrial-accident' | 'internal-migration';

export const HISTORICAL_EVENT_RULES = {
  harvestCost: { materials: 3 },
  fairCost: { food: 4, materials: 2 },
  migrationCost: { food: 4, credits: 2 },
  migrants: 2,
  migrationSourceDamage: 30,
  migrationSourceWellbeing: 35,
  migrationDestinationDamage: 10,
  migrationDestinationWellbeing: 55,
  stormRouteDamage: 20,
  industries: ['guild-workshop', 'foundry', 'factory', 'coal-plant'],
} as const;

export const HISTORICAL_DIRECTOR_EVENTS: DirectorEventDefinition[] = [
  {
    id: 'cultivated-harvest', name: 'The sheaves come home', requiredFeatures: ['director-events', 'historical-pressures', 'settlement-production'], minEra: 0,
    description: 'A completed farm in an inhabited grassland town has an opportunity to gather an extra harvest.',
    consequence: 'Three shared Materials fund collection and storage of eight Food; uncultivated land offers no harvest.',
    effects: [{ kind: 'resource', resource: 'materials', amount: -3 }, { kind: 'resource', resource: 'food', amount: 8 }], cooldown: 3,
  },
  {
    id: 'forest-fire', name: 'Embers at the treeline', requiredFeatures: ['director-events', 'historical-pressures', 'city-repair'], minEra: 0,
    description: 'Fire reaches one inhabited town beside an actual forest.',
    consequence: 'The affected town gains up to twenty-two repairable Damage and loses up to six Wellbeing; up to five shared Materials are lost. People, buildings and standing forest remain recorded.',
    effects: [{ kind: 'city', field: 'damage', amount: 22 }, { kind: 'city', field: 'wellbeing', amount: -6 }, { kind: 'resource', resource: 'materials', amount: -5 }], cooldown: 4,
  },
  {
    id: 'coastal-storm', name: 'The shore takes the gale', requiredFeatures: ['director-events', 'historical-pressures', 'city-repair'], minEra: 0,
    description: 'A storm strikes one inhabited town beside the ocean.',
    consequence: 'That town gains up to eighteen Damage and loses up to four Wellbeing. At most one active agreed route at its exact endpoint gains twenty Damage; unrelated routes remain unchanged.',
    effects: [{ kind: 'city', field: 'damage', amount: 18 }, { kind: 'city', field: 'wellbeing', amount: -4 }], cooldown: 4,
  },
  {
    id: 'trade-fair', name: 'Lanterns at the exchange', requiredFeatures: ['director-events', 'historical-pressures', 'trade-routes'], minEra: 0,
    description: 'An inhabited trade endpoint hosts a fair after a recent actual delivery on its still-working agreement.',
    consequence: 'Four Food and two Materials from the host civilization fund six Credits and four Culture. No shipment, route volume or partner stock is invented.',
    effects: [{ kind: 'resource', resource: 'food', amount: -4 }, { kind: 'resource', resource: 'materials', amount: -2 }, { kind: 'resource', resource: 'credits', amount: 6 }, { kind: 'resource', resource: 'culture', amount: 4 }], cooldown: 3,
  },
  {
    id: 'industrial-accident', name: 'The working floor falls silent', requiredFeatures: ['director-events', 'historical-pressures', 'building-operations', 'city-repair'], minEra: 1,
    description: 'An accident disrupts one enabled industrial building that actually operated in the current strategic round.',
    consequence: 'Its town gains up to twenty repairable Damage and loses up to five Wellbeing; up to four shared Materials are lost. Idle buildings and past production are not evidence of an accident.',
    effects: [{ kind: 'city', field: 'damage', amount: 20 }, { kind: 'city', field: 'wellbeing', amount: -5 }, { kind: 'resource', resource: 'materials', amount: -4 }], cooldown: 4,
  },
  {
    id: 'internal-migration', name: 'A road to safer hearths', requiredFeatures: ['director-events', 'historical-pressures', 'local-growth'], minEra: 0,
    description: 'Two existing residents leave a damaged or low-wellbeing town for a safe town in the same civilization with two free housing places.',
    consequence: 'Four Food and two Credits fund the move. The source retains at least one resident, the destination stays within its canonical capacity, and total Earth population is conserved.',
    effects: [{ kind: 'resource', resource: 'food', amount: -4 }, { kind: 'resource', resource: 'credits', amount: -2 }], cooldown: 3,
  },
];
