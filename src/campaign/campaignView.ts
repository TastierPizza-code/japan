import { Camera } from "../render/camera.ts";
import { bindGestures, watchSize } from "../ui/gestures.ts";
import { fmt } from "../ui/battleView.ts";
import { CAPTURE_SHARE, SECONDS_PER_DAY, UNITS, captureRate, type UnitKind } from "../world/config.ts";
import { STANCE_NAMES, type Division, type FrontPoint, type Stance, type World } from "../world/world.ts";
import { MapRenderer } from "./mapRenderer.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

type Tab = "info" | "army" | "recruit" | "diplo" | "log";
type Selection = { t: "none" } | { t: "prov"; id: number } | { t: "point"; id: number };

const STANCE_ORDER: Stance[] = ["hold", "defensive", "balanced", "aggressive"];
const LANE_NAMES = ["Links", "Mitte", "Rechts"];
const KIND_ICON: Record<UnitKind, string> = { infantry: "🪖", mg: "⚙", artillery: "💥", mage: "✦", tank: "▰", at: "🎯", flame: "🔥" };
const KIND_UNIT: Record<UnitKind, string> = { infantry: "Mann", mg: "MGs", artillery: "Geschütze", mage: "Magier", tank: "Panzer", at: "Tankgewehre", flame: "Flammenwerfer" };

/** Die Kampagnenkarte: Länder, Fronten, eigene Truppen und alle Menüs. */
export class CampaignView {
  world: World;
  cam: Camera;
  tab: Tab = "info";
  sel: Selection = { t: "none" };
  /** wird aufgerufen, wenn der Spieler eine Schlacht öffnen will */
  onOpenBattle: (pointId: number) => void = () => {};
  private renderer: MapRenderer;
  private canvas = $<HTMLCanvasElement>("#mapcanvas");
  private ctx = this.canvas.getContext("2d")!;
  private view = $("#mapview");
  private svg = $("#mapsvg") as unknown as SVGSVGElement;
  private markers = $("#mapmarkers");
  private body = $("#tabbody");
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private pointEls = new Map<number, HTMLElement>();
  private stackEls = new Map<number, HTMLElement>();
  private busyUntil = 0;
  private lastBody = 0;
  private resize: () => void;
  private labels: { x: number; y: number; name: string; size: number }[] = [];

