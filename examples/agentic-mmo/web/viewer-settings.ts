import { EFFECT_DESCRIPTIONS, VIEWER_PALETTES, resolveAppearance } from './viewer-appearance.ts';
import type { ViewerPreferences } from './viewer-state.ts';

export function mountViewerSettings(
  dialog: HTMLDialogElement,
  read: () => ViewerPreferences,
  change: (value: Pick<ViewerPreferences, 'theme' | 'effects'>) => void,
  motion: (enabled: boolean) => void,
): { refresh: () => void } {
  const theme = dialog.querySelector<HTMLSelectElement>('#viewer-theme');
  const effects = dialog.querySelector<HTMLSelectElement>('#viewer-effects');
  const explanation = dialog.querySelector<HTMLElement>('#effects-explanation');
  const systemNote = dialog.querySelector<HTMLElement>('#system-motion-note');
  if (!theme || !effects || !explanation || !systemNote) throw new Error('Viewer settings controls are missing');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const refresh = (): void => {
    const preferences = read();
    const appearance = resolveAppearance(preferences, dark.matches, reduced.matches);
    const root = document.documentElement;
    root.dataset['theme'] = appearance.theme;
    root.dataset['effects'] = appearance.effects;
    root.style.colorScheme = appearance.theme;
    for (const [name, value] of Object.entries(VIEWER_PALETTES[appearance.theme])) root.style.setProperty(`--${name}`, value);
    theme.value = preferences.theme;
    effects.value = preferences.effects;
    explanation.textContent = EFFECT_DESCRIPTIONS[appearance.effects];
    systemNote.hidden = !reduced.matches;
    motion(appearance.motion);
  };
  const changed = (): void => {
    const nextTheme = theme.value;
    const nextEffects = effects.value;
    if ((nextTheme !== 'light' && nextTheme !== 'dark' && nextTheme !== 'system') ||
      (nextEffects !== 'calm' && nextEffects !== 'rich' && nextEffects !== 'cinematic')) return;
    change({ theme: nextTheme, effects: nextEffects });
    refresh();
  };
  theme.addEventListener('change', changed);
  effects.addEventListener('change', changed);
  dark.addEventListener('change', refresh);
  reduced.addEventListener('change', refresh);
  refresh();
  return { refresh };
}
