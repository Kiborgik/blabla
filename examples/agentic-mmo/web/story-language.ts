import { civicWorksStory } from './civic-works-inspection.ts';
import { knowledgeStory } from './knowledge-inspection.ts';
import { BUILDINGS, CIVICS, ERAS, FEATURES, GOVERNMENTS, POLICIES, RESOURCE_IDS, TECHNOLOGIES, HISTORICAL_MILESTONES } from '../core/content.ts';
import type { GameEvent, Resources, WorldState } from '../core/types.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import { recordedPublicProjectResult, type EventLogEntry } from './event-log.ts';
import { exactNumber } from './number-format.ts';
import { formatYear } from './live-world.ts';
import { parseUtcTimestamp } from '../core/simulation/time.ts';

export interface StoryLanguage {
  title: string;
  cause: string;
  consequence: string;
}

type StoryNames = Pick<WorldState, 'cities' | 'civilizations'>;
const NUMBER = '-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?';
const DETAILS = 'The recorded details are in Events → Details.';

function civilization(state: StoryNames, id: number | null): string {
  return state.civilizations.find(candidate => candidate.id === id)?.name ?? (id === null ? 'The world' : 'An unlisted civilization');
}

function town(state: StoryNames, id: string | undefined): string {
  return state.cities.find(candidate => candidate.id === id)?.name ?? 'The recorded town';
}

function boundedRecord(state: StoryNames, value: string): string {
  const named = value.replace(/\b(?:city|route|offer|project)-[a-zA-Z0-9_-]+\b/g, id => id.startsWith('city-') ? town(state, id)
    : id.startsWith('route-') ? 'the recorded route' : id.startsWith('offer-') ? 'the recorded offer' : 'the joint repair');
  return named.length <= 180 ? named : `${named.slice(0, 179).trimEnd()}…`;
}

function amounts(vector: Partial<Resources>): string {
  return RESOURCE_IDS.filter(resource => (vector[resource] ?? 0) > 0)
    .map(resource => `${exactNumber(vector[resource] ?? 0)} ${METRIC_LABELS[resource]}`).join(', ');
}

function metricLabel(field: string): string | null {
  return Object.hasOwn(METRIC_LABELS, field) ? METRIC_LABELS[field as keyof typeof METRIC_LABELS] : null;
}

function effectText(state: StoryNames, effect: string): string | null {
  const change = new RegExp(`^(.+) (\\w+) (${NUMBER}) → (${NUMBER})$`).exec(effect);
  if (change) {
    const label = metricLabel(change[2]!);
    if (!label) return null;
    const subject = change[1]!.startsWith('Route ') ? 'Trade route' : change[1] === 'City' ? 'Town' : boundedRecord(state, change[1]!);
    return `${subject}: ${label} ${exactNumber(Number(change[3]))} → ${exactNumber(Number(change[4]))}`;
  }
  const paid = new RegExp(`^Paid (${NUMBER}) (\\w+)$`).exec(effect);
  if (paid && metricLabel(paid[2]!)) return `Paid ${exactNumber(Number(paid[1]))} ${metricLabel(paid[2]!)}`;
  const capacity = new RegExp(`^Seasonal (\\w+) \\+(${NUMBER})(?: when the complete operating recipe is funded)?$`).exec(effect);
  if (capacity && metricLabel(capacity[1]!)) return `${metricLabel(capacity[1]!)} capacity +${exactNumber(Number(capacity[2]))} per season; not goods made`;
  const housing = new RegExp(`^Completed housing capacity \\+(${NUMBER})$`).exec(effect);
  if (housing) return `Housing capacity +${exactNumber(Number(housing[1]))}; not new residents`;
  if (/^Route \S+ active true → false$/.test(effect)) return 'The affected trade route stopped';
  return null;
}

function recordedEffects(state: StoryNames, event: GameEvent, limit = 4): string {
  const facts = event.effects.flatMap(effect => effectText(state, effect) ?? []);
  return facts.length ? `${facts.slice(0, limit).join('; ')}.` : DETAILS;
}