  constructor(world: World) {
    this.world = world;
    this.cam = new Camera(world.map.width, world.map.height, 14);
    this.renderer = new MapRenderer(world.map);
    this.resize = watchSize(this.view, [this.canvas], this.dpr, this.cam);
    bindGestures(this.view, () => this.cam, (x, y) => this.tap(x, y));

    $("#tabs").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
      if (b) this.setTab(b.dataset.tab as Tab);
    });
    // Während man tippt/scrollt, das Menü nicht neu aufbauen (sonst gehen Klicks verloren)
    const panel = $("#mapPanel");
    panel.addEventListener("pointerdown", () => (this.busyUntil = Infinity));
    panel.addEventListener("pointerup", () => (this.busyUntil = performance.now() + 400));
    panel.addEventListener("pointercancel", () => (this.busyUntil = performance.now() + 400));
    this.body.addEventListener("scroll", () => (this.busyUntil = performance.now() + 800));
    this.body.addEventListener("click", (e) => this.act(e));
    $("#dialog").addEventListener("click", (e) => this.act(e));
  }

  show() {
    this.view.hidden = false;
    $("#mapPanel").hidden = false;
    this.resize();
    this.world.dirty = true;
    this.renderBody(true);
  }

  hide() {
    this.view.hidden = true;
    $("#mapPanel").hidden = true;
  }

  focusCapital() {
    const cap = this.world.map.provinces[this.world.nations[this.world.player].capital];
    this.cam.zoom = Math.max(this.cam.fitZoom() * 2.2, 1.2);
    this.cam.centerOn(cap.x, cap.y);
  }

  // ============================================================ Zeichnen

  frame() {
    const w = this.world;
    if (w.dirty) {
      w.dirty = false;
      const selProv = this.sel.t === "prov" ? this.sel.id : -1;
      this.renderer.draw(w.owner, w.player, new Set(w.enemiesOf(w.player)), selProv);
      this.computeLabels();
    }
    const ctx = this.ctx;
    const z = this.cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1e2a33";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    ctx.drawImage(this.renderer.canvas, 0, 0);
    this.drawOverlay();
  }

  private computeLabels() {
    const w = this.world;
    const acc = w.nations.map(() => ({ x: 0, y: 0, n: 0 }));
    // nur das zusammenhängende Kernland um die Hauptstadt zählt für die Beschriftung
    for (const n of w.nations) {
      if (!n.alive) continue;
      const seen = new Set([n.capital]);
      const stack = [n.capital];
      while (stack.length) {
        const p = stack.pop()!;
        const pr = w.map.provinces[p];
        acc[n.id].x += pr.x;
        acc[n.id].y += pr.y;
        acc[n.id].n++;
        for (const [q] of pr.nb) {
          if (w.owner[q] === n.id && !seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
    }
    this.labels = [];
    for (const n of w.nations) {
      const a = acc[n.id];
      if (!n.alive || a.n === 0) continue;
      this.labels.push({ x: a.x / a.n, y: a.y / a.n, name: n.short.toUpperCase(), size: Math.sqrt(a.n) * 2.2 + 6 });
    }
  }

  private drawOverlay() {
    const w = this.world;
    const cam = this.cam;
    const parts: string[] = [];
    // Ländernamen
    for (const l of this.labels) {
      const p = cam.toScreen(l.x, l.y);
      const size = Math.max(9, Math.min(34, l.size * cam.zoom));
      parts.push(
        `<text x="${p.x}" y="${p.y}" class="nlabel" font-size="${size}" letter-spacing="${size * 0.15}">${l.name}</text>`,
      );
    }
    // Hauptstädte
    for (const n of w.nations) {
      if (!n.alive) continue;
      const pr = w.map.provinces[n.capital];
      const p = cam.toScreen(pr.x, pr.y);
      parts.push(`<text x="${p.x}" y="${p.y + 4}" class="cap">★</text>`);
    }
    // Eigene Truppen unterwegs
    for (const d of w.divisions.values()) {
      if (d.nation !== w.player || d.loc.t !== "move") continue;
      const a = cam.toScreen(...pos(w.divisionPos(d)));
      const b = cam.toScreen(d.loc.tx, d.loc.ty);
      parts.push(`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" class="route"/><circle cx="${a.x}" cy="${a.y}" r="4" class="mover"/>`);
    }
    // Ausgewählte Provinz
    if (this.sel.t === "prov") {
      const pr = w.map.provinces[this.sel.id];
      const p = cam.toScreen(pr.x, pr.y);
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="6" class="selmark"/>`);
    }
    this.svg.innerHTML = parts.join("");
    this.drawPointMarkers();
    this.drawStacks();
  }

  private drawPointMarkers() {
    const w = this.world;
    const alive = new Set<number>();
    for (const p of w.points) {
      alive.add(p.id);
      let el = this.pointEls.get(p.id);
      if (!el) {
        el = document.createElement("button");
        el.className = "fp";
        el.innerHTML = `<span class="gauge"><i></i></span><small></small>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.select({ t: "point", id: p.id });
        });
        this.markers.appendChild(el);
        this.pointEls.set(p.id, el);
      }
      const side = w.sideAt(p, w.player);
      const s = this.cam.toScreen(p.x, p.y);
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
      const bar = side === 1 ? -p.bar : p.bar;
      const fill = el.querySelector("i")!;
      fill.style.left = `${50 + Math.min(0, bar) / 2}%`;
      fill.style.width = `${Math.abs(bar) / 2}%`;
      fill.className = bar >= 0 ? "win" : "lose";
      el.classList.toggle("mine", side >= 0);
      el.classList.toggle("fight", !!p.battle);
      el.classList.toggle("sel", this.sel.t === "point" && this.sel.id === p.id);
      const small = el.querySelector("small")!;
      if (side >= 0) {
        const mine = p.strength[side];
        const theirs = p.strength[1 - side];
        small.textContent = `${fmt(mine)} : ${fmt(theirs)}`;
        el.classList.toggle("unguarded", mine === 0 && theirs > 0);
      } else small.textContent = "";
    }
    for (const [id, el] of this.pointEls) {
      if (!alive.has(id)) {
        el.remove();
        this.pointEls.delete(id);
      }
    }
  }

  private drawStacks() {
    const w = this.world;
    const count = new Map<number, number>();
    for (const d of w.divisions.values()) {
      if (d.nation === w.player && d.loc.t === "prov") count.set(d.loc.prov, (count.get(d.loc.prov) ?? 0) + 1);
    }
    for (const [prov, n] of count) {
      let el = this.stackEls.get(prov);
      if (!el) {
        el = document.createElement("button");
        el.className = "stack";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.select({ t: "prov", id: prov });
        });
        this.markers.appendChild(el);
        this.stackEls.set(prov, el);
      }
      const pr = w.map.provinces[prov];
      const s = this.cam.toScreen(pr.x, pr.y);
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
      el.textContent = `🪖${n}`;
    }
    for (const [prov, el] of this.stackEls) {
      if (!count.has(prov)) {
        el.remove();
        this.stackEls.delete(prov);
      }
    }
  }

  // ============================================================ Eingabe

  private tap(sx: number, sy: number) {
    const m = this.cam.toWorld(sx, sy);
    const x = Math.floor(m.x);
    const y = Math.floor(m.y);
    const map = this.world.map;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return this.select({ t: "none" });
    // Frontpunkt in der Nähe?
    let best: FrontPoint | null = null;
    let bd = 22 / this.cam.zoom;
    for (const p of this.world.points) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) return this.select({ t: "point", id: best.id });
    const prov = map.pixels[y * map.width + x];
    this.select(prov >= 0 ? { t: "prov", id: prov } : { t: "none" });
  }

  select(s: Selection) {
    this.sel = s;
    this.world.dirty = true;
    if (s.t !== "none") this.tab = "info";
    this.renderBody(true);
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.renderBody(true);
  }

  centerOn(x: number, y: number) {
    if (this.cam.zoom < this.cam.fitZoom() * 2) this.cam.zoom = this.cam.fitZoom() * 2.5;
    this.cam.centerOn(x, y);
  }

  // ============================================================ Menü

  hud() {
    const w = this.world;
    const n = w.nations[w.player];
    const r = n.res;
    const inc = n.income;
    const item = (icon: string, v: number, d: number, title: string) =>
      `<span class="res" title="${title}">${icon}${fmt(v)}<small class="${d < 0 ? "neg" : ""}">${d >= 0 ? "+" : ""}${fmt(d)}</small></span>`;
    $("#topinfo").innerHTML =
      item("💰", r.gold, inc.gold, "Gold (pro Tag)") +
      item("🌾", r.food, inc.food, "Nahrung (pro Tag)") +
      item("⚙", r.material, inc.material, "Material (pro Tag)") +
      item("👥", r.recruits, inc.recruits, "Rekruten (pro Tag)");
    this.renderBody(false);
  }

  renderBody(force: boolean) {
    const now = performance.now();
    if (!force && (now < this.busyUntil || now - this.lastBody < 900)) return;
    this.lastBody = now;
    document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === this.tab));
    const scroll = this.body.scrollTop;
    let html = "";
    if (this.tab === "info") html = this.infoTab();
    else if (this.tab === "army") html = this.armyTab();
    else if (this.tab === "recruit") html = this.recruitTab();
    else if (this.tab === "diplo") html = this.diploTab();
    else html = this.logTab();
    this.body.innerHTML = html;
    this.body.scrollTop = scroll;
  }

  private infoTab(): string {
    const w = this.world;
    if (this.sel.t === "point") {
      const p = w.point(this.sel.id);
      if (p) return this.pointInfo(p);
    }
    if (this.sel.t === "prov") return this.provInfo(this.sel.id);
    // Überblick
    const me = w.nations[w.player];
    const enemies = w.enemiesOf(w.player);
    const myPoints = w.points.filter((p) => w.sideAt(p, w.player) >= 0);
    let html = `<h3>${me.name}</h3>`;
    if (enemies.length === 0) {
      html += `<p class="muted">Frieden. Unter <b>Diplomatie</b> kannst du Kriege erklären. Ausbilden kostet Zeit – bereite dich vor.</p>`;
    } else {
      html += `<p>Im Krieg mit: ${enemies.map((e) => nationTag(w, e)).join(" ")}</p>`;
    }
    if (myPoints.length) {
      html += `<h4>Frontpunkte</h4><div class="list">`;
      for (const p of myPoints.sort((a, b) => this.dangerOf(b) - this.dangerOf(a))) html += this.pointRow(p);
      html += `</div>`;
    }
    html += `<p class="muted small">Tippe auf einen Frontpunkt (Balken auf der Grenze) für Details. Ab 70 % Anteil an der Gesamtstärke rückt die Front vor.</p>`;
    return html;
  }

  private dangerOf(p: FrontPoint) {
    const side = this.world.sideAt(p, this.world.player);
    return side === 1 ? p.bar : -p.bar;
  }

  private pointRow(p: FrontPoint): string {
    const w = this.world;
    const side = w.sideAt(p, w.player);
    const enemy = side === 0 ? p.b : p.a;
    const myProv = w.map.provinces[side === 0 ? p.provA : p.provB];
    const st = this.pointState(p);
    return `<button class="rowbtn" data-act="point" data-id="${p.id}">
      <span>${nationTag(w, enemy)} bei ${myProv.name}${p.battle ? " ⚔" : ""}</span>
      <small class="${st.cls}">${st.text}</small></button>`;
  }

  /** Zustand eines Punktes aus Sicht des Spielers */
  private pointState(p: FrontPoint): { text: string; cls: string; share: number } {
    const w = this.world;
    const side = Math.max(0, w.sideAt(p, w.player));
    const mine = p.strength[side];
    const theirs = p.strength[1 - side];
    const total = mine + theirs;
    const share = total > 0 ? mine / total : 0.5;
    const bar = side === 0 ? p.bar : -p.bar;
    if (total === 0) return { text: "keine Truppen", cls: "muted", share };
    if (share >= CAPTURE_SHARE) {
      const min = (100 - bar) / captureRate((1 - share) * 100);
      return { text: `wir rücken vor · noch ~${Math.ceil(min)} Tage`, cls: "good", share };
    }
    if (share <= 1 - CAPTURE_SHARE) {
      const min = (100 + bar) / captureRate(share * 100);
      return { text: `Feind rückt vor · noch ~${Math.ceil(min)} Tage`, cls: "bad", share };
    }
    return { text: "Stellungskrieg", cls: "", share };
  }

  private pointInfo(p: FrontPoint): string {
    const w = this.world;
    const side = w.sideAt(p, w.player);
    if (side < 0) {
      return `<h3>${nationTag(w, p.a)} gegen ${nationTag(w, p.b)}</h3>
        <p>Stärke ${fmt(p.strength[0])} : ${fmt(p.strength[1])}</p>
        ${p.battle ? `<button data-act="battle" data-id="${p.id}">Schlacht ansehen</button>` : ""}`;
    }
    const enemy = side === 0 ? p.b : p.a;
    const myProv = w.map.provinces[side === 0 ? p.provA : p.provB];
    const theirProv = w.map.provinces[side === 0 ? p.provB : p.provA];
    const st = this.pointState(p);
    const bar = side === 0 ? p.bar : -p.bar;
    const mine = w.divisionsAt(p.id, side);
    const coming = w.incomingTo(p.id, side);
    const principal = (side === 0 ? p.a : p.b) === w.player;
    let html = `<h3>Front gegen ${nationTag(w, enemy)}</h3>
      <p class="muted small">${myProv.name} ⟷ ${theirProv.name}</p>
      <div class="bigbar"><i class="${bar >= 0 ? "win" : "lose"}" style="left:${50 + Math.min(0, bar) / 2}%;width:${Math.abs(bar) / 2}%"></i><b style="left:50%"></b></div>
      <p><b style="color:var(--player)">${fmt(p.strength[side])}</b> : <b style="color:var(--enemy)">${fmt(p.strength[1 - side])}</b>
        · Anteil <b>${Math.round(st.share * 100)} %</b> · <span class="${st.cls}">${st.text}</span></p>`;
    if (p.battle) html += `<button class="wide primary" data-act="battle" data-id="${p.id}">⚔ Schlacht ansehen</button>`;
    else if (p.strength[1 - side] === 0 && p.strength[side] > 0)
      html += `<p class="good small">Der Feind hat hier keine Truppen – der Punkt fällt kampflos.</p>`;
    else if (p.strength[side] === 0) html += `<p class="bad small">Unbewacht! Schicke Truppen, bevor der Feind durchbricht.</p>`;

    if (principal) {
      html += `<h4>KI-Offiziere</h4><div class="row">`;
      for (let l = 0; l < 3; l++) {
        const s = p.stance[side][l];
        html += `<button class="stance ${s}" data-act="stance" data-id="${p.id}" data-lane="${l}"><small>${LANE_NAMES[l]}</small>${STANCE_NAMES[s]}</button>`;
      }
      html += `</div>`;
    }
    html += `<h4>Eigene Truppen hier (${mine.length})</h4><div class="list">`;
    for (const d of mine) html += this.divRow(d, `<button class="mini" data-act="withdraw" data-id="${d.id}">Abziehen</button>`);
    html += `</div>`;
    if (coming.length) {
      html += `<h4>Unterwegs (${coming.length})</h4><div class="list">`;
      for (const d of coming) {
        const left = d.loc.t === "move" ? d.loc.dur - d.loc.elapsed : 0;
        html += this.divRow(d, `<small>${days(left)}</small>`);
      }
      html += `</div>`;
    }
    html += `<button class="wide" data-act="sendto" data-id="${p.id}">＋ Truppen schicken</button>`;
    return html;
  }

  private provInfo(id: number): string {
    const w = this.world;
    const pr = w.map.provinces[id];
    const owner = w.owner[id];
    const typeName = { land: "Ländlich", agrar: "Ackerland", industrie: "Industrie", stadt: "Stadt" }[pr.type];
    const isCap = w.nations[owner].capital === id;
    let html = `<h3>${pr.name}${isCap ? " ★" : ""}</h3>
      <p>${nationTag(w, owner)} · ${typeName} · ${fmt(pr.area)} km²${pr.nation !== owner ? ` · <span class="muted">besetzt (vorher ${w.nations[pr.nation].short})</span>` : ""}</p>`;
    const here = [...w.divisions.values()].filter((d) => d.nation === w.player && d.loc.t === "prov" && d.loc.prov === id);
    if (here.length) {
      html += `<h4>Eigene Truppen (${here.length})</h4><div class="list">`;
      for (const d of here) html += this.divRow(d, `<button class="mini" data-act="senddiv" data-id="${d.id}">Senden</button>`);
      html += `</div>`;
    }
    return html;
  }

  private divRow(d: Division, right: string) {
    const u = UNITS[d.kind];
    const pct = Math.round((d.soldiers / u.size) * 100);
    const shown = d.kind === "infantry" ? `${d.soldiers} Mann` : `${d.soldiers}/${u.size}`;
    const who = d.nation !== this.world.player ? `${nationTag(this.world, d.nation)} ` : "";
    return `<div class="divrow"><span>${who}${KIND_ICON[d.kind]} ${d.name}<small> ${shown} · ${pct} %</small></span>${right}</div>`;
  }

  private armyTab(): string {
    const w = this.world;
    const mine = [...w.divisions.values()].filter((d) => d.nation === w.player);
    const idle = mine.filter((d) => d.loc.t === "prov");
    const moving = mine.filter((d) => d.loc.t === "move");
    const front = mine.filter((d) => d.loc.t === "front");
    const power = mine.reduce((s, d) => s + w.divisionPower(d), 0);
    let html = `<p>${mine.length} Verbände · Kampfkraft <b>${fmt(power)}</b>${w.nations[w.player].hungry ? ` · <span class="bad">Hunger!</span>` : ""}</p>`;
    html += `<h4>Bereit (${idle.length})</h4><div class="list">`;
    for (const d of idle) html += this.divRow(d, `<button class="mini" data-act="senddiv" data-id="${d.id}">Senden</button>`);
    html += `</div>`;
    if (moving.length) {
      html += `<h4>Unterwegs (${moving.length})</h4><div class="list">`;
      for (const d of moving) html += this.divRow(d, `<small>${d.loc.t === "move" ? days(d.loc.dur - d.loc.elapsed) : ""}</small>`);
      html += `</div>`;
    }
    if (front.length) {
      html += `<h4>An der Front (${front.length})</h4><div class="list">`;
      for (const d of front)
        html += this.divRow(d, `<button class="mini" data-act="senddiv" data-id="${d.id}">Verlegen</button>`);
      html += `</div>`;
    }
    return html;
  }

  private recruitTab(): string {
    const w = this.world;
    const n = w.nations[w.player];
    let html = `<p class="muted small">Neue Verbände werden in der Hauptstadt ausgebildet (1 Minute = 1 Tag).</p><div class="cards">`;
    for (const kind of Object.keys(UNITS) as UnitKind[]) {
      const u = UNITS[kind];
      const c = u.cost;
      const ok = n.res.gold >= c.gold && n.res.material >= c.material && n.res.recruits >= c.recruits;
      html += `<div class="card2"><b>${KIND_ICON[kind]} ${u.name}</b>
        <small>${u.size} ${KIND_UNIT[kind]} · Kampfkraft ${fmt(u.size * u.power)} · ${days(u.trainTime)}</small>
        <small>💰${c.gold} ⚙${c.material} 👥${c.recruits}</small>
        <button ${ok ? "" : "disabled"} data-act="recruit" data-kind="${kind}">Ausbilden</button></div>`;
    }
    html += `</div>`;
    if (n.queue.length) {
      html += `<h4>In Ausbildung</h4><div class="list">`;
      n.queue.forEach((q, i) => {
        const u = UNITS[q.kind];
        html += `<div class="divrow"><span>${KIND_ICON[q.kind]} ${u.name}</span><small>${i === 0 ? days(q.left) : "wartet"}</small></div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  private diploTab(): string {
    const w = this.world;
    let html = `<div class="list">`;
    for (const n of w.nations) {
      if (n.id === w.player || !n.alive) continue;
      const war = w.atWar(w.player, n.id);
      const ally = w.allied(w.player, n.id);
      const op = n.opinion[w.player];
      const status = war ? `<span class="bad">Krieg</span>` : ally ? `<span class="good">Verbündet</span>` : "Frieden";
      const action = war
        ? `<button class="mini" data-act="peace" data-id="${n.id}">Frieden anbieten</button>`
        : ally
          ? ""
          : `<button class="mini danger" data-act="declare" data-id="${n.id}">Krieg erklären</button>`;
      html += `<div class="divrow"><span>${nationTag(w, n.id)} <small>${status} · Meinung ${op > 0 ? "+" : ""}${Math.round(op)}${n.allies.length ? ` · Bündnis: ${n.allies.map((a) => w.nations[a].short).join(", ")}` : ""}</small></span>${action}</div>`;
    }
    html += `</div>`;
    return html;
  }

  private logTab(): string {
    const w = this.world;
    let html = `<button class="wide ${w.autoPause ? "on" : ""}" data-act="autopause">Auto-Pause bei wichtigen Ereignissen: ${w.autoPause ? "an" : "aus"}</button><div class="list">`;
    for (const e of [...w.events].reverse().slice(0, 60)) {
      const date = new Date(Date.UTC(1914, 6, 28) + Math.floor(e.time / SECONDS_PER_DAY) * 86400000).toLocaleDateString("de-DE", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      const act = e.point !== undefined ? `data-act="point" data-id="${e.point}"` : e.prov !== undefined ? `data-act="prov" data-id="${e.prov}"` : "";
      html += `<div class="logrow ${e.kind}" ${act}><small>${date}</small> ${e.text}</div>`;
    }
    html += `</div>`;
    return html;
  }

  // ============================================================ Aktionen

  private act(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el) return;
    const w = this.world;
    const id = Number(el.dataset.id);
    switch (el.dataset.act) {
      case "point": {
        const p = w.point(id);
        if (p) {
          this.select({ t: "point", id });
          this.centerOn(p.x, p.y);
        }
        break;
      }
      case "prov": {
        const pr = w.map.provinces[id];
        this.select({ t: "prov", id });
        this.centerOn(pr.x, pr.y);
        break;
      }
      case "battle":
        this.onOpenBattle(id);
        break;
      case "stance": {
        const p = w.point(id);
        if (!p) break;
        const side = w.sideAt(p, w.player);
        const lane = Number(el.dataset.lane);
        const cur = p.stance[side][lane];
        w.setStance(id, side, lane, STANCE_ORDER[(STANCE_ORDER.indexOf(cur) + 1) % 4]);
        break;
      }
      case "withdraw":
        w.withdraw(id);
        break;
      case "sendto":
        this.sendDialog(id);
        return;
      case "senddiv":
        this.pointPicker(id);
        return;
      case "dosend": {
        const pointId = Number(el.dataset.point);
        const boxes = document.querySelectorAll<HTMLInputElement>("#dialog input[type=checkbox]:checked");
        boxes.forEach((b) => w.send(Number(b.value), { t: "front", point: pointId }));
        closeDialog();
        break;
      }
      case "pickall": {
        document.querySelectorAll<HTMLInputElement>("#dialog input[type=checkbox]").forEach((b) => (b.checked = true));
        return;
      }
      case "sendone":
        w.send(Number(el.dataset.div), { t: "front", point: id });
        closeDialog();
        break;
      case "close":
        closeDialog();
        return;
      case "recruit":
        w.recruit(w.player, el.dataset.kind as UnitKind);
        break;
      case "declare":
        this.confirm(`${w.nations[id].name} wirklich den Krieg erklären? Ihre Verbündeten werden ebenfalls kämpfen.`, () =>
          w.declareWar(w.player, id),
        );
        return;
      case "peace":
        w.offerPeace(w.player, id);
        break;
      case "autopause":
        w.autoPause = !w.autoPause;
        break;
      case "yes":
        this.confirmAct?.();
        this.confirmAct = null;
        closeDialog();
        break;
    }
    this.renderBody(true);
  }

  private confirmAct: (() => void) | null = null;

  private confirm(text: string, act: () => void) {
    this.confirmAct = act;
    openDialog(`<p>${text}</p><div class="row"><button data-act="close">Abbrechen</button><button class="danger" data-act="yes">Ja</button></div>`);
  }

  /** Mehrere Divisionen an einen Frontpunkt schicken. */
  private sendDialog(pointId: number) {
    const w = this.world;
    const p = w.point(pointId);
    if (!p) return;
    const avail = [...w.divisions.values()].filter(
      (d) => d.nation === w.player && !(d.loc.t === "front" && d.loc.point === pointId) && !(d.loc.t === "move" && d.loc.dest.t === "front" && d.loc.dest.point === pointId),
    );
    avail.sort((a, b) => Number(b.loc.t === "prov") - Number(a.loc.t === "prov") || w.travelTime(w.divisionPos(a), p) - w.travelTime(w.divisionPos(b), p));
    let html = `<h3>Truppen schicken</h3><p class="muted small">Wähle Verbände. Truppen von anderen Fronten fehlen dort dann!</p><div class="list pick">`;
    for (const d of avail) {
      const where = d.loc.t === "prov" ? "bereit" : d.loc.t === "move" ? "unterwegs" : "an anderer Front";
      html += `<label class="divrow"><span><input type="checkbox" value="${d.id}" ${d.loc.t === "prov" ? "" : ""}> ${KIND_ICON[d.kind]} ${d.name}<small> ${where} · Anreise ${days(w.travelTime(w.divisionPos(d), p))}</small></span></label>`;
    }
    if (avail.length === 0) html += `<p class="muted">Keine Verbände verfügbar. Bilde neue aus!</p>`;
    html += `</div><div class="row"><button data-act="close">Abbrechen</button><button data-act="pickall">Alle</button><button class="primary" data-act="dosend" data-point="${pointId}">Schicken</button></div>`;
    openDialog(html);
  }

  /** Eine Division an einen Frontpunkt schicken. */
  private pointPicker(divId: number) {
    const w = this.world;
    const d = w.divisions.get(divId);
    if (!d) return;
    const points = w.points.filter((p) => w.sideAt(p, w.player) >= 0);
    let html = `<h3>${d.name} verlegen</h3><div class="list">`;
    for (const p of points.sort((a, b) => this.dangerOf(b) - this.dangerOf(a))) {
      const st = this.pointState(p);
      const side = w.sideAt(p, w.player);
      const enemy = side === 0 ? p.b : p.a;
      const prov = w.map.provinces[side === 0 ? p.provA : p.provB];
      html += `<button class="rowbtn" data-act="sendone" data-id="${p.id}" data-div="${d.id}"><span>${nationTag(w, enemy)} bei ${prov.name}</span><small class="${st.cls}">${st.text} · Anreise ${days(w.travelTime(w.divisionPos(d), p))}</small></button>`;
    }
    if (points.length === 0) html += `<p class="muted">Keine Fronten – du bist im Frieden.</p>`;
    html += `</div><button class="wide" data-act="close">Abbrechen</button>`;
    openDialog(html);
  }
}

function pos(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}

function nationTag(w: World, n: number) {
  const nat = w.nations[n];
  return `<span class="ntag" style="--c:${nat.color}">${nat.short}</span>`;
}

function days(seconds: number) {
  const d = Math.max(0, seconds / SECONDS_PER_DAY);
  return d < 1 ? "< 1 Tag" : `${Math.ceil(d)} Tage`;
}

function openDialog(html: string) {
  const d = $("#dialog");
  d.innerHTML = `<div class="card">${html}</div>`;
  d.hidden = false;
}

function closeDialog() {
  const d = $("#dialog");
  d.hidden = true;
  d.innerHTML = "";
}
