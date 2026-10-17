import type { CapabilityCatalogue, CapabilityProjection } from '../core/capabilities.ts';
import { POLICY_SLOT_TYPES, RESOURCE_IDS } from '../core/content.ts';
import type { City, DecisionBlocker, GameEvent, PolicyAssignment } from '../core/types.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import { exactNumber } from './number-format.ts';
import { visualIcon } from './world-cues.ts';

export interface CivicProgressInput {
  catalogue: CapabilityCatalogue;
  projection: CapabilityProjection;
  city?: Pick<City, 'id' | 'name' | 'construction'>;
  events?: readonly GameEvent[];
}

function name(input: CivicProgressInput, kind: 'civics' | 'governments' | 'policies', id: string): string {
  return input.catalogue[kind].find(definition => definition.id === id)?.name ?? id;
}

function blockerText(input: CivicProgressInput, reason: DecisionBlocker): string {
  if (reason.kind === 'no-available-choice') return 'No further civic is available in this release.';
  if (reason.kind === 'civic-prerequisite') return `Complete civic: ${name(input, 'civics', reason.civicId)}.`;
  if (reason.kind === 'feature') return `Not released: ${input.catalogue.features.find(feature => feature.id === reason.featureId)?.name ?? reason.featureId}.`;
  if (reason.kind === 'zero-work') return 'No productive work is available now.';
  if (reason.kind === 'active-commitment') return `Finish the active commitment: ${name(input, 'civics', reason.targetId)}.`;
  return `Recorded requirement: ${reason.kind}.`;
}

function slots(input: CivicProgressInput, governmentId: string, assignments: readonly PolicyAssignment[]): string[] {
  const target = input.projection.governance?.targets.find(candidate => candidate.governmentId === governmentId);
  if (!target) return ['Policy slot facts unavailable.'];
  return POLICY_SLOT_TYPES.flatMap(slotType => Array.from({ length: target.slots[slotType] }, (_, slotIndex) => {
    const assignment = assignments.find(candidate => candidate.slotType === slotType && candidate.slotIndex === slotIndex);
    return `${slotType.charAt(0).toUpperCase()}${slotType.slice(1)} slot ${slotIndex + 1} · ${assignment ? name(input, 'policies', assignment.policyId) : 'Empty'}`;
  }));
}

function constructionRecord(input: CivicProgressInput): string | null {
  const city = input.city;
  if (!city || city.id !== input.projection.cityId) return null;
  const construction = city.construction;
  const record = construction?.active ?? construction?.lastCompleted;
  if (!record) return 'No construction record for this town.';
  if ('kind' in record && record.kind === 'rail') {
    const label = `Rail · Tiles ${record.tileId} ↔ ${record.toTileId} · Edge ${record.edgeId}`;
    return 'workDone' in record ? `${label} · ${exactNumber(record.workDone)} / ${exactNumber(record.workRequired)} work recorded · Order ${record.id}` : `Last completed · ${label} · Round ${record.completedRound} · Event ${record.eventId}`;
  }
  const id = 'buildingId' in record ? record.buildingId : 'improvementId' in record ? record.improvementId : record.wonderId;
  const definition = [...input.catalogue.buildings, ...input.catalogue.improvements, ...input.catalogue.wonders].find(candidate => candidate.id === id);
  const label = definition?.name ?? id;
  if ('workDone' in record) return `${label} · ${exactNumber(record.workDone)} / ${exactNumber(record.workRequired)} work recorded · Order ${record.id}`;
  return `Last completed · ${label} · Round ${record.completedRound} · Event ${record.eventId}`;
}

