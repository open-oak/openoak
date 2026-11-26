document.addEventListener("DOMContentLoaded", () => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const backgroundLayer = document.querySelector(".bg-layer");
  const root = document.documentElement;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const rgbToHsl = (red, green, blue) => {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      switch (max) {
        case r:
          hue = ((g - b) / delta) % 6;
          break;
        case g:
          hue = (b - r) / delta + 2;
          break;
        default:
          hue = (r - g) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) {
        hue += 360;
      }
    }

    return { h: hue, s: saturation, l: lightness };
  };

  const hslToRgb = (hue, saturation, lightness) => {
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = lightness - c / 2;
    let rPrime = 0;
    let gPrime = 0;
    let bPrime = 0;

    if (hue < 60) {
      rPrime = c;
      gPrime = x;
    } else if (hue < 120) {
      rPrime = x;
      gPrime = c;
    } else if (hue < 180) {
      gPrime = c;
      bPrime = x;
    } else if (hue < 240) {
      gPrime = x;
      bPrime = c;
    } else if (hue < 300) {
      rPrime = x;
      bPrime = c;
    } else {
      rPrime = c;
      bPrime = x;
    }

    return [
      Math.round((rPrime + m) * 255),
      Math.round((gPrime + m) * 255),
      Math.round((bPrime + m) * 255),
    ];
  };

  const rgbToHex = (red, green, blue) => {
    const toHex = (value) => value.toString(16).padStart(2, "0");
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  };

  const relativeLuminance = (red, green, blue) => {
    const normalize = (value) => {
      const channel = value / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * normalize(red) + 0.7152 * normalize(green) + 0.0722 * normalize(blue);
  };

  const contrastRatio = (rgbA, rgbB) => {
    const lumA = relativeLuminance(rgbA[0], rgbA[1], rgbA[2]);
    const lumB = relativeLuminance(rgbB[0], rgbB[1], rgbB[2]);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const pickCtaPalette = (image) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    const sampleSize = 56;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    let best = null;
    let fallback = null;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha < 0.95) {
        continue;
      }

      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const hsl = rgbToHsl(red, green, blue);

      if (hsl.s > 0.1 && hsl.l > 0.2 && hsl.l < 0.82) {
        const score = hsl.s * 1.45 - Math.abs(hsl.l - 0.52) * 0.85;
        if (!fallback || score > fallback.score) {
          fallback = { ...hsl, score };
        }
      }

      if (hsl.s < 0.22 || hsl.l < 0.24 || hsl.l > 0.78) {
        continue;
      }

      const strongScore = hsl.s * 1.6 - Math.abs(hsl.l - 0.5);
      if (!best || strongScore > best.score) {
        best = { ...hsl, score: strongScore };
      }
    }

    const chosen = best || fallback;
    if (!chosen) {
      return null;
    }

    const baseHue = chosen.h;
    const baseSat = clamp(chosen.s * 0.95 + 0.08, 0.42, 0.84);
    const baseLight = clamp(chosen.l, 0.34, 0.56);
    const hoverLight = clamp(baseLight - 0.08, 0.24, 0.48);
    const baseRgb = hslToRgb(baseHue, baseSat, baseLight);
    const hoverRgb = hslToRgb(baseHue, baseSat, hoverLight);
    const lightText = [242, 255, 252];
    const darkText = [12, 28, 26];
    const ctaText = contrastRatio(baseRgb, darkText) >= contrastRatio(baseRgb, lightText)
      ? darkText
      : lightText;

    return {
      base: rgbToHex(baseRgb[0], baseRgb[1], baseRgb[2]),
      hover: rgbToHex(hoverRgb[0], hoverRgb[1], hoverRgb[2]),
      text: rgbToHex(ctaText[0], ctaText[1], ctaText[2]),
    };
  };

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });

  const applyCtaThemeFromImage = (image) => {
    try {
      const palette = pickCtaPalette(image);
      if (!palette) {
        return;
      }

      root.style.setProperty("--cta", palette.base);
      root.style.setProperty("--cta-strong", palette.hover);
      root.style.setProperty("--cta-text", palette.text);
    } catch (error) {
      // Keep default CTA colors if extraction fails.
    }
  };

  if (backgroundLayer) {
    const wallpaperIds = ["04", "05", "06", "07", "09", "10", "11", "12", "13"];
    const wallpaperId = wallpaperIds[Math.floor(Math.random() * wallpaperIds.length)];
    const wallpaperSrc = `public/wallpaper-${wallpaperId}.webp`;
    loadImage(wallpaperSrc)
      .then((image) => {
        backgroundLayer.style.backgroundImage =
          `linear-gradient(rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.42)), url('${wallpaperSrc}')`;
        applyCtaThemeFromImage(image);
        requestAnimationFrame(() => {
          backgroundLayer.classList.add("is-loaded");
        });
      })
      .catch(() => {
        backgroundLayer.classList.add("is-loaded");
      });
  }

  const revealElements = [...document.querySelectorAll(".reveal")];
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      }
    );

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  const nav = document.getElementById("nav");
  const updateNav = () => {
    nav.classList.toggle("scrolled", window.scrollY > 18);
    nav.classList.toggle("at-top", window.scrollY <= 18);
  };

  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const target = document.querySelector(anchor.getAttribute("href"));
      if (!target) {
        return;
      }

      event.preventDefault();
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  });
});
