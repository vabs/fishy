/** A padlock that remains legible without relying on a font's symbol coverage. */
export const PADLOCK_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10V7a4 4 0 0 1 8 0v3"/><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M12 14v3"/></svg>';

/** A clear three-channel mixer for the volume controls and their gallery preview. */
export const MIXER_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 3v7m0 6v5M12 3v2m0 6v10M19 3v10m0 6v2"/><circle cx="5" cy="13" r="3"/><circle cx="12" cy="8" r="3"/><circle cx="19" cy="16" r="3"/></svg>';

/** Weather glyph paths (24px grid, round strokes), shared by the hub badge, banners and summary ledger. */
export const WEATHER_PATHS = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  storm: '<path d="M5 13a4 4 0 0 1 0-8 6 6 0 0 1 11-1 5 5 0 0 1 2 9M12 10l-4 7h5l-2 5M4 17l-1 3M20 17l-1 3"/>',
  fog: '<path d="M5 10a4 4 0 0 1 0-8 6 6 0 0 1 11 0 4 4 0 0 1 3 8M3 14h18M6 18h12M3 22h18"/>',
  bloom: '<path d="M12 21V9M12 15C3 15 2 8 3 5c7 0 9 4 9 10ZM12 19c9 0 10-7 9-10-7 0-9 4-9 10Z"/>',
} as const;

/** An inline SVG weather icon. Unicode weather symbols render as emoji or empty boxes on some phones. */
export function weatherIcon(state: keyof typeof WEATHER_PATHS, size = 18): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${WEATHER_PATHS[state]}</svg>`;
}
