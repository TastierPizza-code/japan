import { Rng } from "./rng.ts";
import { SUPPORT_Y, TRENCH_Y, WIRE_Y, WORLD_H, WORLD_W } from "./config.ts";

export const CELL = 8;
export const GW = Math.ceil(WORLD_W / CELL);
export const GH = Math.ceil(WORLD_H / CELL);

export const COVER_TRENCH = 0.75;
export const COVER_CRATER = 0.45;
const TRENCH_HALF_WIDTH = 7;
const WIRE_SLOW = 0.3;
const CRATER_SLOW = 0.85;

export type Polyline = { x: number; y: number }[];

export interface Crater {
  x: number;
  y: number;
  r: number;
}

export interface WireBand {
  y: number;
  x0: number;
  x1: number;
}

/**
 * Das Schlachtfeld: Deckung und Bewegungskosten als Raster, plus die
 * Geometrie, aus der der Renderer das Bild malt.
 */
export class Terrain {
  cover = new Float32Array(GW * GH);
  slow = new Float32Array(GW * GH).fill(1);
  trench = new Uint8Array(GW * GH);
  trenches: Polyline[] = [];
  wires: WireBand[] = [];
  craters: Crater[] = [];

  constructor(rng: Rng) {
    for (let side = 0; side < 2; side++) {
      this.addTrench(zigzagH(TRENCH_Y[side], 12, 40));
      this.addTrench(zigzagH(SUPPORT_Y[side], 6, 60));
      for (const cx of [150, 450, 750, 1050]) {
        this.addTrench(zigzagV(cx + rng.range(-30, 30), TRENCH_Y[side], SUPPORT_Y[side], 10, 30));
      }
      // Stacheldraht mit ein paar Lücken (Ausfalltore)
      const gaps = [rng.range(150, 350), rng.range(500, 700), rng.range(850, 1050)];
      let x = 0;
      for (const g of gaps) {
        this.addWire({ y: WIRE_Y[side], x0: x, x1: g - 25 });
        x = g + 25;
      }
      this.addWire({ y: WIRE_Y[side], x0: x, x1: WORLD_W });
    }
    // Niemandsland ist schon zerschossen
    for (let i = 0; i < 380; i++) {
      const y = rng.range(WIRE_Y[1] + 30, WIRE_Y[0] - 30);
      this.addCrater(rng.range(10, WORLD_W - 10), y, rng.range(5, 15));
    }
  }

  private addTrench(line: Polyline) {
    this.trenches.push(line);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - TRENCH_HALF_WIDTH) / CELL));
      const maxX = Math.min(GW - 1, Math.floor((Math.max(a.x, b.x) + TRENCH_HALF_WIDTH) / CELL));
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - TRENCH_HALF_WIDTH) / CELL));
      const maxY = Math.min(GH - 1, Math.floor((Math.max(a.y, b.y) + TRENCH_HALF_WIDTH) / CELL));
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const d = distToSegment((cx + 0.5) * CELL, (cy + 0.5) * CELL, a.x, a.y, b.x, b.y);
          if (d <= TRENCH_HALF_WIDTH) {
            const k = cy * GW + cx;
            this.cover[k] = COVER_TRENCH;
            this.trench[k] = 1;
          }
        }
      }
    }
  }

  private addWire(w: WireBand) {
    if (w.x1 - w.x0 < 5) return;
    this.wires.push(w);
    const y0 = Math.floor((w.y - 10) / CELL);
    const y1 = Math.floor((w.y + 10) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = Math.floor(w.x0 / CELL); cx < Math.min(GW, Math.ceil(w.x1 / CELL)); cx++) {
        this.slow[cy * GW + cx] = WIRE_SLOW;
      }
    }
  }

  /** Granattrichter: gibt Deckung, zerreißt Draht. */
  addCrater(x: number, y: number, r: number) {
    this.craters.push({ x, y, r });
    const rc = Math.ceil((r + 4) / CELL);
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    for (let cy = gy - rc; cy <= gy + rc; cy++) {
      if (cy < 0 || cy >= GH) continue;
      for (let cx = gx - rc; cx <= gx + rc; cx++) {
        if (cx < 0 || cx >= GW) continue;
        const d = Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y);
        const k = cy * GW + cx;
        if (d <= r + 4 && this.slow[k] < CRATER_SLOW) this.slow[k] = 1; // Draht zerfetzt
        if (d <= r && !this.trench[k]) {
          this.cover[k] = Math.max(this.cover[k], COVER_CRATER);
          this.slow[k] = Math.min(this.slow[k], CRATER_SLOW);
        }
      }
    }
  }

  coverAt(x: number, y: number): number {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return 0;
    return this.cover[cy * GW + cx];
  }

  slowAt(x: number, y: number): number {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return 1;
    return this.slow[cy * GW + cx];
  }

  /** Sucht in der Nähe die beste Deckung. Schreibt das Ergebnis in out. */
  findCover(x: number, y: number, radius: number, rng: Rng, out: { x: number; y: number }) {
    const here = this.coverAt(x, y);
    let best = here;
    let bx = x;
    let by = y;
    const rc = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    let bestScore = here;
    for (let cy = gy - rc; cy <= gy + rc; cy++) {
      if (cy < 0 || cy >= GH) continue;
      for (let cx = gx - rc; cx <= gx + rc; cx++) {
        if (cx < 0 || cx >= GW) continue;
        const px = (cx + 0.5) * CELL;
        const py = (cy + 0.5) * CELL;
        const d = Math.hypot(px - x, py - y);
        if (d > radius) continue;
        const c = this.cover[cy * GW + cx];
        const score = c - (d / radius) * 0.2;
        if (c > best + 0.05 && score > bestScore) {
          bestScore = score;
          best = c;
          bx = px + rng.range(-3, 3);
          by = py + rng.range(-3, 3);
        }
      }
    }
    out.x = bx;
    out.y = by;
  }
}

function zigzagH(y: number, amp: number, step: number): Polyline {
  const pts: Polyline = [];
  for (let x = -step, i = 0; x <= WORLD_W + step; x += step, i++) {
    pts.push({ x, y: y + (i % 2 ? amp : -amp) });
  }
  return pts;
}

function zigzagV(x: number, y0: number, y1: number, amp: number, step: number): Polyline {
  const pts: Polyline = [];
  const dir = Math.sign(y1 - y0);
  for (let y = y0, i = 0; dir * (y1 - y) >= 0; y += dir * step, i++) {
    pts.push({ x: x + (i % 2 ? amp : -amp), y });
  }
  pts.push({ x, y: y1 });
  return pts;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
