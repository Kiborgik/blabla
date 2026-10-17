import { RESEARCH_INVESTMENT_RULES } from '../core/content.ts';
import type { GameEvent } from '../core/types.ts';

export interface ResearchProgressInput {
  unlockedFeatures: readonly string[];
  civilizationId: number;
  project: { name: string; progress: number; cost: number } | null;
  events?: readonly GameEvent[];
}

export interface ResearchProgressPresentation {
  mode: 'productive' | 'reserve';
  heading: string;
  progress: string | null;
  remaining: string | null;
  explanation: string;
  lastOutput: { science: number; round: number; eventId: string; label: string } | null;
  outputExplanation: string;
}

function number(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function recordedOutput(input: ResearchProgressInput): ResearchProgressPresentation['lastOutput'] {
  const event = input.events?.findLast(candidate => candidate.type === 'settlement-production' && candidate.actor === input.civilizationId);
  if (!event) return null;
  const matches = event.effects.flatMap(effect => {
    const match = /^Produced (\d+(?:\.\d{1,2})?) science$/.exec(effect);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  const science = matches[0];
  if (matches.length !== 1 || science === undefined || !Number.isFinite(science)) return null;
  return { science, round: event.round, eventId: event.id, label: `Last recorded city output: ${number(science)} Science · Round ${event.round}` };
}

export function researchProgressPresentation(input: ResearchProgressInput): ResearchProgressPresentation {
  const productive = input.unlockedFeatures.includes(RESEARCH_INVESTMENT_RULES.featureId);
  const project = input.project;
  return {
    mode: productive ? 'productive' : 'reserve',
    heading: project ? `Researching ${project.name}` : 'No active research',
    progress: project ? `${number(project.progress)} / ${number(project.cost)} Science` : null,
    remaining: project ? `${number(Math.max(0, Math.round((project.cost - project.progress) * 100) / 100))} Science remaining` : null,
    explanation: productive
      ? `${project ? 'This project advances' : 'When a project is active, it advances'} from science made by its towns each economy beat, up to the available science and remaining work. Stored reserves do not speed it up.`
      : 'Science is invested as research progresses. It is not a selection price.',
    lastOutput: recordedOutput(input),
    outputExplanation: 'This is past production, not the amount invested in this project. Town output can change; it is not a forecast.',
  };
}