export function civicProgressPresentation(input: CivicProgressInput) {
  const governance = input.projection.governance;
  if (!governance) return null;
  const civic = governance.civics;
  const lane = input.projection.decisions?.civic;
  const project = civic?.active;
  const completion = civic?.lastCompleted;
  const government = governance.government;
  const current = government?.active;
  const pending = government?.pending;
  const reform = civic?.reformEntitlement;
  const modifiers = governance.modifiers;
  const effects = RESOURCE_IDS.flatMap(resource => {
    const amount = modifiers.baseProduction[resource];
    return amount ? [`${amount > 0 ? '+' : ''}${exactNumber(amount)} base ${METRIC_LABELS[resource]}`] : [];
  });
  if (modifiers.constructionWork) effects.push(`${modifiers.constructionWork > 0 ? '+' : ''}${exactNumber(modifiers.constructionWork)} base construction work`);
  return {
    status: lane?.status ?? 'unknown',
    heading: !civic ? 'Civic record unavailable' : project ? `Developing ${name(input, 'civics', project.civicId)}` : completion ? `${name(input, 'civics', completion.civicId)} completed` : lane?.status === 'required' ? 'Choose a civic' : 'No active civic',
    progress: project ? `${exactNumber(project.progress)} / ${exactNumber(project.requiredCulture)} Culture` : null,
    explanation: 'Culture made by towns in later seasons advances the chosen civic. Stored Culture does not speed it up. Science research stays separate.',
    choices: (lane?.availableIds ?? []).map(id => {
      const definition = input.catalogue.civics.find(candidate => candidate.id === id);
      return definition ? `${definition.name} · ${exactNumber(definition.cost)} Culture` : id;
    }),
    blockers: (lane?.blockers ?? []).map(blocker => blockerText(input, blocker.reason)),
    completion: completion ? `${name(input, 'civics', completion.civicId)} · Round ${completion.completedRound} · Event ${completion.eventId}` : null,
    government: {
      heading: !government ? 'Government record unavailable' : current ? name(input, 'governments', current.governmentId) : 'No government adopted',
      slots: current ? slots(input, current.governmentId, current.assignments) : [],
      records: current ? [`Recorded effective round · ${current.effectiveRound}`, `Government commitment until round ${current.governmentLockUntilRound}`, `Policy commitment until round ${current.policyLockUntilRound}`] : [],
      pending: pending ? [`Pending arrangement · ${name(input, 'governments', pending.targetGovernmentId)}`, `Accepted round ${pending.acceptedRound} · Recorded transition end ${pending.completionRound}`, `Paid ${exactNumber(pending.paidCredits)} Credits`, `Reform used · ${pending.spentCompletionEventId ?? 'None'}`, ...slots(input, pending.targetGovernmentId, pending.targetAssignments)] : [],
      reform: reform ? `Unused reform · ${name(input, 'civics', reform.civicId)} · Round ${reform.completedRound} · Event ${reform.completionEventId}` : 'No unused reform recorded.',
      targets: governance.targets.map(target => `${name(input, 'governments', target.governmentId)} · ${target.eligible ? 'Prerequisites met' : 'Prerequisites not met'} · Quote ${exactNumber(target.price.credits)} Credits`),
      choiceExplanation: 'Prerequisites and price are not permission to act. Adoption needs an explicit agent choice and the current action rules. Civic completion does not adopt a government or assign a policy.',
      events: (input.events ?? []).filter(event => event.actor === input.projection.civilizationId && (event.type === 'arrangement-accepted' || event.type === 'transition-completed')).slice(-2).map(event => `${event.title} · Round ${event.round} · Event ${event.id}`),
    },
    effects,
    outputFactor: `Current ordinary output factor · ${exactNumber(modifiers.ordinaryOutputMultiplier)}`,
    constructionCapacity: governance.cityConstructionWork === null ? null : `${exactNumber(governance.cityConstructionWork)} work · Current town capacity`,
    constructionRecord: constructionRecord(input),
    effectExplanation: 'These are current base contributions, not credited work or goods. Town capacity includes focus and productivity. Actual construction progress and past production receipts are separate.',
  };
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function disclosure(key: string, label: string): HTMLDetailsElement {
  const details = text('details', '', 'town-receipt civic-record');
  details.dataset['townDisclosure'] = key;
  details.append(text('summary', label));
  return details;
}

export function createCivicProgress(input: CivicProgressInput): HTMLElement | null {
  const view = civicProgressPresentation(input);
  if (!view) return null;
  const section = text('section', '', 'civic-progress');
  section.dataset['inspectionSection'] = 'overview';
  section.dataset['civicStatus'] = view.status;
  section.setAttribute('aria-label', 'Civics and government');
  const heading = text('h4', 'Culture · Civics');
  heading.prepend(visualIcon('culture'));
  section.append(heading, text('strong', view.heading, 'civic-current'));
  if (view.progress) section.append(text('p', view.progress, 'civic-amount'));
  const civic = disclosure('civics', 'Civic progress & record');
  civic.append(text('p', view.explanation));
  for (const choice of view.choices) civic.append(text('p', `Available civic · ${choice}`));
  for (const blocker of view.blockers) civic.append(text('p', blocker));
  if (view.completion) civic.append(text('p', `Last completed · ${view.completion}`));
  section.append(civic);
  const government = disclosure('government', `Government · ${view.government.heading}`);
  for (const slot of view.government.slots) government.append(text('p', slot, 'civic-slot'));
  for (const record of view.government.records) government.append(text('p', record));
  if (view.government.pending.length) {
    const pending = text('section', '', 'civic-pending');
    for (const record of view.government.pending) pending.append(text('p', record));
    government.append(pending);
  } else government.append(text('p', 'No pending government transition.'));
  government.append(text('p', view.government.reform));
  for (const target of view.government.targets) government.append(text('p', target));
  government.append(text('p', view.government.choiceExplanation, 'civic-note'));
  for (const event of view.government.events) government.append(text('p', `Recorded event · ${event}`, 'civic-note'));
  section.append(government, text('h4', 'Current opening effects'));
  for (const effect of view.effects) section.append(text('p', effect, 'civic-effect'));
  if (!view.effects.length) section.append(text('p', 'No government or policy effects active.', 'civic-note'));
  section.append(text('p', view.outputFactor, 'civic-note'));
  if (view.constructionCapacity) section.append(text('p', view.constructionCapacity, 'civic-amount'));
  if (view.constructionRecord) section.append(text('p', view.constructionRecord, 'civic-note'));
  section.append(text('p', view.effectExplanation, 'civic-note'));
  return section;
}
