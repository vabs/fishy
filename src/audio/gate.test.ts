import { describe, expect, it } from "vitest";
import { SfxGate } from "./gate";

describe("SfxGate", () => {
  it("keeps a minimum gap between voices of one kind", () => {
    const gate = new SfxGate(8, { catch: { gap: 0.04 } });
    expect(gate.tryStart("catch", 1, 0.3)).toBe(true);
    expect(gate.tryStart("catch", 1.02, 0.3)).toBe(false);
    expect(gate.tryStart("catch", 1.04, 0.3)).toBe(true);
  });

  it("lets different kinds through together", () => {
    const gate = new SfxGate(8, { catch: { gap: 0.04 }, pop: { gap: 0.08 } });
    expect(gate.tryStart("catch", 1, 0.3)).toBe(true);
    expect(gate.tryStart("pop", 1, 0.3)).toBe(true);
  });

  it("caps voices sounding at once, freeing them as they end", () => {
    const gate = new SfxGate(3, {});
    expect([1, 2, 3, 4].map(() => gate.tryStart("x", 0, 1))).toEqual([true, true, true, false]);
    expect(gate.active(0.5)).toBe(3);
    expect(gate.ready("x", 1)).toBe(true);
    expect(gate.tryStart("x", 1, 1)).toBe(true);
    expect(gate.active(1)).toBe(1);
  });

  it("gives each kind its own share of voices, so one kind can't take them all", () => {
    const gate = new SfxGate(8, { bounce: { gap: 0, voices: 2 } });
    expect([0, 1, 2].map(() => gate.tryStart("bounce", 0, 1))).toEqual([true, true, false]);
    expect(gate.tryStart("catch", 0, 1)).toBe(true);
    expect(gate.active(0, "bounce")).toBe(2);
  });

  it("forced voices skip the limits but still count", () => {
    const gate = new SfxGate(1, { chime: { gap: 10 } });
    expect(gate.tryStart("chime", 0, 1)).toBe(true);
    expect(gate.tryStart("chime", 0, 1)).toBe(false);
    expect(gate.tryStart("chime", 0, 1, true)).toBe(true);
    expect(gate.active(0)).toBe(2);
  });

  it("holds hundreds of catches a second to about one voice per gap", () => {
    const gate = new SfxGate(8, { catch: { gap: 0.04, voices: 5 } });
    let started = 0;
    for (let t = 0; t < 1; t += 0.002) if (gate.tryStart("catch", t, 0.16)) started++;
    expect(started).toBeGreaterThanOrEqual(20);
    expect(started).toBeLessThanOrEqual(26);
    expect(gate.active(1)).toBeLessThanOrEqual(5);
  });
});
