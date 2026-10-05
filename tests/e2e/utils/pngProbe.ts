/**
 * Minimal PNG probe for visual verification.
 *
 * Playwright screenshots are the ONLY ground truth for "does this actually look
 * right", but nothing in this repo can decode an image. There is no image
 * library available (no sharp, no pngjs), so this decodes the (small) subset
 * Playwright emits — 8-bit RGB/RGBA, non-interlaced — using Node's built-in
 * zlib.
 *
 * That lets the visual QA spec measure REAL composited pixels: the average
 * colour behind a text run, and the WCAG contrast ratio against the colour that
 * text actually renders in. Modelling the CSS stack by hand (plate → veil →
 * translucent hero) is exactly the kind of approximation that hides a
 * readability bug, so the spec measures instead.
 */
import { inflateSync } from 'zlib';

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA pixels, row-major. */
  readonly pixels: Uint8Array;
}

/** Decode an 8-bit, non-interlaced PNG buffer into RGBA pixels. */
export function decodePng(buffer: Buffer): DecodedPng {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < SIG.length; i += 1) {
    if (buffer[i] !== SIG[i]) throw new Error('Not a PNG buffer');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x] + pred) & 0xff;
          break;
        }
        default: break;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    previous = line;
  }

  return { width, height, pixels: out };
}

/** WCAG relative luminance of an sRGB triple. */
export function luminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio between two colours (order-independent). */
export function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Parse `rgb()` / `rgba()` / `color(srgb ...)` into components. */
export function parseCssColor(value: string): Rgba | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  /* Chrome serialises `color-mix()` results as `color(srgb r g b [/ a])` with
     0-1 channels. The personality inks are color-mix()es, so an unhandled
     color() here would silently degrade the ink to BLACK in every contrast
     measurement and fabricate regressions. */
  const c = value.match(
    /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*[/\s]+\s*([\d.]+))?\s*\)/,
  );
  if (c) {
    return {
      r: Number(c[1]) * 255,
      g: Number(c[2]) * 255,
      b: Number(c[3]) * 255,
      a: c[4] === undefined ? 1 : Number(c[4]),
    };
  }
  return null;
}

/**
 * The dominant colour of a region — the BACKDROP behind text.
 *
 * Quantises to 16 levels per channel and returns the modal bin's mean. Text
 * strokes cover a minority of a region's pixels, so the mode is the surface
 * behind them; a plain mean would be dragged toward the glyph colour and
 * flatter the measured contrast.
 */
export function dominantColor(
  image: DecodedPng,
  box: { x: number; y: number; width: number; height: number },
  exclude?: { r: number; g: number; b: number; tolerance?: number },
): Rgba {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  // Glyph pixels must not be mistaken for the backdrop. Over BUSY artwork the
  // background fragments across many histogram bins while the (flat) glyph
  // colour concentrates into one, so an unfiltered mode reports the text as its
  // own backdrop — a nonsense ~1:1 ratio. Skipping near-text pixels removes
  // that bias entirely.
  const tol = exclude?.tolerance ?? 46;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.pixels[i];
      const g = image.pixels[i + 1];
      const b = image.pixels[i + 2];
      if (exclude) {
        const distance = Math.max(
          Math.abs(r - exclude.r),
          Math.abs(g - exclude.g),
          Math.abs(b - exclude.b),
        );
        if (distance <= tol) continue;
      }
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const entry = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      bins.set(key, entry);
    }
  }

  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of bins.values()) {
    if (entry.count > best.count) best = entry;
  }
  if (best.count === 0) {
    // Every pixel looked like glyph: fall back to the plain mean so the caller
    // still gets a usable (if conservative) answer.
    return meanColor(image, box);
  }
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
    a: 1,
  };
}

/** Plain mean colour of a region. */
export function meanColor(
  image: DecodedPng,
  box: { x: number; y: number; width: number; height: number },
): Rgba {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      r += image.pixels[i];
      g += image.pixels[i + 1];
      b += image.pixels[i + 2];
      n += 1;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0, a: 1 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: 1 };
}

/** Shannon entropy (bits/px) of a region's 4-bit-per-channel histogram. */
export function regionEntropy(
  image: DecodedPng,
  box: { x: number; y: number; width: number; height: number },
): number {
  const bins = new Map<number, number>();
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  let total = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      const key = ((image.pixels[i] >> 4) << 8) | ((image.pixels[i + 1] >> 4) << 4) | (image.pixels[i + 2] >> 4);
      bins.set(key, (bins.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  if (!total) return 0;

  let entropy = 0;
  for (const count of bins.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
