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
