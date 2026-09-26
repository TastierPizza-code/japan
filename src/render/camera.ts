import { WORLD_H, WORLD_W } from "../sim/config.ts";

/** x/y = Weltkoordinate der linken oberen Bildschirmecke. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 1;
  viewH = 1;
  worldW: number;
  worldH: number;
  maxZoom: number;

  constructor(worldW = WORLD_W, worldH = WORLD_H, maxZoom = 8) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.maxZoom = maxZoom;
  }

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  fitZoom() {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  fit() {
    this.zoom = this.fitZoom();
    this.x = (this.worldW - this.viewW / this.zoom) / 2;
    this.y = (this.worldH - this.viewH / this.zoom) / 2;
  }

  toWorld(sx: number, sy: number) {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  toScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  pan(dxScreen: number, dyScreen: number) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoomt um einen Bildschirmpunkt herum. */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.toWorld(sx, sy);
    const min = this.fitZoom() * 0.8;
    this.zoom = Math.max(min, Math.min(this.maxZoom, this.zoom * factor));
    this.x = before.x - sx / this.zoom;
    this.y = before.y - sy / this.zoom;
    this.clamp();
  }

  centerOn(wx: number, wy: number) {
    this.x = wx - this.viewW / this.zoom / 2;
    this.y = wy - this.viewH / this.zoom / 2;
    this.clamp();
  }

  private clamp() {
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    const mx = Math.max(0, (vw - this.worldW) / 2) + vw * 0.3;
    const my = Math.max(0, (vh - this.worldH) / 2) + vh * 0.3;
    this.x = Math.max(-mx, Math.min(this.worldW - vw + mx, this.x));
    this.y = Math.max(-my, Math.min(this.worldH - vh + my, this.y));
  }
}
