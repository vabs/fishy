import "./dialog.css";
import "./intro.css";
import { startNetDemo, startParadeDemo } from "./intro-demo";

/*
 * "How to play": three slides shown once after a new player names themselves, and again from the
 * hub's help button. Slide 1 explains the net, slide 2 the upgrades, slide 3 sends the player off.
 */

export interface IntroOptions {
  playerName: string;
  /** "first" ends on "Let's play"; "replay" (from the hub) ends on "Back to the game". */
  mode: "first" | "replay";
}

const SLIDES = 3;
let shown = 0;

/** A small tech tree: the boat in the middle, bought nodes, and one glowing node ready to buy. */
const TREE = `
<svg class="intro-tree" viewBox="0 0 400 190" aria-hidden="true">
  <g class="intro-tree-edges">
    <path d="M200 95 L130 52 M200 95 L118 128 M200 95 L272 60 M272 60 L320 34 M272 60 L330 92 M200 95 L262 140 M262 140 L318 158 M130 52 L82 30"/>
  </g>
  <g transform="translate(200 95)">
    <path class="intro-tree-hull" d="M-40 -15 Q15 -24 44 0 Q15 24 -40 15 Z"/>
    <path class="intro-tree-deck" d="M-34 -10 Q12 -17 34 0 Q12 17 -34 10 Z"/>
  </g>
  <circle class="intro-node is-owned" cx="200" cy="95" r="15"/>
  <circle class="intro-node is-owned" cx="130" cy="52" r="12"/>
  <circle class="intro-node is-owned" cx="118" cy="128" r="12"/>
  <circle class="intro-node is-owned fish-uncommon" cx="272" cy="60" r="12"/>
  <circle class="intro-node fish-rare" cx="320" cy="34" r="12"/>
  <circle class="intro-node fish-electric" cx="330" cy="92" r="12"/>
  <circle class="intro-node is-owned fish-normal" cx="262" cy="140" r="12"/>
  <circle class="intro-node is-ready" cx="318" cy="158" r="12"/>
  <circle class="intro-node is-ready" cx="82" cy="30" r="12"/>
  <g class="intro-price"><rect x="56" y="45" width="52" height="16" rx="8"/><text x="82" y="57">$2,700</text></g>
  <g class="intro-price"><rect x="292" y="173" width="52" height="16" rx="8"/><text x="318" y="185">$1,750</text></g>
</svg>`;

/** Shows the slides. Resolves when the player finishes or skips. */
export function showIntro({ playerName, mode }: IntroOptions): Promise<void> {
  const id = `intro-${++shown}`;
  const finish = mode === "first" ? "Let's play" : "Back to the game";
  const dialog = document.createElement("dialog");
  dialog.className = "dialog intro";
  dialog.setAttribute("aria-labelledby", `${id}-title-0`);
  dialog.innerHTML = `
    <div class="intro-viewport">
      <div class="intro-track">
        <section class="intro-slide" aria-roledescription="slide" aria-label="1 of 3">
          <canvas class="intro-demo" aria-hidden="true"></canvas>
          <h2 id="${id}-title-0">Your net does the catching</h2>
          <p>The circle follows your mouse. Every half second it hits <strong>every fish inside it</strong>, so
            just keep it over the fish. Clicking does nothing. Fish are dark shapes until they swim into
            your net. Each round lasts 15 seconds.</p>
        </section>
        <section class="intro-slide" aria-roledescription="slide" aria-label="2 of 3">
          ${TREE}
          <h2 id="${id}-title-1">Spend it on upgrades</h2>
          <p>Between rounds, your money buys upgrades: a bigger net, harder hits, longer rounds, and
            <strong>new fish worth more</strong>, some with chain reactions like lightning, star shots and a
            whirlpool. Buy everything to unlock the Final Round.</p>
        </section>
        <section class="intro-slide" aria-roledescription="slide" aria-label="3 of 3">
          <canvas class="intro-demo intro-parade" aria-hidden="true"></canvas>
          <h2 id="${id}-title-2" class="intro-good-luck"></h2>
          <p>Catch, upgrade, repeat.</p>
        </section>
      </div>
    </div>
    <div class="intro-dots"></div>
    <div class="dialog-actions intro-actions">
      <button type="button" class="dialog-button is-secondary" data-action="skip">Skip</button>
      <span class="intro-spacer"></span>
      <button type="button" class="dialog-button is-secondary" data-action="back">Back</button>
      <button type="button" class="dialog-button" data-action="next">Next</button>
    </div>`;

  // The name is the player's own text: set it as text, never as HTML.
  dialog.querySelector(".intro-good-luck")!.textContent = `Good luck, ${playerName}!`;

  const track = dialog.querySelector<HTMLElement>(".intro-track")!;
  const slides = [...dialog.querySelectorAll<HTMLElement>(".intro-slide")];
  const dotsRoot = dialog.querySelector<HTMLElement>(".intro-dots")!;
  const skip = dialog.querySelector<HTMLButtonElement>('[data-action="skip"]')!;
  const back = dialog.querySelector<HTMLButtonElement>('[data-action="back"]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-action="next"]')!;
  const dots = slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "intro-dot";
    dot.setAttribute("aria-label", `Go to slide ${i + 1} of ${SLIDES}`);
    dot.addEventListener("click", () => go(i));
    dotsRoot.append(dot);
    return dot;
  });
  const stopNet = startNetDemo(dialog.querySelector<HTMLCanvasElement>(".intro-demo:not(.intro-parade)")!);
  const stopParade = startParadeDemo(dialog.querySelector<HTMLCanvasElement>(".intro-parade")!);
  let current = 0;

  function go(index: number): void {
    current = Math.max(0, Math.min(SLIDES - 1, index));
    track.style.transform = `translateX(${-100 * current}%)`;
    slides.forEach((slide, i) => {
      slide.inert = i !== current;
      slide.setAttribute("aria-hidden", String(i !== current));
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-current", i === current ? "step" : "false"));
    dialog.setAttribute("aria-labelledby", `${id}-title-${current}`);
    const last = current === SLIDES - 1;
    back.hidden = current === 0;
    skip.hidden = last;
    next.textContent = last ? finish : "Next";
    next.classList.toggle("is-finish", last);
    next.focus();
  }

  return new Promise((resolve) => {
    const close = (): void => {
      stopNet();
      stopParade();
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve();
    };
    next.addEventListener("click", () => (current === SLIDES - 1 ? close() : go(current + 1)));
    back.addEventListener("click", () => go(current - 1));
    skip.addEventListener("click", close);
    // Escape skips, like the Skip button.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") go(current + 1);
      else if (event.key === "ArrowLeft") go(current - 1);
    });

    document.body.append(dialog);
    dialog.showModal();
    go(0);
  });
}
