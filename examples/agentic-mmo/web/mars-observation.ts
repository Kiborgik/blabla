import { BUILDINGS, ERAS, HISTORICAL_MILESTONES, RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../core/content.ts';
import type { MarsCivilizationState, Resources, WorldState } from '../core/types.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import { exactNumber } from './number-format.ts';
import { visualIcon } from './world-cues.ts';

export function worldJourney(state: WorldState) {
  const stage = ERAS[Math.max(...state.civilizations.map(civilization => civilization.era))]?.name ?? 'Stage unavailable';
  const outcome = state.outcome ? {
    title: state.outcome.kind === 'mars' && state.outcome.winners.length > 0 && state.outcome.winners.every(id => marsObservation(state, id)?.achieved)
      ? 'Sustained Mars home' : { mars: 'Mars outcome recorded', federation: 'Federation outcome recorded', cultural: 'Cultural outcome recorded', economic: 'Economic outcome recorded', military: 'Military outcome recorded' }[state.outcome.kind],
    winners: state.outcome.winners.map(id => state.civilizations.find(civilization => civilization.id === id)?.name ?? `Civilization ${id}`),
    round: state.outcome.round, reason: state.outcome.reason,
  } : null;
  return {
    stage, outcome, headline: outcome?.title ?? stage,
    roundLabel: `Round ${state.round}${outcome ? ' · World complete' : ''}`,
    milestones: HISTORICAL_MILESTONES.map(definition => {
      const proof = state.milestoneProofs?.[definition.id];
      const recorded = state.calendarMilestones.includes(definition.id);
      return { id: definition.id, name: definition.name, explanation: definition.explanation,
        status: recorded ? 'recorded' : definition.requiredFeatures.every(feature => state.unlockedFeatures.includes(feature)) ? 'not-yet-recorded' : 'unreleased',
        proof: proof ? { ...proof } : null };
    }),
  };
}

export function marsObservation(state: WorldState, civilizationId: number) {
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  if (!civilization) return null;
  const released = state.unlockedFeatures.includes(SPACEFLIGHT_RULES.featureId);
  const ledger: MarsCivilizationState | null = state.spaceflight?.ruleVersion === SPACEFLIGHT_RULES.ruleVersion
    ? structuredClone(state.spaceflight.civilizations[civilizationId] ?? null) : null;
  const sites = state.cities.filter(city => city.civId === civilizationId && city.buildings.includes(VICTORY_RULES.mars.requiredBuilding)).map(city => ({
    id: city.id, name: city.name,
    operation: city.buildingOperations?.[VICTORY_RULES.mars.requiredBuilding]?.lastResult ? structuredClone(city.buildingOperations[VICTORY_RULES.mars.requiredBuilding]!.lastResult) : null,
    power: city.localPower?.lastBeat ? { round: city.localPower.lastBeat.round, generated: city.localPower.lastBeat.generated, consumed: city.localPower.lastBeat.consumed, expired: city.localPower.lastBeat.expired } : null,
  }));
  const mission = ledger?.activeMission;
  const source = mission ? state.cities.find(city => city.id === mission.sourceCityId) : undefined;
  const arrived = Boolean(ledger?.lastArrival);
  const colony = ledger?.colony ? {
    ...ledger.colony, population: civilization.marsPopulation,
    habitatWork: ledger.lastHabitatWork ? civilization.marsProgress : civilization.marsProgress === 0 ? 0 : null,
    habitatRequired: SPACEFLIGHT_RULES.habitat.requiredWork,
    habitable: arrived && (ledger.lastHabitatWork?.progressAfter ?? 0) >= SPACEFLIGHT_RULES.habitat.requiredWork && civilization.marsProgress >= SPACEFLIGHT_RULES.habitat.requiredWork,
    supplyStreak: civilization.marsSupplyStreak, requiredSupplyStreak: VICTORY_RULES.mars.suppliedRounds,
    requiredPopulation: VICTORY_RULES.mars.population,
  } : null;
  const achieved = Boolean(colony?.habitable && colony.population >= VICTORY_RULES.mars.population && colony.supplyStreak >= VICTORY_RULES.mars.suppliedRounds
    && ledger?.lastUpkeep?.status === 'supplied' && state.outcome?.kind === 'mars' && state.outcome.winners.includes(civilizationId));
  return {
    id: civilization.id, name: civilization.name, color: civilization.color, released, ledger,
    technology: civilization.technologies.includes(VICTORY_RULES.mars.requiredTechnology), sites, arrived, colony, achieved,
    preparation: state.calendarMilestones.includes('beyond-earth'),
    mission: mission ? { ...mission, sourceName: source?.name ?? null,
      duration: mission.arrivalRound - mission.departureRound,
      elapsed: Math.max(0, Math.min(mission.arrivalRound - mission.departureRound, state.round - mission.departureRound)) } : null,
    status: !released ? 'Not released' : !ledger ? 'Detailed mission records unavailable' : achieved ? 'Sustained Mars home' : colony
      ? colony.population === 0 ? 'Uninhabited colony' : ledger.lastUpkeep?.status === 'shortage' ? 'Colony supply shortage' : colony.habitable ? 'Habitable colony' : colony.habitatWork === null ? 'Habitat record unavailable' : colony.habitatWork > 0 ? 'Incomplete habitat' : 'Colony landed'
      : mission ? 'Transport in flight' : arrived ? 'Landing recorded' : 'Earth preparation',
  };
}

export type MarsObservation = NonNullable<ReturnType<typeof marsObservation>>;

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = value; element.className = className; return element;
}

