import type { Resource } from '../core/types.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import type { ViewerPreferences } from './viewer-state.ts';

export const VIEWER_PALETTES = {
  light: {
    paper: '#f6f3e9', panel: '#f6f3e9', ink: '#233c36', muted: '#52634f',
    gold: '#785823', surface: '#e8eadb', border: '#707b62', selection: '#dddcc9',
    positive: '#355b34', 'positive-surface': '#e8efd7',
    negative: '#873e29', 'negative-surface': '#f7e3d3',
    'cue-paper': '#173e45', 'cue-ink': '#f5e6bc', 'cue-border': '#dbc383',
  },
  dark: {
    paper: '#132c30', panel: '#18363a', ink: '#f3e8cd', muted: '#b9c8bb',
    gold: '#e5bf72', surface: '#23464a', border: '#8daba7', selection: '#31565a',
    positive: '#c2e3a5', 'positive-surface': '#254331',
    negative: '#ffc3a2', 'negative-surface': '#542f2a',
    'cue-paper': '#102b31', 'cue-ink': '#f5e6bc', 'cue-border': '#e5bf72',
  },
} as const;

export function resolveAppearance(preferences: Pick<ViewerPreferences, 'theme' | 'effects'>, systemDark: boolean, reducedMotion: boolean): {
  theme: 'light' | 'dark'; effects: ViewerPreferences['effects']; motion: boolean;
} {
  const theme = preferences.theme === 'system' ? systemDark ? 'dark' : 'light' : preferences.theme;
  const effects = reducedMotion ? 'calm' : preferences.effects;
  return { theme, effects, motion: effects !== 'calm' };
}

export const EFFECT_DESCRIPTIONS = {
  calm: 'Still event cards. Changes remain available in history.',
  rich: 'Brief movement when a new event happens.',
  cinematic: 'Brief movement and a local highlight for new events.',
} as const;

const RESOURCE_EXPLANATIONS: Record<Resource, string> = {
  food: 'Food feeds people and supports population growth.',
  materials: 'Materials are used to build and repair.',
  energy: 'Energy supports work, repairs and advanced production.',
  credits: 'Credits pay for construction and other projects.',
  science: 'Science is used to complete discoveries.',
  culture: 'Culture builds influence and supports public trust.',
};

export function resourceGuide(resource: Resource): { label: string; explanation: string } {
  return { label: METRIC_LABELS[resource], explanation: RESOURCE_EXPLANATIONS[resource] };
}