function shortage(value: string): string | null {
  const parts = value.split(', ').map(part => new RegExp(`^(\\w+) (${NUMBER})/(${NUMBER})$`).exec(part));
  if (!parts.length || parts.some(part => !part || !metricLabel(part[1]!))) return null;
  return parts.map(part => `${metricLabel(part![1]!)}: ${exactNumber(Number(part![2]))} available of ${exactNumber(Number(part![3]))} needed then`).join('; ');
}

function recordedReason(state: StoryNames, reason: string): string {
  const contribution = /^Civilization (\d+) contribution shortage: (.+)$/.exec(reason);
  const trade = /^(?:Combined cargo and upkeep|Strategic cargo(?: and fuel)?) shortage: (.+)$/.exec(reason);
  const missing = shortage(contribution?.[2] ?? trade?.[1] ?? '');
  if (missing) return `${contribution ? `${civilization(state, Number(contribution[1]))} could not fund its share. ` : ''}${missing}.`;
  const damage = new RegExp(`^Route damage (${NUMBER}) prevents transport$`).exec(reason);
  if (damage) return `Route damage was ${exactNumber(Number(damage[1]))}; the shipment could not pass then.`;
  const explicit = /^Civilization (\d+) explicitly (cancelled|declined) the charter$/.exec(reason);
  if (explicit) return `${civilization(state, Number(explicit[1]))} ${explicit[2]} the joint repair.`;
  const expired = /^Consent window ended at round (\d+)$/.exec(reason);
  if (expired) return `The offer expired in round ${expired[1]} without agreement.`;
  if (reason === 'Both complete contributions paid after ordinary production, upkeep and trade') return 'Both partners paid their full share after the season’s other costs.';
  if (reason === 'The exact route is already fully repaired') return 'The route was already repaired then.';
  if (/^Route \S+ is missing$/.test(reason)) return 'The agreed route no longer existed then.';
  if (/^Route \S+ consent is stopped$/.test(reason)) return 'Permission to use the route had ended.';
  if (reason === 'The bound route agreement was replaced') return 'The original trade agreement had been replaced.';
  if (reason === 'Route participants no longer match the charter') return 'The route no longer joined the agreed partners.';
  if (reason === 'An owned route endpoint is missing') return 'One of the agreed towns was missing then.';
  if (reason === 'The proposer endpoint no longer exists' || reason === 'The recipient endpoint no longer exists') return 'One of the agreed towns no longer existed then.';
  const requirement = /^Civilization (\d+) lacks (?:an owned )?([a-z0-9-]+)$/.exec(reason);
  if (requirement) {
    const name = [...BUILDINGS, ...TECHNOLOGIES].find(item => item.id === requirement[2])?.name;
    if (name) return `${civilization(state, Number(requirement[1]))} did not have ${name} then.`;
  }
  return reason ? `At that time: ${boundedRecord(state, reason)}` : '';
}

function exactEffects(event: GameEvent, patterns: readonly RegExp[]): RegExpExecArray[] | null {
  if (event.effects.length !== patterns.length) return null;
  const matches = patterns.map((pattern, index) => pattern.exec(event.effects[index]!));
  return matches.every((match): match is RegExpExecArray => match !== null) ? matches : null;
}

function recordedAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function governmentPolicies(detail: string, government: (typeof GOVERNMENTS)[number]): string | null {
  if (detail === 'All policy slots explicitly empty') return 'No policies were selected.';
  const used = new Set<string>(); const occupied = new Set<string>(); const groups = new Set<string>(); const names: string[] = []; const priorities: string[] = [];
  for (const part of detail.split(', ')) {
    const assignment = /^(military|economic|diplomatic|wildcard):(\d+) ([a-z0-9-]+)$/.exec(part);
    if (!assignment) return null;
    const slot = assignment[1] as keyof typeof government.slots;
    const index = Number(assignment[2]); const policy = POLICIES.find(candidate => candidate.id === assignment[3]);
    const key = `${slot}:${index}`;
    if (!policy || !Number.isSafeInteger(index) || index >= government.slots[slot] || used.has(policy.id) || occupied.has(key)
      || slot !== 'wildcard' && slot !== policy.slotType || policy.exclusiveGroup !== undefined && groups.has(policy.exclusiveGroup)) return null;
    used.add(policy.id); occupied.add(key); names.push(policy.name);
    if (policy.exclusiveGroup) groups.add(policy.exclusiveGroup);
    if (policy.institutionalSciencePercent) {
      const alternatives = policy.exclusiveGroup ? POLICIES.filter(candidate => candidate.id !== policy.id && candidate.exclusiveGroup === policy.exclusiveGroup).map(candidate => candidate.name) : [];
      priorities.push(`Economic priority: paid, staffed learning${alternatives.length ? ` instead of ${alternatives.join(' or ')}` : ''}.`);
    } else if (policy.constructionWork > 0) priorities.push('Economic priority: faster construction.');
  }
  return `Policies: ${names.join(', ')}.${priorities.length ? ` ${priorities.join(' ')}` : ''}`;
}

