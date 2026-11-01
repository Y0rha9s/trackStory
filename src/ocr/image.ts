/** Imagen RGBA mínima (compatible con ImageData del navegador y con pngjs en Node). */
export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function crop(img: Img, b: Box): Img {
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(img.width, Math.ceil(b.x + b.w));
  const y1 = Math.min(img.height, Math.ceil(b.y + b.h));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

export const px = (img: Img, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]] as const;
};

/** Componentes conexas (8-vecindad) de una máscara booleana. */
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 3,
): (Box & { area: number })[] {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const out: (Box & { area: number })[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    let l = width, r = 0, t = height, b = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            queue[tail++] = j;
          }
        }
      }
    }
    if (tail >= minArea) out.push({ x: l, y: t, w: r - l + 1, h: b - t + 1, area: tail });
  }
  return out;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const s = Array.from(values).sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}
