import { describe, expect, it } from "vitest";
import { shouldIntercept } from "../src/ui/drawer";

const click = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
const O = "https://globelayers.com";

describe("shouldIntercept — liens du tiroir (lot G §5)", () => {
  it("clic simple vers une page connue : intercepté", () => {
    expect(shouldIntercept(click, "/rain-map/", O)).toBe(true);
    expect(shouldIntercept(click, "/", O)).toBe(true);
    expect(shouldIntercept(click, "https://globelayers.com/wind-map/", O)).toBe(true);
  });
  it("modificateurs ou bouton non gauche : laissé au navigateur", () => {
    expect(shouldIntercept({ ...click, ctrlKey: true }, "/rain-map/", O)).toBe(false);
    expect(shouldIntercept({ ...click, metaKey: true }, "/rain-map/", O)).toBe(false);
    expect(shouldIntercept({ ...click, shiftKey: true }, "/rain-map/", O)).toBe(false);
    expect(shouldIntercept({ ...click, altKey: true }, "/rain-map/", O)).toBe(false);
    expect(shouldIntercept({ ...click, button: 1 }, "/rain-map/", O)).toBe(false);
  });
  it("lien externe ou page inconnue : laissé au navigateur", () => {
    expect(shouldIntercept(click, "https://www.openstreetmap.org/copyright", O)).toBe(false);
    expect(shouldIntercept(click, "/unknown/", O)).toBe(false);
  });
});
