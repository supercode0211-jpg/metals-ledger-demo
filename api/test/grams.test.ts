import { describe, expect, it } from "vitest";
import { gramsToMg, mgToGrams } from "../src/lib/grams.js";

describe("grams <-> milligrams", () => {
  it("parses gram strings exactly", () => {
    expect(gramsToMg("0")).toBe(0);
    expect(gramsToMg("1")).toBe(1000);
    expect(gramsToMg("12.5")).toBe(12_500);
    expect(gramsToMg("12.05")).toBe(12_050);
    expect(gramsToMg("0.001")).toBe(1);
    expect(gramsToMg("9999999.999")).toBe(9_999_999_999);
  });

  it("refuses anything it would have to round or guess", () => {
    for (const bad of ["", "1.2345", "-1", "01", "1.", ".5", "1e3", "1,5", " 1", "10000000"]) {
      expect(() => gramsToMg(bad), bad).toThrow();
    }
  });

  it("formats with three decimals", () => {
    expect(mgToGrams(0)).toBe("0.000");
    expect(mgToGrams(1)).toBe("0.001");
    expect(mgToGrams(156_750)).toBe("156.750");
    expect(mgToGrams(-40_500)).toBe("-40.500");
  });

  it("adds up where floats don't", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(mgToGrams(gramsToMg("0.1") + gramsToMg("0.2"))).toBe("0.300");
  });
});
