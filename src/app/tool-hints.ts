/** Marks a tool's first-use hint per campaign, without changing the portable save format. */
export function takeToolHint(campaign: string, tool: "trap" | "chum"): boolean {
  const key = `fishy.hint.${campaign}.${tool}`;
  if (seen.has(key)) return false;
  seen.add(key);
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "1");
  } catch { /* A blocked store still gets one hint per visit. */ }
  return true;
}

const seen = new Set<string>();
