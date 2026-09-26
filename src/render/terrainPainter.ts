import { WIRE_Y, WORLD_H, WORLD_W } from "../sim/config.ts";
import type { Terrain } from "../sim/terrain.ts";
import { Rng } from "../sim/rng.ts";

/**
 * Malt das Schlachtfeld einmal in ein Offscreen-Canvas (1 Pixel = 1 Welteinheit).
 * Trichter und Gefallene werden später direkt hineingestempelt und bleiben liegen.
 */
export class TerrainPainter {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rng = new Rng(99);

  constructor(terrain: Terrain) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORLD_W;
    this.canvas.height = WORLD_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.paintGround();
    for (const c of terrain.craters) this.crater(c.x, c.y, c.r);
    this.paintWire(terrain);
    this.paintTrenches(terrain);
  }

  private paintGround() {
    const img = this.ctx.createImageData(WORLD_W, WORLD_H);
    const d = img.data;
    const noMansTop = WIRE_Y[1];
    const noMansBottom = WIRE_Y[0];
    for (let y = 0; y < WORLD_H; y++) {
      // Hinter den Linien etwas grüner, im Niemandsland grau-braun
      const edge = Math.min(Math.abs(y - noMansTop), Math.abs(y - noMansBottom));
      const inside = y > noMansTop && y < noMansBottom;
      const g = inside ? 0 : Math.min(1, edge / 250);
      for (let x = 0; x < WORLD_W; x++) {
        const n = (this.rng.next() - 0.5) * 14;
        const blotch = Math.sin(x * 0.021 + y * 0.013) * Math.cos(x * 0.007 - y * 0.017) * 8;
        const k = (y * WORLD_W + x) * 4;
        d[k] = 86 - g * 12 + n + blotch;
        d[k + 1] = 78 + g * 6 + n + blotch;
        d[k + 2] = 62 - g * 14 + n + blotch * 0.6;
        d[k + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  private paintTrenches(terrain: Terrain) {
    const ctx = this.ctx;
    ctx.lineJoin = "miter";
    ctx.lineCap = "square";
    const pass = (width: number, color: string, dy = 0) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const line of terrain.trenches) {
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + dy) : ctx.moveTo(p.x, p.y + dy)));
        ctx.stroke();
      }
    };
    pass(18, "rgba(150,132,98,0.55)"); // Aufwurf / Sandsäcke
    pass(13, "#2b241b");
    pass(4, "#4d3e2a"); // Laufroste
  }

  private paintWire(terrain: Terrain) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(170,170,165,0.55)";
    ctx.lineWidth = 1;
    for (const w of terrain.wires) {
      ctx.beginPath();
      for (let x = w.x0; x < w.x1; x += 4) {
        const y = w.y + (this.rng.next() - 0.5) * 16;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5, y + (this.rng.next() - 0.5) * 10);
      }
      ctx.stroke();
      ctx.fillStyle = "#3a2e22";
      for (let x = w.x0 + 6; x < w.x1; x += 18) ctx.fillRect(x, w.y - 1, 2, 3); // Pfähle
    }
  }

  crater(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(125,110,85,0.6)";
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(48,40,31,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (this.rng.next() < 0.3) {
      ctx.fillStyle = "rgba(60,72,76,0.8)"; // Wasser im Trichter
      ctx.beginPath();
      ctx.arc(x + 1, y + 1, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  corpse(x: number, y: number, side: number) {
    const ctx = this.ctx;
    ctx.fillStyle = side === 0 ? "rgba(70,86,110,0.9)" : "rgba(120,66,58,0.9)";
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    ctx.fillStyle = "rgba(70,22,18,0.45)";
    ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  }
}
