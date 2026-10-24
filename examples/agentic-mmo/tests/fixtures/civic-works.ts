import assert from 'node:assert/strict';
import { BUILDINGS, CIVICS } from '../../core/content.ts';
import { createWorld } from '../../core/engine.ts';
import type { CivicWorksAction } from '../../core/civic-works-types.ts';
import { civicWorksBlock, executeCivicWorksAction } from '../../core/simulation/civic-works.ts';
import { executeAction } from '../../core/simulation/commands.ts';
import { availableDistrictSites } from '../../core/simulation/districts.ts';
import { resolveEconomy } from '../../core/simulation/economy.ts';
import { commitEvents, emitEvent } from '../../core/simulation/events.ts';
import type { City, GameEvent, WorldState } from '../../core/types.ts';
import { syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
export const civicWorksTown = (state: WorldState): City => state.cities.find(city => city.id === 'city-0')!;

export function civicWorksFixture(buildingId = 'fuel-yard'): WorldState {
  const state = createWorld(1701, epoch, 'settlement-civic-works-1');
  const actor = state.civilizations[0]!; const city = civicWorksTown(state);
  actor.resources = { food: 300, materials: 300, credits: 300, energy: 300, culture: 300, science: 0 };
  actor.researchTarget = ''; actor.era = 2;
  city.population = 20; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'research';
  syntheticTechnologies(state, 0, ['fuel-management', ...BUILDINGS.find(building => building.id === buildingId)!.requires]);
  syntheticInstitution(state, city.id, 'kiln');
  const definition = BUILDINGS.find(building => building.id === buildingId)!;
  const installPrerequisite = (id: string): void => {
    const prerequisite = BUILDINGS.find(building => building.id === id)!;
    for (const parent of prerequisite.requiresBuildings ?? []) if (!city.buildings.includes(parent)) installPrerequisite(parent);
    syntheticTechnologies(state, 0, prerequisite.requires);
    if (!city.buildings.includes(id)) syntheticInstitution(state, city.id, id);
  };
  for (const id of definition.requiresBuildings ?? []) installPrerequisite(id);
  state.revision++;
  const civicEvents: GameEvent[] = [];
  const civic = CIVICS.at(-1)!;
  const event = emitEvent(state, civicEvents, { type: 'civic-completed', title: 'Synthetic completed civic prerequisites', detail: 'Conditional fixture, not natural progression', actor: 0, target: 0, tileId: null, cause: 'Explicit synthetic setup', effects: [`Completed civic ${civic.id}`], importance: 1 });
  actor.civics = { ruleVersion: 1, completedCivicIds: CIVICS.map(civic => civic.id), active: null, lastCompleted: { civicId: civic.id, completedRound: state.round, eventId: event.id }, reformEntitlement: { civicId: civic.id, completedRound: state.round, completionEventId: event.id } };
  commitEvents(state, civicEvents);
  state.revision++;
  const events: GameEvent[] = [];
  executeAction(state, 0, { type: 'build', cityId: city.id, project: buildingId, ...(definition.district ? { tileId: availableDistrictSites(state, city, definition)[0]! } : {}) }, events); commitEvents(state, events);
  assert.deepEqual(city.construction!.active!.paid, BUILDINGS.find(building => building.id === buildingId)!.cost);
  return state;
}

export function civicWorksAction(state: WorldState): CivicWorksAction {
  return { type: 'commission-civic-works', cityId: civicWorksTown(state).id, orderId: civicWorksTown(state).construction!.active!.id, donorBuildingId: 'kiln' };
}

export function acceptCivicWorksFixture(state: WorldState): void {
  state.revision++;
  const events: GameEvent[] = [];
  assert.ok(executeCivicWorksAction(state, 0, civicWorksAction(state), events), civicWorksBlock(state, 0, civicWorksAction(state)) ?? 'Expected commission admission');
  commitEvents(state, events);
}

export function advanceCivicWorksFixture(state: WorldState): GameEvent[] {
  state.round++; state.revision++;
  const events: GameEvent[] = [];
  resolveEconomy(state, events); commitEvents(state, events);
  return events;
}

