export function formatMoney(amount: number): string {
  return `$${Math.floor(amount).toLocaleString("en-US")}`;
}

/**
 * Whole-dollar shares of `total` for each of `parts`, rounded so they add up to floor(total) exactly
 * (largest remainders get the leftover dollars). Keeps a breakdown consistent with its total.
 */
export function wholeShares(parts: readonly number[], total: number): number[] {
  const floors = parts.map((part) => Math.floor(part));
  let left = Math.floor(total) - floors.reduce((sum, n) => sum + n, 0);
  const byRemainder = parts.map((part, i) => ({ i, rest: part - Math.floor(part) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i]! += 1;
    left--;
  }
  return floors;
}

/** "1 h 12 min", "4 min 05 s", "38 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}
