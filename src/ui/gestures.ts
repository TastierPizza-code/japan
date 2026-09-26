import type { Camera } from "../render/camera.ts";

/** Ziehen = verschieben, zwei Finger/Mausrad = zoomen, kurzes Tippen = onTap. */
export function bindGestures(el: HTMLElement, cam: () => Camera, onTap: (x: number, y: number) => void) {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragDist = 0;
  let pinchDist = 0;
  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.target !== el && !(e.target as Element).closest("canvas, svg")) return;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    dragDist = pointers.size > 1 ? 999 : 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  el.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    const c = cam();
    if (pointers.size === 1) {
      dragDist += Math.hypot(p.x - prev.x, p.y - prev.y);
      if (dragDist > 8) c.pan(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const d = Math.hypot(p.x - other.x, p.y - other.y);
      const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
      if (pinchDist > 0) c.zoomAt(mid.x, mid.y, d / pinchDist);
      c.pan((p.x - prev.x) / 2, (p.y - prev.y) / 2);
      pinchDist = d;
    }
    pointers.set(e.pointerId, p);
  });
  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p && pointers.size === 0 && dragDist <= 8 && e.type === "pointerup") onTap(p.x, p.y);
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      cam().zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
}

/** Führt fn aus, wenn sich die Größe des Elements ändert, und passt Canvas-Auflösungen an. */
export function watchSize(el: HTMLElement, canvases: HTMLCanvasElement[], dpr: number, cam: Camera, fitFirst = true): () => void {
  let first = fitFirst;
  const resize = () => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const wasFit = first || Math.abs(cam.zoom - cam.fitZoom()) < 1e-3;
    const center = cam.toWorld(cam.viewW / 2, cam.viewH / 2);
    for (const c of canvases) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    cam.resize(r.width, r.height);
    if (wasFit) cam.fit();
    else cam.centerOn(center.x, center.y);
    first = false;
  };
  new ResizeObserver(resize).observe(el);
  resize();
  return resize;
}
