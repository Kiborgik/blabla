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

function governmentChoice(input: CivicProgressInput, target: NonNullable<CapabilityProjection['governance']>['targets'][number]): string {
  const definition = input.catalogue.governments.find(candidate => candidate.id === target.governmentId);
  const terms = RESOURCE_IDS.flatMap(resource => {
    const amount = definition?.baseProduction[resource];
    return amount ? [`${amount > 0 ? '+' : ''}${exactNumber(amount)} base ${METRIC_LABELS[resource]} in every owned town`] : [];
  });
  if (definition?.capitalConstructionWorkPercent) terms.push(`+${exactNumber(definition.capitalConstructionWorkPercent)}% construction work in the owned original capital`);
  const counts = POLICY_SLOT_TYPES.map(type => `${exactNumber(target.slots[type])} ${type}`).join(' · ');
  return [`${name(input, 'governments', target.governmentId)} · ${target.eligible ? 'Prerequisites met' : 'Prerequisites not met'} · Quote ${exactNumber(target.price.credits)} Credits`, `Slots: ${counts}`, ...terms].join(' · ');
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
  const releasedPolicies = input.catalogue.policies.filter(policy => policy.requiredFeatures.every(feature => input.projection.unlockedFeatures.includes(feature)));
  const activePolicies = (current?.assignments ?? []).flatMap(assignment => releasedPolicies.find(policy => policy.id === assignment.policyId) ?? []);
  const exclusiveGroups = [...new Set(releasedPolicies.flatMap(policy => policy.exclusiveGroup ?? []))];
  const priorityRule = exclusiveGroups.flatMap(group => {
    const names = releasedPolicies.filter(policy => policy.exclusiveGroup === group).map(policy => policy.name);
    return names.length > 1 ? [`${names.join(' and ')} cannot be combined, even in wildcard slots.`] : [];
  }).join(' ');
  const effects = RESOURCE_IDS.flatMap(resource => {
    const amount = modifiers.baseProduction[resource];
    return amount ? [`${amount > 0 ? '+' : ''}${exactNumber(amount)} base ${METRIC_LABELS[resource]}`] : [];
  });
  if (modifiers.constructionWork) effects.push(`${modifiers.constructionWork > 0 ? '+' : ''}${exactNumber(modifiers.constructionWork)} base construction work`);
  for (const policy of activePolicies) {
    const effect = policy.institutionalSciencePercent;
    if (effect) effects.push(`+${exactNumber(effect.percent)}% Science from fully funded, staffed ${effect.buildingIds.map(id => input.catalogue.buildings.find(building => building.id === id)?.name ?? id).join(', ')} only`);
  }
  const capitalPercent = modifiers.capitalConstructionWorkPercent;
  const capitalId = governance.originalCapitalCityId;
  let capitalApplicability: string | null = null;
  if (capitalPercent > 0) {
    if (!capitalId) capitalApplicability = 'The original capital is not owned. No capital construction bonus applies.';
    else if (!input.projection.cityId) capitalApplicability = 'Select a town to inspect its capital construction bonus.';
    else if (input.projection.cityId === capitalId) effects.push(`+${exactNumber(capitalPercent)}% construction work in this town · Owned original capital`);
    else capitalApplicability = `No capital construction bonus in this town. It applies only to the owned original capital · ${capitalId}.`;
  }
  return {
    status: lane?.status ?? 'unknown',
    heading: !civic ? 'Civic record unavailable' : project ? `Developing ${name(input, 'civics', project.civicId)}` : completion ? `${name(input, 'civics', completion.civicId)} completed` : lane?.status === 'required' ? 'Awaiting a civic choice' : 'No active civic',
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
      pending: pending ? [`Pending arrangement · ${name(input, 'governments', pending.targetGovernmentId)}`, `Accepted round ${pending.acceptedRound} · Recorded transition end ${pending.completionRound}`, 'Current effects still use the active arrangement. The pending arrangement does not apply early.', `Paid ${exactNumber(pending.paidCredits)} Credits`, `Reform used · ${pending.spentCompletionEventId ?? 'None'}`, ...slots(input, pending.targetGovernmentId, pending.targetAssignments)] : [],
      reform: reform ? `Unused reform · ${name(input, 'civics', reform.civicId)} · Round ${reform.completedRound} · Event ${reform.completionEventId}` : 'No unused reform recorded.',
      targets: governance.targets.map(target => governmentChoice(input, target)),
      choiceExplanation: `Prerequisites and price are not permission to act. Adoption needs an explicit agent choice and the current action rules. Civic completion does not adopt a government or assign a policy.${priorityRule ? ` ${priorityRule}` : ''}`,
      events: (input.events ?? []).filter(event => event.actor === input.projection.civilizationId && (event.type === 'arrangement-accepted' || event.type === 'transition-completed')).slice(-2).map(event => `${event.title} · Round ${event.round} · Event ${event.id}`),
    },
    effects,
    capitalApplicability,
    emptyEffects: current ? input.projection.cityId ? 'No government or policy bonus applies to this town.' : 'No town selected for local effects.' : 'No government or policy effects active.',
    outputFactor: `Current ordinary output factor · ${exactNumber(modifiers.ordinaryOutputMultiplier)}`,
    constructionCapacity: governance.cityConstructionWork === null ? null : `${exactNumber(governance.cityConstructionWork)} work · Current town capacity`,
    constructionRecord: constructionRecord(input),
    effectExplanation: 'These are current government and policy effects, not credited work or goods. Town capacity already includes focus, productivity and any applicable capital bonus. Recorded order work does not identify which government produced it.',
  };
}

