import { WORLD_H, WORLD_W } from "./config.ts";

const CS = 32;
const W = Math.ceil(WORLD_W / CS);
const H = Math.ceil(WORLD_H / CS);
// Grobes Raster (4×4 feine Zellen): schnelle Prüfung, ob überhaupt jemand in Reichweite ist
const CC = CS * 4;
const CW = Math.ceil(WORLD_W / CC);
const CH = Math.ceil(WORLD_H / CC);

/**
 * Räumliches Raster für eine Seite. Wird jeden Tick neu aufgebaut
 * (Counting-Sort), damit Nachbarsuchen billig bleiben.
 */
export class SpatialGrid {
  private start = new Int32Array(W * H + 1);
  private items: Int32Array;
  private cellOf: Int32Array;
  private coarse = new Int32Array(CW * CH);
  count = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  rebuild(ids: ArrayLike<number>, n: number, xs: Float32Array, ys: Float32Array) {
    const start = this.start;
    start.fill(0);
    this.coarse.fill(0);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const c = cellIndex(xs[id], ys[id]);
      this.cellOf[i] = c;
      start[c + 1]++;
      const cx = clamp(Math.floor(xs[id] / CC), 0, CW - 1);
      const cy = clamp(Math.floor(ys[id] / CC), 0, CH - 1);
      this.coarse[cy * CW + cx]++;
    }
    for (let c = 0; c < W * H; c++) start[c + 1] += start[c];
    const fill = start.slice(0, W * H);
    for (let i = 0; i < n; i++) {
      this.items[fill[this.cellOf[i]]++] = ids[i];
    }
    this.count = n;
  }

  /**
   * Nächster Eintrag innerhalb von maxDist. filter darf Einträge ablehnen.
   * Gibt -1 zurück, wenn nichts gefunden wurde. Distanz landet in lastDist.
   */
  lastDist = 0;
  nearest(
    x: number,
    y: number,
    maxDist: number,
    xs: Float32Array,
    ys: Float32Array,
    filter?: (id: number) => boolean,
  ): number {
    if (this.count === 0 || !this.anyNear(x, y, maxDist)) {
      this.lastDist = maxDist;
      return -1;
    }
    const gx = clamp(Math.floor(x / CS), 0, W - 1);
    const gy = clamp(Math.floor(y / CS), 0, H - 1);
    const maxR = Math.ceil(maxDist / CS);
    let best = -1;
    let bestD2 = maxDist * maxDist;
    const start = this.start;
    const items = this.items;
    for (let r = 0; r <= maxR; r++) {
      // Sobald der Ring garantiert weiter weg ist als der beste Fund: fertig.
      if (best >= 0 && (r - 1) * CS > Math.sqrt(bestD2)) break;
      const y0 = gy - r;
      const y1 = gy + r;
      for (let cy = y0; cy <= y1; cy++) {
        if (cy < 0 || cy >= H) continue;
        const edgeRow = cy === y0 || cy === y1;
        const step = edgeRow ? 1 : 2 * r || 1;
        for (let cx = gx - r; cx <= gx + r; cx += step) {
          if (cx < 0 || cx >= W) continue;
          const c = cy * W + cx;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const id = items[k];
            const dx = xs[id] - x;
            const dy = ys[id] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2 && (!filter || filter(id))) {
              bestD2 = d2;
              best = id;
            }
          }
        }
      }
    }
    this.lastDist = Math.sqrt(bestD2);
    return best;
  }

  /** Gibt es im groben Raster überhaupt Einträge, die näher als maxDist sein könnten? */
  anyNear(x: number, y: number, maxDist: number): boolean {
    const x0 = clamp(Math.floor((x - maxDist) / CC), 0, CW - 1);
    const x1 = clamp(Math.floor((x + maxDist) / CC), 0, CW - 1);
    const y0 = clamp(Math.floor((y - maxDist) / CC), 0, CH - 1);
    const y1 = clamp(Math.floor((y + maxDist) / CC), 0, CH - 1);
    const r2 = maxDist * maxDist;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (this.coarse[cy * CW + cx] === 0) continue;
        // kürzester Abstand vom Punkt zur groben Zelle
        const dx = Math.max(cx * CC - x, 0, x - (cx + 1) * CC);
        const dy = Math.max(cy * CC - y, 0, y - (cy + 1) * CC);
        if (dx * dx + dy * dy <= r2) return true;
      }
    }
    return false;
  }

  /** Ruft fn für alle Einträge im Radius auf. */
  forEachInRadius(
    x: number,
    y: number,
    radius: number,
    xs: Float32Array,
    ys: Float32Array,
    fn: (id: number, d: number) => void,
  ) {
    const x0 = clamp(Math.floor((x - radius) / CS), 0, W - 1);
    const x1 = clamp(Math.floor((x + radius) / CS), 0, W - 1);
    const y0 = clamp(Math.floor((y - radius) / CS), 0, H - 1);
    const y1 = clamp(Math.floor((y + radius) / CS), 0, H - 1);
    const r2 = radius * radius;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * W + cx;
        for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) {
          const id = this.items[k];
          const dx = xs[id] - x;
          const dy = ys[id] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(id, Math.sqrt(d2));
        }
      }
    }
  }
}

function cellIndex(x: number, y: number) {
  const cx = clamp(Math.floor(x / CS), 0, W - 1);
  const cy = clamp(Math.floor(y / CS), 0, H - 1);
  return cy * W + cx;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
