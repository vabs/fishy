/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** A #rrggbb colour as "r, g, b", for rgba() colours whose alpha changes every frame. */
export function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}
