import { formatMoney } from "../format";
import { exportSave, parseSave, saveFileName, type NodeInfo, type SaveData } from "../save";
import "./dialog.css";
import "./save-controls.css";

/** A save is well under this; anything bigger is refused before it is read into memory. */
const MAX_FILE_BYTES = 1_000_000;

export interface SaveControlsOptions {
  getSave(): SaveData;
  nodes: readonly NodeInfo[];
  /** Called with the imported save after the player confirms. Store it and refresh the game. */
  onImport(save: SaveData): void;
}

let mounts = 0;

/** "Export save" and "Import save" buttons, with an inline message line for results and errors. */
export function mountSaveControls(container: HTMLElement, options: SaveControlsOptions): { destroy(): void } {
  const id = `save-controls-${++mounts}`;
  const root = document.createElement("div");
  root.className = "save-controls";
  root.innerHTML = `
    <div class="save-controls-buttons">
      <button type="button" class="save-controls-button" data-action="export">Export save</button>
      <button type="button" class="save-controls-button" data-action="import">Import save</button>
    </div>
    <input type="file" accept=".json,application/json" hidden />
    <p class="save-controls-message" role="status" aria-live="polite" aria-atomic="true"></p>`;

  const exportButton = root.querySelector<HTMLButtonElement>('[data-action="export"]')!;
  const importButton = root.querySelector<HTMLButtonElement>('[data-action="import"]')!;
  const fileInput = root.querySelector("input")!;
  const message = root.querySelector<HTMLElement>(".save-controls-message")!;
  const confirm = createConfirmDialog(id);
  let destroyed = false;

  const say = (text: string, isError = false): void => {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  };

  exportButton.addEventListener("click", () => {
    const save = options.getSave();
    exportSave(save);
    say(`Downloaded ${saveFileName(save.playerName)}`);
  });

  importButton.addEventListener("click", () => {
    say("");
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    // Clear it so picking the same file again still fires "change".
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return say("This file is too big to be a Fishy save.", true);

    let text: string;
    try {
      text = await file.text();
    } catch {
      return say("That file couldn't be read. Try again.", true);
    }
    if (destroyed) return;

    const result = parseSave(text, options.nodes);
    if (!result.ok) return say(result.error, true);

    const replace = await confirm.ask(options.getSave(), result.save);
    if (destroyed) return;
    importButton.focus();
    if (!replace) return say("Import cancelled. Your save is unchanged.");
    options.onImport(result.save);
    say(`Loaded ${result.save.playerName}'s save.`);
  });

  container.append(root);
  document.body.append(confirm.dialog);

  return {
    destroy() {
      destroyed = true;
      if (confirm.dialog.open) confirm.dialog.close();
      confirm.dialog.remove();
      root.remove();
    },
  };
}

function createConfirmDialog(id: string): {
  dialog: HTMLDialogElement;
  ask(current: SaveData, imported: SaveData): Promise<boolean>;
} {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", `${id}-confirm-title`);
  dialog.setAttribute("aria-describedby", `${id}-confirm-question`);
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="${id}-confirm-title">Import save</h2>
      <p id="${id}-confirm-question"></p>
      <p class="dialog-note">Your current progress will be lost. Export it first if you want to keep it.</p>
      <div class="dialog-actions">
        <button type="submit" value="cancel" class="dialog-button is-secondary" autofocus>Cancel</button>
        <button type="submit" value="replace" class="dialog-button">Replace</button>
      </div>
    </form>`;
  const question = dialog.querySelector<HTMLElement>(`#${id}-confirm-question`)!;

  return {
    dialog,
    ask(current, imported) {
      // Built from text nodes: player names come from a file and must never be parsed as HTML.
      question.replaceChildren(
        "Replace your current save (",
        ...describe(current),
        ") with ",
        ...describe(imported),
        "?",
      );
      dialog.returnValue = "";
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "replace"), { once: true });
      });
    },
  };
}

/** "<name>, round N, $X" with the name in bold. */
function describe(save: SaveData): (Node | string)[] {
  const name = document.createElement("strong");
  name.textContent = save.playerName;
  return [name, `, round ${save.round}, ${formatMoney(save.money)}`];
}
