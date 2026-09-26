import type { Battle, Company } from "../sim/battle.ts";
import { ARTY_SPREAD, OBJECTIVE_RADIUS, PLAYER, STATS, UNIT_AT, UNIT_FLAME, UNIT_GUN, UNIT_MAGE, UNIT_MG, UNIT_TANK } from "../sim/config.ts";
import type { Camera } from "../render/camera.ts";

const PC = "#8cb8f2";
const EC = "#e6806b";

/** Fahnen der Kompanien (antippbar) und Markierungen auf der Karte. */
export class Overlay {
  private flags = new Map<number, { el: HTMLElement; bar: HTMLElement; label: HTMLElement }>();

  private svg: SVGSVGElement;
  private flagLayer: HTMLElement;
  private onSelect: (id: number) => void;

  constructor(svg: SVGSVGElement, flagLayer: HTMLElement, onSelect: (id: number) => void) {
    this.svg = svg;
    this.flagLayer = flagLayer;
    this.onSelect = onSelect;
  }

  update(b: Battle, cam: Camera, selected: number) {
    const z = cam.zoom;
    const parts: string[] = [];

    for (const o of b.objectives) {
      const p = cam.toScreen(o.x, o.y);
      const col = o.owner === PLAYER ? PC : EC;
      const r = OBJECTIVE_RADIUS * z;
      parts.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="${col}" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 4"/>`,
      );
      if (o.capture > 0 && o.capturer >= 0) {
        const cc = o.capturer === PLAYER ? PC : EC;
        const circ = 2 * Math.PI * (r + 4);
        parts.push(
          `<circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="${cc}" stroke-width="4" stroke-dasharray="${circ * o.capture} ${circ}" transform="rotate(-90 ${p.x} ${p.y})"/>`,
        );
      }
      parts.push(
        `<path d="M${p.x} ${p.y}v-22" stroke="#222" stroke-width="2"/><path d="M${p.x} ${p.y - 22}h13l-3 5 3 5h-13z" fill="${col}" stroke="#222"/>`,
      );
    }

    for (const br of b.barrages) {
      const p = cam.toScreen(br.x, br.y);
      const col = br.side === PLAYER ? PC : EC;
      const wait = br.fireAt - b.time;
      parts.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${ARTY_SPREAD * z}" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`,
      );
      if (wait > 0) {
        parts.push(
          `<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="15" font-weight="bold" fill="${col}" stroke="#000" stroke-width="3" paint-order="stroke">${Math.ceil(wait)}</text>`,
        );
      }
    }

    const sel = b.companies[selected];
    if (sel && sel.alive > 0) {
      const a = cam.toScreen(sel.cx, sel.cy);
      const t = cam.toScreen(sel.tx, sel.ty);
      const col = sel.order === "storm" ? "#ff7050" : "#fff";
      if (Math.hypot(a.x - t.x, a.y - t.y) > 6) {
        parts.push(
          `<path d="M${a.x} ${a.y}L${t.x} ${t.y}" stroke="${col}" stroke-width="2" stroke-dasharray="5 5" opacity=".8"/>`,
        );
      }
      parts.push(`<circle cx="${t.x}" cy="${t.y}" r="7" fill="none" stroke="${col}" stroke-width="2"/>`);
      if (sel.type === UNIT_MAGE) {
        parts.push(`<circle cx="${a.x}" cy="${a.y}" r="${STATS[UNIT_MAGE].range * z}" fill="none" stroke="#7ff0ff" stroke-opacity=".3"/>`);
      }
    }
    this.svg.innerHTML = parts.join("");

    for (const c of b.companies) this.updateFlag(c, cam, selected);
  }

  private updateFlag(c: Company, cam: Camera, selected: number) {
    let f = this.flags.get(c.id);
    if (!f) {
      const el = document.createElement("div");
      el.className = "flag " + (c.side === PLAYER ? "p" : "e");
      const label = document.createElement("span");
      label.textContent = shortName(c);
      const bar = document.createElement("i");
      const barWrap = document.createElement("div");
      barWrap.className = "bar";
      barWrap.appendChild(bar);
      el.append(label, barWrap);
      if (c.side === PLAYER) {
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onSelect(c.id);
        });
      }
      this.flagLayer.appendChild(el);
      f = { el, bar, label };
      this.flags.set(c.id, f);
    }
    if (c.alive <= 0) {
      f.el.style.display = "none";
      return;
    }
    const p = cam.toScreen(c.cx, c.cy);
    // Fahne neben die Truppe setzen, nicht darauf – bei starkem Zoom etwas weiter weg
    const off = Math.max(16, STATS[c.type].radius * cam.zoom * 1.6);
    const offset = c.side === PLAYER ? off : -off - 14;
    f.el.style.display = "";
    f.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + offset)}px) translateX(-50%)`;
    f.bar.style.width = `${Math.max(0, (c.alive / c.initial) * 100)}%`;
    f.el.classList.toggle("sel", c.id === selected);
    f.el.classList.toggle("rout", c.order === "rout");
  }
}

export function shortName(c: Company) {
  if (c.type === UNIT_MAGE) return "✦";
  if (c.type === UNIT_TANK) return "▰";
  if (c.type === UNIT_GUN) return "Art";
  if (c.type === UNIT_AT) return "AT";
  if (c.type === UNIT_FLAME) return "🔥";
  if (c.type === UNIT_MG) return c.side === PLAYER && c.name.startsWith("MG-Zug") ? c.name.replace("MG-Zug ", "MG ") : "MG";
  const m = c.name.match(/^\d+(\.\d+)?/);
  return m ? m[0] : c.name.slice(0, 3);
}