function resourceAmounts(resources: Partial<Resources>, includeZero = false): string {
  const values = RESOURCE_IDS.flatMap(resource => {
    const amount = resources[resource];
    return amount !== undefined && (includeZero || amount !== 0) ? [`${exactNumber(amount)} ${METRIC_LABELS[resource]}`] : [];
  });
  return values.join(' · ') || 'None recorded';
}

function receipt(identity: string, label: string, lines: string[]): HTMLDetailsElement {
  const details = text('details', '', 'mars-receipt'); details.dataset['journeyRecord'] = identity; details.append(text('summary', label));
  for (const line of lines) details.append(text('p', line));
  return details;
}

function phase(name: string, detail: string, status: 'recorded' | 'active' | 'pending' | 'unknown'): HTMLElement {
  const row = text('li', '', 'journey-phase'); row.dataset['status'] = status;
  row.append(text('strong', name), text('span', detail)); return row;
}

function colonySchematic(view: MarsObservation): HTMLElement {
  const figure = text('figure', '', 'mars-colony-view');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 280 100'); svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, className: string): void => {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', d); shape.setAttribute('class', className); svg.append(shape);
  };
  path('M0 83L29 76L57 80L86 72L121 81L163 73L198 80L235 70L280 79V100H0Z', 'mars-ground');
  if (view.arrived) path('M39 76L45 58H65L71 76ZM48 58V47H62V58M45 70L36 84M65 70L74 84', 'mars-lander');
  if (view.colony && view.ledger?.lastHabitatWork) {
    path('M111 82V60Q154 14 197 60V82ZM111 60H197M140 38V82M168 38V82', view.colony.habitable ? 'mars-habitat complete' : 'mars-habitat building');
    if (view.colony.habitable && view.colony.population > 0) path('M147 82V66H161V82', 'mars-inhabited');
  }
  figure.append(svg, text('figcaption', 'Colony schematic · Recorded landing and habitat only, not a surface map.'));
  return figure;
}

