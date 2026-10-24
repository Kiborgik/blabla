import { RESOURCE_IDS } from '../core/content.ts';
import type { Resources } from '../core/types.ts';
import type { MarsBodyObservation } from '../visuals/mars-body.ts';
import { marsStatusLabel } from '../visuals/mars-body.ts';

function resources(values: Partial<Resources>): string {
  return RESOURCE_IDS.filter(resource => (values[resource] ?? 0) !== 0)
    .map(resource => `${values[resource]} ${resource}`).join(' · ') || 'None';
}

export function renderMarsBodyInspection(container: HTMLElement, observation: MarsBodyObservation, civilizationId: number): void {
  container.replaceChildren();
  const civ = observation.civilizations.find(candidate => candidate.id === civilizationId);
  const line = (label: string, value: string): void => {
    const paragraph = document.createElement('p'); const strong = document.createElement('strong');
    strong.textContent = `${label}: `; paragraph.append(strong, document.createTextNode(value)); container.append(paragraph);
  };
  if (!civ) { line('Mars', 'No observation for this civilization.'); return; }
  line('Colony', marsStatusLabel(civ));
  if (observation.terminal) line('World complete', `Recorded state at round ${observation.round}. No further transit or colony work advances.`);
  if (!civ.colony) line('Surface', 'No colony has arrived. No habitat, people or delivered reserves are shown on the surface.');
  else {
    line('People on Mars', String(civ.population));
    line('Paid habitat work', civ.paidProgress === null ? `Work receipt unavailable · recorded counter ${civ.progress}`
      : `${civ.paidProgress} / ${observation.habitatRequiredWork} · ${civ.habitable ? 'habitable structure' : 'not yet habitable'}`);
    line('Established', `Round ${civ.colony.establishedRound}`);
    line('Delivered reserves', resources(civ.reserves ?? {}));
    line('Supply streak', `${civ.supplyStreak} consecutive habitable rounds`);
    line('Shortage streak', `${civ.colony.shortageRounds} rounds`);
    if (civ.lastUpkeep) {
      line('Last recorded support', `${civ.lastUpkeep.status} · round ${civ.lastUpkeep.round}`);
      line('Support paid', resources(civ.lastUpkeep.paid));
      line('Support missing', resources(civ.lastUpkeep.missing));
    } else line('Last recorded support', 'No upkeep receipt');
    if (civ.lastHabitatWork) line('Last paid habitat work', `${civ.lastHabitatWork.progressBefore} → ${civ.lastHabitatWork.progressAfter} · round ${civ.lastHabitatWork.round} · paid ${resources(civ.lastHabitatWork.paid)}`);
    if (civ.lastArrival) line('Last recorded arrival', `${civ.lastArrival.missionId} · round ${civ.lastArrival.round} · ${civ.lastArrival.settlers} settlers · delivered ${resources(civ.lastArrival.cargo)}`);
  }
  if (civ.mission) {
    const mission = civ.mission;
    line('In transit — not delivered', `${mission.mission === 'settle' ? 'Settlement' : 'Resupply'} mission ${mission.id}`);
    line('Departure', `${mission.sourceCityId} · round ${mission.departureRound}`);
    line('Scheduled arrival', observation.terminal ? `In flight at world end; scheduled arrival round ${mission.arrivalRound}. No further arrival will be processed.` : `Round ${mission.arrivalRound}`);
    line('People in transit', String(mission.settlers));
    line('Cargo in transit', resources(mission.cargo));
    line('Departure payment', resources(mission.paid));
  } else line('In transit', 'No active mission');
  line('Visual context', `${observation.contextLabel} Habitat shape follows paid work. People and reserve symbols are grouped; exact totals are above. No local production is implied.`);
}
