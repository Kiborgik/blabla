import { applyRelease, createWorld, legalActions } from './engine.ts';
import { generateGeography, GENERATED_GEOGRAPHY_VERSION } from './generated-geography.ts';
import { RELEASES } from './release.ts';
import { COAL_RULES, METAL_RULES, PASTORAL_RULES } from './content.ts';
import { CIV_COUNT, type WorldState } from './types.ts';
import { isWorldState } from './validation.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import { hexDistance } from './simulation/geography.ts';
import { createStrategicDeposits, createCoalDeposits } from './simulation/metals.ts';
import { createPastoralSites } from './simulation/pastoral.ts';
import { createLandTransportPlanner } from './simulation/transport.ts';

export function createGeneratedWorld(seed = 1701, clockEpoch: string, initialReleaseId: 'settlement-interplanetary-1' | 'settlement-living-partnerships-1' | 'settlement-relief-charters-1' | 'settlement-regional-targets-1' = 'settlement-living-partnerships-1'): WorldState {
  if (parseUtcTimestamp(clockEpoch) === null) throw new RangeError('Generated worlds require an explicit UTC clock epoch');
  const geography = generateGeography(seed);
  let state = createWorld(seed, clockEpoch);
  for (const release of RELEASES.slice(1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: clockEpoch });
    if (!result.ok) throw new Error(`Generated foundation release refused: ${result.error ?? release.id}`);
    state = result.state;
    if (release.id === initialReleaseId) break;
  }
  state.width = geography.width;
  state.height = geography.height;
  state.tiles = geography.tiles;
  state.rng = geography.rng;
  state.origin = { kind: 'generated', generatorVersion: GENERATED_GEOGRAPHY_VERSION, seed: state.seed, clockEpoch, ...(initialReleaseId !== 'settlement-interplanetary-1' ? { initialReleaseId } : {}) };
  for (const city of state.cities) {
    const tileId = geography.capitalTileIds[city.civId];
    const center = tileId === undefined ? undefined : state.tiles[tileId];
    if (!center) throw new RangeError('Generated foundation requires an exact starting tile for every civilization');
    city.tileId = center.id;
    center.resource = 'food';
    for (const tile of state.tiles) if (tile.owner === null && tile.terrain !== 'ocean' && hexDistance(tile, center) <= 1) tile.owner = city.civId;
  }
  state.strategicDeposits = createStrategicDeposits(state);
  state.pastoralSites = createPastoralSites(state);
  state.coalDeposits = createCoalDeposits(state);
  state.revision = 0;
  state.events = [{
    id: '0:foundation', round: 0, type: 'world-founded', title: 'Five hearths on a new continent',
    detail: 'Five independent civilizations begin on a newly generated shared landscape',
    actor: null, target: null, tileId: null,
    cause: `${GENERATED_GEOGRAPHY_VERSION}; seed ${state.seed}; ${state.width} × ${state.height}; founded under release ${state.releaseId} at ${clockEpoch}`,
    effects: [`${CIV_COUNT} civilizations and ${state.cities.length} working capitals created`, 'Canonical starting supplies, population and capital housing; no completed research, construction or expeditions'],
    importance: 5,
  }];
  state.eventCounts = { 'world-founded': 1 };
  if (!isWorldState(state)) throw new Error('Generated foundation failed canonical world validation');
  const land = createLandTransportPlanner(state);
  const capital = state.cities[0];
  if (!capital || state.strategicDeposits.tileIds.length !== METAL_RULES.placement.maximumDeposits
    || state.coalDeposits.tileIds.length !== COAL_RULES.placement.maximumDeposits
    || state.pastoralSites.tileIds.length !== PASTORAL_RULES.placement.maximumSites
    || [state.strategicDeposits, state.coalDeposits].some(layer => layer.tileIds.filter(id => land.quote(capital.tileId, id)).length < 6)
    || state.civilizations.some(civilization => !legalActions(state, civilization.id, clockEpoch).some(option => option.action.type === 'settle')))
    throw new Error('Generated foundation lacks canonical resource or paid founding opportunities');
  return state;
}