export interface CivicTreeNode {
  id: string;
  name: string;
  level: number;
  requires: Array<{ id: string; name: string }>;
  status: 'completed' | 'developing' | 'available' | 'locked' | 'unreleased' | 'unknown';
  cost: number;
  explanation: string;
}

export function civicTreeNodes(input: CivicProgressInput): CivicTreeNode[] {
  const definitions = input.catalogue.civics;
  const civic = input.projection.governance?.civics;
  const available = input.projection.decisions?.civic?.availableIds ?? [];
  const depth = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0;
    const definition = definitions.find(candidate => candidate.id === id);
    const parents = definition?.requires.filter(parent => definitions.some(candidate => candidate.id === parent)) ?? [];
    return parents.length ? 1 + Math.max(...parents.map(parent => depth(parent, new Set([...visited, id])))) : 0;
  };
  return definitions.map((definition): CivicTreeNode => ({
    id: definition.id, name: definition.name, level: depth(definition.id),
    requires: definition.requires.map(id => ({ id, name: definitions.find(parent => parent.id === id)?.name ?? id })),
    status: !definition.requiredFeatures.every(feature => input.projection.unlockedFeatures.includes(feature)) ? 'unreleased'
      : !civic ? 'unknown' : civic.completedCivicIds.includes(definition.id) ? 'completed'
        : civic.active?.civicId === definition.id ? 'developing' : available.includes(definition.id) ? 'available' : 'locked',
    cost: definition.cost, explanation: definition.capability,
  })).toSorted((a, b) => a.level - b.level || a.name.localeCompare(b.name));
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
  const section = disclosure('civic-progress', 'Civics & government');
  section.className = 'civic-progress town-receipt';
  section.dataset['inspectionSection'] = 'overview';
  section.dataset['civicStatus'] = view.status;
  section.setAttribute('aria-label', 'Civics and government');
  const heading = text('h4', 'Culture · Civics');
  heading.prepend(visualIcon('culture'));
  section.append(heading, text('strong', view.heading, 'civic-current'));
  if (view.progress) {
    const active = input.projection.governance?.civics?.active;
    if (active) {
      const meter = text('progress', '', 'civic-meter'); meter.max = active.requiredCulture; meter.value = Math.max(0, active.progress); meter.setAttribute('aria-label', `${view.heading}: ${view.progress}`); section.append(meter);
    }
    section.append(text('p', view.progress, 'civic-amount'));
  }
  const tree = disclosure('civic-tree', 'Civic tree · Explore progress');
  tree.className = 'town-receipt civic-record civic-tree';
  tree.append(text('p', 'Each civic needs all of its earlier civics. Agents choose what to develop; this view cannot give orders.', 'civic-note'));
  const nodes = text('ol', '', 'civic-tree-nodes');
  const statuses = { completed: 'Completed', developing: 'Developing', available: 'Available', locked: 'Locked', unreleased: 'Not released', unknown: 'Record unavailable' };
  for (const node of civicTreeNodes(input)) {
    const row = text('li', '', 'civic-tree-node'); row.dataset['civicId'] = node.id; row.dataset['status'] = node.status;
    row.setAttribute('style', `--civic-depth:${Math.min(node.level, 3)}`);
    const heading = text('div', '', 'civic-node-heading');
    heading.append(text('strong', node.name), text('span', statuses[node.status], 'civic-node-status'));
    row.append(heading, text('p', node.requires.length ? `Requires: ${node.requires.map(parent => parent.name).join(' + ')}` : 'Starting civic', 'civic-node-parents'), text('p', `${exactNumber(node.cost)} Culture`, 'civic-node-cost'), text('p', node.explanation, 'civic-note'));
    nodes.append(row);
  }
  tree.append(nodes); section.append(tree);
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
  section.append(government);
  const effects = disclosure('government-effects', 'Government effects & construction');
  for (const effect of view.effects) effects.append(text('p', effect, 'civic-effect'));
  if (view.capitalApplicability) effects.append(text('p', view.capitalApplicability, 'civic-note'));
  if (!view.effects.length) effects.append(text('p', view.emptyEffects, 'civic-note'));
  effects.append(text('p', view.outputFactor, 'civic-note'));
  if (view.constructionCapacity) effects.append(text('p', view.constructionCapacity, 'civic-amount'));
  if (view.constructionRecord) effects.append(text('p', view.constructionRecord, 'civic-note'));
  effects.append(text('p', view.effectExplanation, 'civic-note'));
  section.append(effects);
  return section;
}
