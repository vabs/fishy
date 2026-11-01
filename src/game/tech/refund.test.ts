import { describe, expect, it } from "vitest";
import { refundRemovedLevels } from "./refund";
import { getNode, nextCost } from "./tree";

describe("refundRemovedLevels", () => {
  it("keeps trap nets at their limit and refunds only excess levels", () => {
    expect(refundRemovedLevels({ "rigging.unlock": 1, "rigging.count": 3, "rigging.haul": 2 })).toEqual({
      upgrades: { "rigging.unlock": 1, "rigging.count": 3, "rigging.haul": 2 }, refund: 0,
    });
    const count = getNode("rigging.count")!;
    expect(refundRemovedLevels({ "rigging.count": 4 })).toEqual({
      upgrades: { "rigging.count": 3 }, refund: nextCost(count, 3),
    });
  });

  it("uses rounded current prices when refunding excess levels of an active node", () => {
    const { upgrades, refund } = refundRemovedLevels({ "net.radius": 12 });
    expect(upgrades).toEqual({ "net.radius": 10 });
    // Excess levels originally round to $220 and $352; current prices are $220 and $360.
    expect(refund).toBe(580);
  });

  it("refunds levels above a node's max at today's prices and keeps the rest", () => {
    const school = getNode("uncommon.school")!;
    const owned = school.maxLevel + 2;
    const { upgrades, refund } = refundRemovedLevels({ "uncommon.school": owned, "net.radius": 3 });
    expect(upgrades).toEqual({ "uncommon.school": school.maxLevel, "net.radius": 3 });
    expect(refund).toBe(nextCost(school, school.maxLevel) + nextCost(school, school.maxLevel + 1));
  });

  it("refunds every level of a retired node and drops it", () => {
    const { upgrades, refund } = refundRemovedLevels({ "spawn.max": 2 });
    expect(upgrades).toEqual({});
    expect(refund).toBe(40 + 64);
  });

  it("leaves unknown ids for the save's own sanitising and refunds nothing for them", () => {
    expect(refundRemovedLevels({ "no.such.node": 4 })).toEqual({ upgrades: { "no.such.node": 4 }, refund: 0 });
  });

  it("changes nothing for a save within the current limits", () => {
    expect(refundRemovedLevels({ "net.radius": 1 })).toEqual({ upgrades: { "net.radius": 1 }, refund: 0 });
  });
});
