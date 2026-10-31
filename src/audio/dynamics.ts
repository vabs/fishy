/** Countdown intensity, including a small lift as the final five seconds begin. */
export function urgencyLevel(timeLeft: number, endless = false): number {
  if (endless || !Number.isFinite(timeLeft) || timeLeft <= 0 || timeLeft > 5) return 0;
  return 0.15 + 0.85 * (1 - timeLeft / 5);
}

/** Accented sixteenth roll velocity, or a rest outside the countdown. */
export function urgencyHatForStep(step: number, level: number): number | null {
  if (level <= 0) return null;
  return (0.3 + level * 0.7) * (step % 4 === 0 ? 1 : 0.6);
}

export type MusicMode = "title" | "hub" | "round" | "final" | "endless" | "end";

/** Static mix targets; all modes share the running bed's clock. */
export function mixForMode(mode: MusicMode): { cutoff: number; bed: number; groove: number } {
  switch (mode) {
    case "hub": return { cutoff: 700, bed: 0.5, groove: 0 };
    case "title": return { cutoff: 1400, bed: 0.62, groove: 0 };
    case "end": return { cutoff: 16000, bed: 0.85, groove: 0 };
    case "endless": return { cutoff: 9000, bed: 0.85, groove: 0.62 };
    default: return { cutoff: 16000, bed: 1, groove: 1 };
  }
}