function historicalStory(state: StoryNames, event: GameEvent): StoryLanguage | null {
  if (['civic-started', 'civic-completed', 'arrangement-accepted', 'transition-completed', 'research-started', 'research-completed'].includes(event.type)
    && (event.actor === null || event.actor !== event.target)) return null;
  const actor = civilization(state, event.actor);
  if (event.type === 'civic-started' && event.cause === 'The civilization explicitly selected a released cultural commitment') {
    const facts = exactEffects(event, [/^Civic ([a-z0-9-]+)$/, new RegExp(`^Required Culture (${NUMBER})$`), /^Science research remains independent$/]);
    const civic = CIVICS.find(candidate => candidate.id === facts?.[0]?.[1]); const required = recordedAmount(facts?.[1]?.[1]);
    if (civic && required !== null) return { title: `${actor} began developing ${civic.name}`, cause: '',
      consequence: `${exactNumber(required)} Culture was required. This civic was not complete yet.` };
  }
  if (event.type === 'civic-completed') {
    const facts = exactEffects(event, [/^Completed civic ([a-z0-9-]+)$/, /^One latest-completion reform entitlement; no automatic successor or arrangement$/]);
    const civic = CIVICS.find(candidate => candidate.id === facts?.[0]?.[1]);
    const funded = new RegExp(`^Civic ([a-z0-9-]+) received (${NUMBER}) Culture$`).exec(event.cause);
    const culture = recordedAmount(funded?.[2]);
    if (civic && funded?.[1] === civic.id && culture !== null) return { title: `${actor} completed ${civic.name}`,
      cause: `${exactNumber(culture)} Culture from working towns completed the civic.`,
      consequence: 'One free government or policy change was earned; none happened automatically.' };
  }
  if (event.type === 'arrangement-accepted' && event.cause === 'The civilization explicitly chose a complete eligible government arrangement') {
    const facts = exactEffects(event, [/^Government ([a-z0-9-]+)$/, new RegExp(`^Credits paid (${NUMBER})$`), /^Reform completion (?:none|\d+:\d+)$/, /^(Transition completes after|Policy commitment until) round (\d+)$/]);
    const government = GOVERNMENTS.find(candidate => candidate.id === facts?.[0]?.[1]); const paid = recordedAmount(facts?.[1]?.[1]);
    const round = Number(facts?.[3]?.[2]); const policies = government ? governmentPolicies(event.detail, government) : null;
    if (government && paid !== null && policies !== null && Number.isSafeInteger(round)) {
      const pending = facts?.[3]?.[1] === 'Transition completes after';
      return { title: `${actor} chose ${government.name}`, cause: '',
        consequence: `${pending ? `The change was scheduled after round ${round}; it had not finished yet. ` : ''}${policies} Paid ${exactNumber(paid)} Credits.${pending ? '' : ` Policies were committed until round ${round}.`}` };
    }
  }
  if (event.type === 'transition-completed') {
    const identity = /^Government ([a-z0-9-]+) applies at the next opening$/.exec(event.detail);
    const government = GOVERNMENTS.find(candidate => candidate.id === identity?.[1]);
    const accepted = /^The two-beat transition accepted at round (\d+) completed$/.exec(event.cause);
    const facts = exactEffects(event, [/^Effective round (\d+)$/, /^Commitment until round (\d+)$/]);
    if (government && accepted && facts && [accepted[1], facts[0]![1], facts[1]![1]].every(value => Number.isSafeInteger(Number(value)))) {
      return { title: `${actor} completed the change to ${government.name}`, cause: `The change began in round ${accepted[1]}.`,
        consequence: `${government.name} was ready for the next season, effective round ${facts[0]![1]}. The government was committed until round ${facts[1]![1]}.` };
    }
  }
  if (event.type === 'research-started') {
    const facts = exactEffects(event, [/^Research target ([a-z0-9-]+)$/]);
    const technology = TECHNOLOGIES.find(candidate => candidate.id === facts?.[0]?.[1] && candidate.id === event.detail);
    const productive = event.cause === 'The civilization committed science produced by its settlements each strategic beat to a released technology';
    const stored = event.cause === 'The civilization committed its accumulated and future science to a released technology';
    if (technology && (productive || stored)) return { title: `${actor} began researching ${technology.name}`,
      cause: productive ? 'The towns’ future Science output was assigned to this research.' : 'Stored and future Science was assigned to this research.',
      consequence: 'Research began; the discovery was not complete yet.' };
  }
  if (event.type === 'research-completed') {
    const facts = exactEffects(event, [/^Technology ([a-z0-9-]+) unlocked$/, /^Capability stages require released milestones; the world clock is independent$/]);
    const technology = TECHNOLOGIES.find(candidate => candidate.id === facts?.[0]?.[1]);
    if (technology) {
      const science = new RegExp(`^Working settlements supplied (${NUMBER}) science to the research program$`).exec(event.cause);
      const amount = recordedAmount(science?.[1]);
      const boosted = new RegExp(`^Recorded research progress (${NUMBER}) and an explicit (${NUMBER}) wonder boost completed this discovery without further science payment$`).exec(event.cause);
      const progress = recordedAmount(boosted?.[1]); const boost = recordedAmount(boosted?.[2]);
      const cause = amount !== null ? `Settlements supplied ${exactNumber(amount)} Science for the discovery.`
        : progress !== null && boost !== null ? `${exactNumber(progress)} recorded research work and a ${exactNumber(boost)} wonder boost completed the discovery. No further Science was paid.`
          : boundedRecord(state, event.cause);
      return { title: `${actor} discovered ${technology.name}`, cause, consequence: 'Research completed. Building and production are separate steps.' };
    }
  }
  if (event.type === 'history-milestone') {
    const facts = exactEffects(event, [/^Capability stage (\d+) attained in year (-?\d+)$/, /^Historical milestone ([a-z0-9-]+) recorded$/]);
    const milestone = HISTORICAL_MILESTONES.find(candidate => candidate.id === facts?.[1]?.[1]);
    const stage = Number(facts?.[0]?.[1]); const year = Number(facts?.[0]?.[2]); const era = ERAS[stage];
    if (milestone && era && stage === milestone.era && Number.isSafeInteger(year)
      && event.cause === `Released features ${milestone.requiredFeatures.join(', ')} and observed world conditions satisfied ${milestone.id}`) {
      return { title: milestone.name, cause: '', consequence: `${era.name} was reached in ${formatYear(year)}; the calendar was unchanged.` };
    }
  }
  if (event.type === 'history-advanced') {
    const reason = /^(milestone|feature) ([a-z0-9-]+) justified an explicit advancement at (\S+)$/.exec(event.cause);
    const definition = (reason?.[1] === 'milestone' ? HISTORICAL_MILESTONES : FEATURES).find(candidate => candidate.id === reason?.[2]);
    const facts = exactEffects(event, [/^Calendar (-?\d+) → (-?\d+)$/, /^Reason: ([\s\S]+)$/, /^Authoritative clock accounting and released capabilities remain unchanged$/]);
    const before = Number(facts?.[0]?.[1]); const after = Number(facts?.[0]?.[2]); const added = after - before;
    if (reason && definition && parseUtcTimestamp(reason[3]!) !== null && facts?.[1]?.[1] === event.detail
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && Number.isSafeInteger(added) && added >= 0) {
      return { title: before === after ? `The calendar stayed at ${formatYear(after)}` : `The calendar reached ${formatYear(after)}`,
        cause: reason[1] === 'milestone' ? `${definition.name} was the recorded milestone.` : `${definition.name} was the recorded reason for this calendar change.`,
        consequence: `${formatYear(before)} → ${formatYear(after)}. ${exactNumber(added)} years added; available capabilities did not change.` };
    }
  }
  return null;
}

