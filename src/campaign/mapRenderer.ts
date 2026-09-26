import type { GameMap } from "../world/mapData.ts";

/**
 * Malt die Kampagnenkarte pixelgenau in ein Offscreen-Canvas (1 Pixel = 1 Kartenpixel).
 * Wird nur neu gezeichnet, wenn sich Besitzverhältnisse oder Fronten ändern.
 */
export class MapRenderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private seaNoise: Float32Array;
  private coastDist: Uint8Array;
  private nationRgb: [number, number, number][];
  private map: GameMap;

  constructor(map: GameMap) {
    this.map = map;
    this.canvas = document.createElement("canvas");
    this.canvas.width = map.width;
    this.canvas.height = map.height;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(map.width, map.height);
    this.nationRgb = map.nations.map((n) => hexToRgb(n.color));
    const N = map.width * map.height;
    this.seaNoise = new Float32Array(N);
    for (let i = 0; i < N; i++) this.seaNoise[i] = Math.random();
    this.coastDist = distanceToLand(map);
  }

  /**
   * owner: Besitzer je Provinz. highlight: Provinz-IDs, die hervorgehoben werden.
   * warWith: Nationen, mit denen der Spieler Krieg führt (Grenze rot).
   */
  draw(owner: ArrayLike<number>, player: number, warWith: Set<number>, selected: number) {
    const { width: W, height: H, pixels } = this.map;
    const d = this.img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = i * 4;
        const p = pixels[i];
        if (p < 0) {
          // Meer: tiefer = dunkler, an der Küste heller
          const cd = this.coastDist[i];
          const n = this.seaNoise[i] * 6;
          const shallow = cd < 6 ? (6 - cd) * 3 : 0;
          d[k] = 34 + shallow + n;
          d[k + 1] = 48 + shallow * 1.2 + n;
          d[k + 2] = 58 + shallow * 1.3 + n;
          d[k + 3] = 255;
          continue;
        }
        const o = owner[p];
        const rgb = this.nationRgb[o] ?? [90, 90, 90];
        // leichte Variation je Provinz, damit man sie auseinanderhält
        const v = ((p * 2654435761) >>> 0) % 13;
        let f = 0.9 + v * 0.012;
        const right = x + 1 < W ? pixels[i + 1] : p;
        const down = y + 1 < H ? pixels[i + W] : p;
        const left = x > 0 ? pixels[i - 1] : p;
        const up = y > 0 ? pixels[i - W] : p;
        const nb = [right, down, left, up];
        let border = false;
        let nationBorder = false;
        let front = false;
        let coast = false;
        for (const q of nb) {
          if (q < 0) coast = true;
          else if (q !== p) {
            border = true;
            const oq = owner[q];
            if (oq !== o) {
              nationBorder = true;
              if ((o === player && warWith.has(oq)) || (oq === player && warWith.has(o))) front = true;
            }
          }
        }
        if (border) f *= 0.8;
        if (coast) f *= 0.72;
        if (p === selected) f *= 1.25;
        let r = rgb[0] * f;
        let g = rgb[1] * f;
        let b = rgb[2] * f;
        if (nationBorder) {
          r = g = b = 28;
          if (front) {
            r = 200;
            g = 50;
            b = 40;
          }
        }
        d[k] = r;
        d[k + 1] = g;
        d[k + 2] = b;
        d[k + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Abstand jedes Meerpixels zur nächsten Küste (in Pixeln, max 255), per Breitensuche. */
function distanceToLand(map: GameMap): Uint8Array {
  const { width: W, height: H, pixels } = map;
  const dist = new Uint8Array(W * H).fill(255);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (pixels[i] >= 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W;
    const nd = dist[i] + 1;
    if (nd > 12) continue;
    for (const j of [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, i + W < W * H ? i + W : -1, i - W]) {
      if (j < 0 || dist[j] <= nd) continue;
      dist[j] = nd;
      queue.push(j);
    }
  }
  return dist;
}
