import type { GameEvent } from '../core/types.ts';
import { METRIC_LABELS } from './visual-language.ts';
import type { VisualIcon, VisualMetric } from './visual-language.ts';

export interface VisualDelta {
  icon: VisualMetric;
  label: string;
  value: number;
  kind: 'delta' | 'rate' | 'total';
  tone: 'positive' | 'negative' | 'neutral';
  qualifier: string;
  subject: string | null;
}

export interface VisualEvent {
  eventId: string;
  tileId: number | null;
  actor: number | null;
  target: number | null;
  label: string;
  detail: string;
  cue: 'dry-wind' | 'construction' | 'growth' | 'production' | 'discovery' | 'warning' | 'delivery';
  icon: VisualIcon;
  durationMs: number;
  deltas: VisualDelta[];
  importance: number;
}

const EVENT_MARKS: Record<string, Pick<VisualEvent, 'label' | 'cue' | 'icon'>> = {
  drought: { label: 'Dry season', cue: 'dry-wind', icon: 'drought' },
  'building-completed': { label: 'New building', cue: 'construction', icon: 'infrastructure' },
  'settlement-founded': { label: 'New settlement', cue: 'construction', icon: 'infrastructure' },
  'population-growth': { label: 'More people', cue: 'growth', icon: 'population' },
  'settlement-production': { label: 'Resources produced', cue: 'production', icon: 'food' },
  'research-completed': { label: 'Discovery', cue: 'discovery', icon: 'discovery' },
  'supply-shortage': { label: 'Food shortage', cue: 'warning', icon: 'food' },
  earthquake: { label: 'Earthquake', cue: 'warning', icon: 'damage' },
  'resource-boom': { label: 'New supplies', cue: 'discovery', icon: 'materials' },
  'trade-delivered': { label: 'Cargo delivered', cue: 'delivery', icon: 'cargo' },
  'trade-blocked': { label: 'Trade stopped', cue: 'warning', icon: 'cargo' },
};

function isVisualMetric(value: string): value is VisualMetric {
  return Object.hasOwn(METRIC_LABELS, value);
}

function metric(value: string | undefined): VisualMetric | null {
  const lower = value?.toLowerCase();
  return lower && isVisualMetric(lower) ? lower : null;
}

function delta(icon: VisualMetric, value: number, kind: VisualDelta['kind'], subject: string | null = null): VisualDelta | null {
  if (!Number.isFinite(value)) return null;
  const direction = icon === 'damage' ? -value : value;
  const tone = kind === 'total' || value === 0 ? 'neutral' : direction > 0 ? 'positive' : 'negative';
  return { icon, label: METRIC_LABELS[icon], value: Math.round(value * 100) / 100, kind, subject, tone,
    qualifier: kind === 'rate' ? 'base / season' : icon === 'wellbeing' || icon === 'damage' ? 'points' : '' };
}

function effectDelta(effect: string): VisualDelta | null {
  const change = /^(.*?) (\w+) (-?\d+(?:\.\d+)?) → (-?\d+(?:\.\d+)?)$/.exec(effect);
  if (change) {
    const icon = metric(change[2]);
    return icon ? delta(icon, Number(change[4]) - Number(change[3]), 'delta', change[1] ?? null) : null;
  }
  const seasonal = /^Seasonal (\w+) \+(\d+(?:\.\d+)?)$/.exec(effect);
  if (seasonal) {
    const icon = metric(seasonal[1]);
    return icon ? delta(icon, Number(seasonal[2]), 'rate') : null;
  }
  const produced = /^Produced (\d+(?:\.\d+)?) (\w+)$/.exec(effect);
  if (produced) {
    const icon = metric(produced[2]);
    return icon ? delta(icon, Number(produced[1]), 'delta') : null;
  }
  const signed = /^(\w+) ([+-]\d+(?:\.\d+)?)$/.exec(effect);
  if (signed) {
    const icon = metric(signed[1]);
    return icon ? delta(icon, Number(signed[2]), 'delta') : null;
  }
  const total = /^Population (\d+)$/.exec(effect);
  if (total) return delta('population', Number(total[1]), 'total');
  const cargo = /^(\d+(?:\.\d+)?) cargo exchanged atomically$/.exec(effect);
  return cargo ? delta('cargo', Number(cargo[1]), 'total') : null;
}

export function eventVisual(event: GameEvent): VisualEvent | null {
  const mark = EVENT_MARKS[event.type];
  if (!mark) return null;
  return {
    ...mark, eventId: event.id, tileId: event.tileId, actor: event.actor, target: event.target,
    detail: event.detail, importance: event.importance, durationMs: mark.cue === 'dry-wind' ? 3200 : 2600,
    deltas: event.effects.flatMap((effect) => { const parsed = effectDelta(effect); return parsed ? [parsed] : []; }).slice(0, 4),
  };
}

export function createEventCueTracker(): { observe: (identity: string, events: readonly GameEvent[]) => VisualEvent[] } {
  let run: string | null = null;
  let seen = new Set<string>();
  return {
    observe: (identity, events) => {
      const previous = seen;
      const window = events.slice(-96);
      seen = new Set(window.map((event) => event.id));
      if (run !== identity) { run = identity; return []; }
      return window.flatMap((event, index) => {
        if (previous.has(event.id)) return [];
        const visual = eventVisual(event);
        return visual ? [{ visual, index }] : [];
      }).toSorted((a, b) => b.visual.importance - a.visual.importance || b.index - a.index)
        .slice(0, 3).map(({ visual }) => visual);
    },
  };
}
