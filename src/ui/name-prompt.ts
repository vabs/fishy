import { validateName } from "../save";
import "./dialog.css";

let prompts = 0;

/**
 * Asks for the player's name in a modal that can't be dismissed (Escape does nothing) until the name
 * is valid. Resolves with the trimmed name.
 */
export function promptForName(): Promise<string> {
  const id = `name-prompt-${++prompts}`;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  dialog.setAttribute("aria-describedby", `${id}-intro`);
  // Newer browsers: no light dismiss and no Escape. The listeners below cover the rest.
  dialog.setAttribute("closedby", "none");
  dialog.innerHTML = `
    <form novalidate>
      <h2 id="${id}-title">Welcome aboard</h2>
      <p id="${id}-intro">What should we call you? Your name goes on your save file.</p>
      <div class="dialog-field">
        <label for="${id}-input">Your name</label>
        <input id="${id}-input" name="name" type="text" autocomplete="nickname" spellcheck="false"
          autofocus aria-describedby="${id}-error" />
      </div>
      <p id="${id}-error" class="dialog-error" aria-live="polite"></p>
      <div class="dialog-actions">
        <button type="submit" class="dialog-button">Start fishing</button>
      </div>
    </form>`;

  const form = dialog.querySelector("form")!;
  const input = dialog.querySelector("input")!;
  const error = dialog.querySelector<HTMLElement>(".dialog-error")!;
  let done = false;
  let showErrorsLive = false;

  const check = (): ReturnType<typeof validateName> => {
    const result = validateName(input.value);
    error.textContent = result.ok ? "" : result.error;
    input.setAttribute("aria-invalid", String(!result.ok));
    return result;
  };

  dialog.addEventListener("cancel", (event) => event.preventDefault());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.preventDefault();
  });
  // Last resort if a browser closes it anyway (some ignore preventDefault on repeated Escape).
  dialog.addEventListener("close", () => {
    if (!done) {
      dialog.showModal();
      input.focus();
    }
  });
  // Once the player has seen an error, keep it up to date as they type.
  input.addEventListener("input", () => {
    if (showErrorsLive) check();
  });

  return new Promise((resolve) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = check();
      if (!result.ok) {
        showErrorsLive = true;
        input.focus();
        return;
      }
      done = true;
      dialog.close();
      dialog.remove();
      resolve(result.name);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
