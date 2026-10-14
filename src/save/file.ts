import type { SaveData } from "./model";

const pad = (n: number): string => String(n).padStart(2, "0");

/** `fishy-<name>-<YYYY-MM-DD>.json` (local date), with the name cut down to file-name-safe characters. */
export function saveFileName(playerName: string, date = new Date()): string {
  const name =
    playerName
      .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || "player";
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `fishy-${name}-${day}.json`;
}

export function serializeSave(save: SaveData): string {
  return `${JSON.stringify(save, null, 2)}\n`;
}

/** Downloads the save as a JSON file. Browser only. */
export function exportSave(save: SaveData): void {
  const url = URL.createObjectURL(new Blob([serializeSave(save)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = saveFileName(save.playerName);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download asynchronously, so don't revoke the URL straight away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
