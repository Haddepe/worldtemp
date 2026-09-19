import { describe, expect, it } from "vitest";
import { parseFlag, withFlag } from "../src/geo/params";

describe("parseFlag / withFlag — ?labels=, ?rivers= (spec repères §6)", () => {
  it("1 et 0 explicites, sinon le repli (actif par défaut)", () => {
    expect(parseFlag("?labels=1", "labels")).toBe(true);
    expect(parseFlag("?labels=0", "labels")).toBe(false);
    expect(parseFlag("", "labels")).toBe(true);
    expect(parseFlag("?labels=oui", "labels")).toBe(true);
    expect(parseFlag("?rivers=x", "rivers", false)).toBe(false);
  });
  it("withFlag ne réécrit que son paramètre", () => {
    expect(withFlag("?layer=temp&wind=1", "labels", false)).toBe("?layer=temp&wind=1&labels=0");
    expect(withFlag("?labels=0&d=2", "labels", true)).toBe("?labels=1&d=2");
  });
});