function regionalStory(state: StoryNames, event: GameEvent, fallback: EventLogEntry): StoryLanguage | null {
  const labels: Record<string, string> = {
    'cultivated-harvest': 'Extra harvest', 'forest-fire': 'Forest fire', 'coastal-storm': 'Coastal storm',
    'trade-fair': 'Trade fair', 'industrial-accident': 'Industrial accident', 'internal-migration': 'Residents moved',
  };
  const label = labels[event.type];
  if (!label) return null;
  const identity = /\(([^()]+)\) (?:has completed Terraced fields|,?inhabited by|stands on ocean-adjacent|hosts a fair|has an enabled|has Damage)/.exec(event.cause)
    ?? /\(([^()]+)\), inhabited by/.exec(event.cause);
  const name = town(state, identity?.[1]);
  let cause = boundedRecord(state, event.cause);
  if (event.type === 'coastal-storm' && /\([^()]+\) stands on ocean-adjacent tile \d+; the storm strikes this town/.test(event.cause)) {
    cause = `${name} stood on the coast.${/ and its exact active endpoint route \S+$/.test(event.cause) ? ' Its trade route was also struck.' : ''}`;
  } else if (event.type === 'forest-fire' && /adjoins forest tile \d+; the fire's repairable damage is confined to this town$/.test(event.cause)) {
    cause = `${name} stood beside a forest; the fire damaged this town.`;
  } else if (event.type === 'cultivated-harvest' && /has completed Terraced fields \(farm\) on owned grassland tile \d+; three Materials fund the extra cultivated harvest$/.test(event.cause)) {
    cause = `${name} had completed fields on grassland; Materials paid for an extra harvest.`;
  } else if (event.type === 'trade-fair' && /hosts a fair on working route \S+, which actually delivered .+ cargo in round \d+; four Food and two Materials fund the gathering, not another shipment$/.test(event.cause)) {
    cause = `${name} hosted a fair after an earlier delivery; Food and Materials paid for it.`;
  } else if (event.type === 'industrial-accident') {
    const industry = /has an enabled ([a-z0-9-]+) with actual operated output in current round \d+; the accident damages only this operating town$/.exec(event.cause);
    const building = BUILDINGS.find(item => item.id === industry?.[1]);
    if (industry) cause = `${building?.name ?? 'An industrial building'} had produced output in ${name}; the accident damaged that town.`;
  } else if (event.type === 'internal-migration') {
    const destination = /residents move to same-civilization .+ \(([^()]+)\), with Damage/.exec(event.cause);
    if (destination) cause = `Residents left ${name} for ${town(state, destination[1])}, which had room and safer conditions then.`;
  }
  const suffix = event.type === 'trade-fair' ? ' No new shipment.' : event.type === 'internal-migration' ? ' No new residents were created.' : '';
  const effects = recordedEffects(state, event, 6);
  return { title: `${label} · ${identity ? name : civilization(state, event.target)}`, cause,
    consequence: `${effects === DETAILS && fallback.summary ? boundedRecord(state, fallback.summary) : effects}${suffix}` };
}

