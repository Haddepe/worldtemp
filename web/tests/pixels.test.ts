import { describe, expect, it, vi } from "vitest";
import { bitmapPixels } from "../src/data/pixels";

describe("bitmapPixels", () => {
  it("sans canvas (environnement Node) renvoie null sans lever", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fake = { width: 4, height: 3, close() {} } as unknown as ImageBitmap;
      expect(bitmapPixels(fake)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
