import { describe, expect, it } from "vitest";
import { bitmapPixels } from "../src/data/pixels";

describe("bitmapPixels", () => {
  it("sans canvas (environnement Node) renvoie null sans lever", () => {
    const fake = { width: 4, height: 3, close() {} } as unknown as ImageBitmap;
    expect(bitmapPixels(fake)).toBeNull();
  });
});
