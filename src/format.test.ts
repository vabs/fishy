import { describe, expect, it } from "vitest";
import { wholeShares } from "./format";

describe("wholeShares", () => {
  it("adds up to the floored total, giving leftover dollars to the largest remainders", () => {
    expect(wholeShares([1.6, 1.6, 1.8], 5)).toEqual([2, 1, 2]);
    expect(wholeShares([3571.9, 1087.2, 407.6], 5066.7)).toEqual([3572, 1087, 407]);
  });

  it("leaves whole amounts alone", () => {
    expect(wholeShares([3, 4], 7)).toEqual([3, 4]);
    expect(wholeShares([], 0)).toEqual([]);
  });
});
