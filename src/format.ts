export function formatMoney(amount: number): string {
  return `$${Math.floor(amount).toLocaleString("en-US")}`;
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
