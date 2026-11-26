import { describe, expect, it } from "vitest";
import { encodeBackground, getBackgroundWithStaticBlur, parseBackground } from "@/lib/utils";

describe("wallpaper background utilities", () => {
  it("stores blur without adding unrelated wallpaper settings", () => {
    const background = "url('/5.webp') center/cover no-repeat";

    expect(encodeBackground(background, 1)).toBe(`${background}::1`);
    expect(encodeBackground(background, 0)).toBe(background);
  });

  it("normalizes old JPEG wallpaper paths and resolves the static blur asset", () => {
    const parsed = parseBackground("url('/8.jpg') center/cover no-repeat::1");

    expect(parsed).toEqual({
      bg: "url('/8.webp') center/cover no-repeat",
      blur: 1,
    });
    expect(getBackgroundWithStaticBlur(parsed.bg, parsed.blur)).toBe(
      "url('/8-blur50.webp') center/cover no-repeat",
    );
  });
});