export function storyLanguage(state: StoryNames, event: GameEvent, fallback: EventLogEntry): StoryLanguage {
  const crew = civicWorksStory(event, id => town(state, id));
  if (crew) return { title: crew.title, cause: crew.cause, consequence: crew.summary };
  const knowledge = knowledgeStory(event);
  if (knowledge) return knowledge;
  const historical = historicalStory(state, event);
  if (historical) return historical;
  const actor = civilization(state, event.actor); const target = civilization(state, event.target);
  const relief = event.reliefResult;
  if (relief?.eventId === event.id && event.type === `relief-${relief.outcome}` && event.detail === relief.charter.id) {
    const donor = civilization(state, relief.charter.terms.donorId); const recipient = civilization(state, relief.charter.terms.recipientId);
    const labels = { delivered: 'Food relief delivered', declined: 'Food relief declined', withdrawn: 'Food relief withdrawn', expired: 'Relief offer expired', failed: 'Food relief could not proceed' };
    const cause = relief.outcome === 'delivered' ? 'Both partners had consented; the donor funded the complete agreed transfer.'
      : relief.outcome === 'declined' ? `${civilization(state, relief.actor)} declined the offer.`
        : relief.outcome === 'withdrawn' ? `${civilization(state, relief.actor)} withdrew from the charter.`
          : relief.outcome === 'expired' ? 'The consent window ended without agreement.' : boundedRecord(state, relief.reason);
    return { title: `${donor} → ${recipient} · ${labels[relief.outcome]}`, cause,
      consequence: relief.outcome === 'delivered' ? `${exactNumber(relief.deliveredFood)} Food moved from ${donor}’s civilization reserves to ${recipient}’s; ${exactNumber(relief.paid.energy)} Energy consumed.`
        : 'No aid was delivered. This charter charged no supplies or penalty.' };
  }
  if (event.type === 'relief-proposed') return { title: `${actor} offered Food relief to ${target}`, cause: 'The recipient needed Food when this offer was made.', consequence: 'Recipient consent was still required. No aid was delivered or paid for by this offer.' };
  if (event.type === 'relief-accepted') {
    const due = event.effects.flatMap(effect => /^Full transfer is due round (\d+); no payment occurred at acceptance$/.exec(effect)?.[1] ?? [])[0];
    return { title: `${actor} accepted Food relief from ${target}`, cause: 'Both partners agreed to the exact offered amount.',
      consequence: `${due ? `The transfer was scheduled for round ${due}. ` : ''}No aid was delivered or paid for by this acceptance.` };
  }
  const result = recordedPublicProjectResult(event);
  if (result) {
    const labels = { completed: 'Joint repair completed', failed: 'Joint repair failed', 'no-work-needed': 'No repair needed', declined: 'Repair declined', cancelled: 'Repair cancelled', expired: 'Repair offer expired' };
    const proposer = civilization(state, result.proposer); const recipient = civilization(state, result.recipient);
    const firstPaid = amounts(result.proposerPaid); const secondPaid = amounts(result.recipientPaid);
    const payment = firstPaid || secondPaid ? `${proposer} paid ${firstPaid || 'nothing'}; ${recipient} paid ${secondPaid || 'nothing'}.` : 'No supplies paid.';
    const damage = result.damageBefore === null || result.damageAfter === null ? 'Damage was not recorded.' : `Route damage ${exactNumber(result.damageBefore)} → ${exactNumber(result.damageAfter)}.`;
    return { title: `${labels[result.outcome]} · ${proposer} + ${recipient}`, cause: recordedReason(state, result.reason), consequence: `${damage} ${payment} No cargo delivered.` };
  }
  if (event.type === 'public-project-proposed') return { title: `${actor} offered a joint repair to ${target}`, cause: 'The partners had not yet agreed to the repair.', consequence: 'No supplies paid. No repair or cargo delivered.' };
  if (event.type === 'public-project-committed') return { title: `${actor} agreed to repair with ${target}`, cause: 'Both partners agreed to share the repair.', consequence: 'No supplies paid yet. No repair or cargo delivered by this agreement.' };
  if (event.type === 'trade-proposed') return { title: `${actor} offered trade to ${target}`, cause: 'A trade offer was sent for the partner to consider.', consequence: 'Agreement was still needed. No cargo delivered.' };
  if (event.type === 'trade-accepted') {
    const due = event.effects.flatMap(effect => /^First due shipment: round (\d+)$/.exec(effect)?.[1] ?? [])[0];
    return { title: `${actor} agreed to trade with ${target}`, cause: 'Both partners agreed to the exchange.', consequence: `No cargo delivered by this agreement.${due ? ` First shipment due in round ${due}.` : ''}` };
  }
  if (event.type === 'trade-blocked') return { title: 'A shipment could not depart', cause: recordedReason(state, event.cause), consequence: 'No cargo delivered. Supplies and trade income were unchanged.' };
  if (event.type === 'trade-delivered') {
    const cargo = event.effects.flatMap(effect => new RegExp(`^(${NUMBER}) cargo exchanged atomically$`).exec(effect)?.[1] ?? [])[0];
    const cause = /^Accepted offer \S+ reached strategic round \d+ with both combined obligations supplied$/.test(event.cause)
      ? 'Both partners supplied the agreed cargo and transport costs.' : boundedRecord(state, event.cause);
    return { title: event.target !== null && event.actor !== event.target ? `${actor} and ${target} exchanged cargo` : fallback.title, cause,
      consequence: `${cargo === undefined ? 'A completed cargo exchange was recorded.' : `${exactNumber(Number(cargo))} cargo exchanged.`}${event.effects.includes('Agreed upkeep consumed and commerce credited') ? ' Transport costs were paid and trade income received.' : ''}` };
  }
  const regional = regionalStory(state, event, fallback);
  if (regional) return regional;
  if (event.type === 'city-repaired') {
    const id = /^Only (\S+) was repaired using shared civilization supplies$/.exec(event.detail)?.[1];
    return { title: `${town(state, id)} repaired damage`, cause: event.cause === 'Materials and energy were committed to settlement recovery' ? 'Materials and Energy paid for local repairs.' : boundedRecord(state, event.cause), consequence: recordedEffects(state, event) };
  }
  if (event.type === 'world-founded') {
    const match = event.effects.map(effect => /^(\d+) civilizations and (\d+) working (capitals|settlements) created$/.exec(effect)).find(Boolean);
    return { title: fallback.title, cause: 'A new world began.', consequence: match ? `${match[1]} civilizations founded ${match[2]} ${match[3] === 'capitals' ? 'capitals' : 'settlements'}.` : DETAILS };
  }
  if (event.type === 'settlement-founded' || event.type === 'coastal-founded') {
    const coastal = event.type === 'coastal-founded' && event.coastalFounding?.eventId === event.id && event.coastalFounding.foundedRound === event.round && event.coastalFounding.destinationTileId === event.tileId ? event.coastalFounding : null;
    const moved = event.effects.map(effect => new RegExp(`^Source (\\S+) population -(${NUMBER}); (${NUMBER}) remain$`).exec(effect)).find(Boolean);
    const population = event.effects.flatMap(effect => /^Population (\d+)$/.exec(effect)?.[1] ?? [])[0];
    const cause = coastal ? `${exactNumber(coastal.population)} residents moved from ${town(state, coastal.sourceCityId)} by sea.`
      : moved ? `${exactNumber(Number(moved[2]))} residents moved from ${town(state, moved[1])} to found a new town.`
        : event.cause === 'The released expansion capability and a paid investment made a nearby site habitable' ? 'People and supplies established a new town.' : boundedRecord(state, event.cause);
    const paid = coastal ? amounts(coastal.paid) : '';
    return { title: fallback.title.replace(' is founded', ' was founded'), cause,
      consequence: `${coastal ? `${exactNumber(coastal.population)} residents settled.` : population ? `${population} residents settled.` : DETAILS}${moved ? ` ${exactNumber(Number(moved[3]))} remained in the source town.` : ''}${paid ? ` Paid ${paid}.` : ''}` };
  }
  if (event.type === 'building-completed') {
    const effects = recordedEffects(state, event);
    return { title: boundedRecord(state, fallback.title), cause: event.cause === 'Known technology and a paid material investment enabled this construction' ? 'Research and paid materials made construction possible.' : boundedRecord(state, event.cause), consequence: effects === DETAILS ? 'Construction finished. Production is recorded separately.' : effects };
  }
  return { title: boundedRecord(state, fallback.title), cause: boundedRecord(state, fallback.cause), consequence: boundedRecord(state, fallback.summary || fallback.effects.slice(0, 2).join(' ')) };
}