export function renderMarsObservation(host: HTMLElement, state: WorldState, selectedCivilization: number, inspectTown: (id: string) => void, refresh?: { scrollHost: HTMLElement; scrollTop: number }): void {
  const disclosures = refresh ? new Map([...host.querySelectorAll<HTMLDetailsElement>('details[data-journey-record]')].map(record => [record.dataset['journeyRecord'], record.open])) : null;
  host.replaceChildren();
  const journey = worldJourney(state);
  const history = text('details', '', 'journey-world-records'); history.dataset['journeyRecord'] = 'world-history';
  history.append(text('summary', `${journey.headline} · World history`));
  if (journey.outcome) history.append(text('p', `${journey.outcome.winners.join(', ')} · Outcome round ${journey.outcome.round}. This world is complete; unfinished missions remain in their recorded state.`), text('p', journey.outcome.reason));
  history.append(text('p', `World stage: ${journey.stage}. The stage describes shared capability. It does not mean every civilization knows the same technologies or every town has the same buildings. Spacefaring preparation is not a launch or a colony.`));
  const milestones = text('ol', '', 'journey-milestones');
  for (const milestone of journey.milestones) {
    const row = text('li', ''); row.dataset['status'] = milestone.status;
    row.append(text('strong', milestone.name), text('span', milestone.status === 'recorded' ? milestone.proof ? `Recorded round ${milestone.proof.round}` : 'Recorded milestone · Detailed proof unavailable' : milestone.status === 'unreleased' ? 'Not released' : 'Not yet recorded'), text('p', milestone.explanation)); milestones.append(row);
  }
  history.append(milestones); host.append(history);
  for (const civilization of state.civilizations) {
    const view = marsObservation(state, civilization.id); if (!view) continue;
    const card = text('details', '', 'mars-civilization'); card.dataset['civilization'] = String(view.id); card.dataset['journeyRecord'] = `civilization:${view.id}`; card.open = view.id === selectedCivilization; card.style.setProperty('--civ-color', view.color);
    const record = (key: string, label: string, lines: string[]): HTMLDetailsElement => receipt(`${view.id}:${key}`, label, lines);
    const heading = text('summary', ''); heading.append(text('strong', view.name), text('span', view.status)); card.append(heading);
    if (!view.released || !view.ledger) {
      card.append(text('p', view.released ? 'This world has no detailed mission ledger. Earlier expedition counters do not establish a paid departure, arrival, or habitable colony.' : 'Interplanetary missions are not part of this world’s released capabilities.'));
      host.append(card); continue;
    }
    const phases = text('ol', '', 'journey-phases');
    phases.append(phase('Knowledge', view.technology ? 'Spaceflight discovered by this civilization' : 'Spaceflight not yet discovered', view.technology ? 'recorded' : 'pending'));
    phases.append(phase('Launch infrastructure', view.sites.length ? `${view.sites.length} installed ${view.sites.length === 1 ? 'complex' : 'complexes'} · Operation is separate` : 'No completed launch complex in its towns', view.sites.length ? 'recorded' : 'pending'));
    phases.append(phase('Earth to Mars', view.mission ? `${view.mission.mission === 'settle' ? 'Settlement transport' : 'Resupply transport'} in flight · Arrival round ${view.mission.arrivalRound}` : view.arrived ? `Last arrival round ${view.ledger.lastArrival!.round}` : view.ledger.lastDeparture ? `Departure recorded at round ${view.ledger.lastDeparture.departureRound} · Arrival not recorded` : 'No departure recorded', view.mission ? 'active' : view.arrived ? 'recorded' : 'pending'));
    phases.append(phase('Habitat', view.colony ? view.colony.habitatWork === null ? 'Work record unavailable' : `${exactNumber(view.colony.habitatWork)} / ${view.colony.habitatRequired} paid work${view.colony.habitable ? ' · Habitable' : ' · Not habitable yet'}` : 'No landed colony', view.colony?.habitable ? 'recorded' : view.colony?.habitatWork === null ? 'unknown' : view.colony?.habitatWork ? 'active' : 'pending'));
    phases.append(phase('A sustained home', view.achieved ? `Recorded outcome · Round ${state.outcome!.round}` : view.colony ? `${view.colony.population} / ${view.colony.requiredPopulation} residents · ${view.colony.supplyStreak} / ${view.colony.requiredSupplyStreak} consecutive supplied habitat rounds` : 'An inhabited habitat must remain supplied', view.achieved ? 'recorded' : view.colony ? 'active' : 'pending'));
    card.append(phases);
    if (!view.preparation) card.append(text('p', 'The shared ground-preparation milestone is not yet recorded.', 'mars-note'));
    if (view.mission) {
      const mission = view.mission; const transport = text('section', '', 'mars-transport'); transport.setAttribute('aria-label', 'Paid transport in flight');
      const meter = text('progress', '', 'research-meter'); meter.max = Math.max(1, mission.duration); meter.value = mission.elapsed; meter.setAttribute('aria-label', `Transit elapsed: ${mission.elapsed} of ${mission.duration} strategic rounds. Arrival is recorded separately.`);
      transport.append(text('h3', `${mission.settlers} settlers in transit`), meter, text('p', `Departed round ${mission.departureRound} · ${state.outcome ? `World complete. This transport has no recorded arrival; it was scheduled for round ${mission.arrivalRound}.` : `Arrival ${state.round >= mission.arrivalRound ? 'due; awaiting recorded resolution' : `scheduled round ${mission.arrivalRound}`}.`}`));
      transport.append(text('p', `In-transit cargo: ${resourceAmounts(mission.cargo)}. Not yet in colony stores.`));
      transport.append(record('departure', 'Departure payment & source', [`Source: ${mission.sourceName ?? 'Town no longer present in this snapshot'}`, `Source population: ${mission.sourcePopulationBefore} before · ${mission.sourcePopulationAfter} after`, `Launch cost: ${resourceAmounts(mission.launchCost)}`, `Total paid from Earth: ${resourceAmounts(mission.paid)}`]));
      if (mission.sourceName) { const button = text('button', 'Inspect departure town'); button.type = 'button'; button.append(visualIcon('inspect')); button.addEventListener('click', () => inspectTown(mission.sourceCityId)); transport.append(button); }
      card.append(transport);
    }
    if (view.colony) {
      card.append(colonySchematic(view));
      const stores = text('section', '', 'mars-stores'); stores.setAttribute('aria-label', 'Mars colony stores, separate from Earth');
      stores.append(text('h3', `Mars colony · ${view.colony.population} residents`), text('p', `Colony stores: ${resourceAmounts(view.colony.stock, true)}`), text('p', 'These are delivered colony supplies, separate from Earth reserves and in-transit cargo.', 'mars-note')); card.append(stores);
      const upkeep = view.ledger.lastUpkeep;
      if (upkeep) card.append(record('supply', `Last supply check · Round ${upkeep.round} · ${upkeep.status === 'supplied' ? 'Supplied' : upkeep.status === 'shortage' ? 'Shortage' : 'Uninhabited'}`, [`Required: ${resourceAmounts(upkeep.required)}`, `Paid from colony stores: ${resourceAmounts(upkeep.paid)}`, `Missing: ${resourceAmounts(upkeep.missing)}`, `Population: ${upkeep.populationBefore} before · ${upkeep.populationAfter} after`, `Consecutive supplied habitat rounds: ${upkeep.supplyStreakBefore} before · ${upkeep.supplyStreakAfter} after`]));
      else card.append(text('p', 'No colony supply check recorded yet.'));
      const habitat = view.ledger.lastHabitatWork;
      if (habitat) card.append(record('habitat', `Last habitat work · Round ${habitat.round}`, [`Work: ${habitat.progressBefore} before · ${habitat.progressAfter} after`, `Paid from colony stores: ${resourceAmounts(habitat.paid)}`]));
    }
    if (view.ledger.lastArrival) {
      const arrival = view.ledger.lastArrival;
      card.append(record('arrival', `Last landing · Round ${arrival.round}`, [`${arrival.settlers} settlers arrived. Population: ${arrival.populationBefore} before · ${arrival.populationAfter} after`, `Delivered to colony stores: ${resourceAmounts(arrival.cargo)}`]));
    }
    for (const site of view.sites) {
      const name = BUILDINGS.find(building => building.id === VICTORY_RULES.mars.requiredBuilding)?.name ?? 'Launch infrastructure';
      card.append(record(`launch:${site.id}`, `${name} · ${site.name}`, [site.operation ? `Last operation: ${site.operation.status} at round ${site.operation.round}` : 'No operation receipt available.', site.power ? `Town Power at round ${site.power.round}: ${site.power.generated} generated · ${site.power.consumed} consumed · ${site.power.expired} expired. This is not stored Energy.` : 'No town Power receipt available. Installed does not mean powered.']));
    }
    host.append(card);
  }
  if (refresh && disclosures) {
    for (const record of host.querySelectorAll<HTMLDetailsElement>('details[data-journey-record]')) {
      const open = disclosures.get(record.dataset['journeyRecord']);
      if (open !== undefined) record.open = open;
    }
    refresh.scrollHost.scrollTop = refresh.scrollTop;
  }
}
