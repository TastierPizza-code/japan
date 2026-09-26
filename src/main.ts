import "./style.css";
import { BattleAI } from "./sim/ai.ts";
import { Battle, type Company } from "./sim/battle.ts";
import { ENEMY, PLAYER, RESERVE_COOLDOWN, TICK, TRENCH_Y, UNIT_MAGE } from "./sim/config.ts";
import { Camera } from "./render/camera.ts";
import { GlRenderer } from "./render/glRenderer.ts";
import { TerrainPainter } from "./render/terrainPainter.ts";
import { Overlay, shortName } from "./ui/overlay.ts";

type Mode = "none" | "storm" | "arty";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

class Game {
  battle!: Battle;
  ai!: BattleAI;
  painter!: TerrainPainter;
  cam = new Camera();
  gl: GlRenderer;
  overlay!: Overlay;
  bg = $<HTMLCanvasElement>("#bg");
  bgCtx = this.bg.getContext("2d")!;
  stage = $("#stage");
  dpr = Math.min(2, window.devicePixelRatio || 1);

  paused = true;
  speed = 1;
  selected = -1;
  mode: Mode = "none";
  private acc = 0;
  private last = performance.now();
  private hudTimer = 0;
  private resultShown = false;
  private chipEls = new Map<number, HTMLButtonElement>();

  constructor() {
    this.gl = new GlRenderer($<HTMLCanvasElement>("#gl"));
    this.newBattle();
    this.bindInput();
    this.bindButtons();
    // Das Spielfeld ändert seine Größe auch, wenn sich das Menü unten füllt
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.resize();
    this.cam.fit();
    this.showBriefing();
    requestAnimationFrame((t) => this.frame(t));
  }

  newBattle() {
    const seed = (Math.random() * 1e9) | 0;
    this.battle = new Battle(seed);
    this.ai = new BattleAI(ENEMY);
    this.painter = new TerrainPainter(this.battle.terrain);
    this.selected = -1;
    this.mode = "none";
    this.resultShown = false;
    $("#flags").innerHTML = "";
    $("#chips").innerHTML = "";
    this.chipEls.clear();
    this.overlay = new Overlay($("#overlay") as unknown as SVGSVGElement, $("#flags"), (id) => this.select(id));
  }

  // ------------------------------------------------------------ Hauptschleife

  frame(now: number) {
    const real = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let simDt = 0;
    if (!this.paused && !this.battle.result) {
      this.acc += real * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 10) {
        this.ai.update(this.battle, TICK);
        this.battle.update(TICK);
        this.drainEvents();
        this.acc -= TICK;
        simDt += TICK;
        steps++;
      }
      if (steps === 10) this.acc = 0;
    }
    this.draw(simDt);
    this.hudTimer -= real;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      this.updateHud();
    }
    if (this.battle.result && !this.resultShown) this.showResult();
    requestAnimationFrame((t) => this.frame(t));
  }

  private drainEvents() {
    const e = this.battle.events;
    for (let i = 0; i < e.deaths.length; i += 4) this.painter.corpse(e.deaths[i], e.deaths[i + 1], e.deaths[i + 2]);
    for (let i = 0; i < e.craters.length; i += 3) this.painter.crater(e.craters[i], e.craters[i + 1], e.craters[i + 2]);
    this.gl.ingest(this.battle);
    this.battle.clearEvents();
  }

  private draw(simDt: number) {
    const ctx = this.bgCtx;
    const z = this.cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1914";
    ctx.fillRect(0, 0, this.bg.width, this.bg.height);
    ctx.imageSmoothingEnabled = this.cam.zoom < 1;
    ctx.setTransform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    ctx.drawImage(this.painter.canvas, 0, 0);
    this.gl.selected = this.selected;
    this.gl.render(this.battle, this.cam, this.dpr, simDt);
    this.overlay.update(this.battle, this.cam, this.selected);
  }

  private resize() {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const wasFit = Math.abs(this.cam.zoom - this.cam.fitZoom()) < 1e-3;
    const center = this.cam.toWorld(this.cam.viewW / 2, this.cam.viewH / 2);
    for (const c of [this.bg, $<HTMLCanvasElement>("#gl")]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.cam.resize(r.width, r.height);
    if (wasFit) this.cam.fit();
    else this.cam.centerOn(center.x, center.y);
  }

  // ---------------------------------------------------------------- Befehle

  select(id: number) {
    const c = this.battle.companies[id];
    if (!c || c.side !== PLAYER || c.alive <= 0) id = -1;
    this.selected = this.selected === id ? -1 : id;
    if (this.mode === "storm") this.setMode("none");
    this.updateHud();
  }

  private tap(sx: number, sy: number) {
    const w = this.cam.toWorld(sx, sy);
    const b = this.battle;
    if (this.mode === "arty") {
      if (b.callArtillery(PLAYER, w.x, w.y)) this.setMode("none");
      this.updateHud();
      return;
    }
    const sel = b.companies[this.selected];
    if (sel && sel.alive > 0) {
      if (this.mode === "storm") {
        b.orderStorm(sel.id, w.x, w.y);
        this.setMode("none");
      } else {
        b.orderMove(sel.id, w.x, w.y);
      }
      this.updateHud();
      return;
    }
    // Nichts ausgewählt: nächste eigene Kompanie in der Nähe auswählen
    let best: Company | null = null;
    let bd = 50 / this.cam.zoom;
    for (const c of b.companies) {
      if (c.side !== PLAYER || c.alive <= 0) continue;
      const d = Math.hypot(c.cx - w.x, c.cy - w.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) this.select(best.id);
  }

  private order(kind: string) {
    const b = this.battle;
    if (this.selected < 0) return;
    if (kind === "hold") b.orderHold(this.selected);
    else if (kind === "retreat") b.orderRetreat(this.selected);
    else if (kind === "storm") this.setMode(this.mode === "storm" ? "none" : "storm");
    this.updateHud();
  }

  private setMode(m: Mode) {
    this.mode = m;
    const bar = $("#modebar");
    bar.hidden = m === "none";
    $("#modetext").textContent =
      m === "arty" ? "Artillerie: Zielgebiet antippen" : m === "storm" ? "Sturmangriff: Ziel antippen" : "";
    $("#arty").classList.toggle("on", m === "arty");
    $('[data-order="storm"]').classList.toggle("on", m === "storm");
  }

  private togglePause(force?: boolean) {
    this.paused = force ?? !this.paused;
    $("#pause").textContent = this.paused ? "▶" : "⏸";
    $("#pause").classList.toggle("on", this.paused);
  }

  // ------------------------------------------------------------------ Eingabe

  private bindInput() {
    const pointers = new Map<number, { x: number; y: number }>();
    let dragDist = 0;
    let pinchDist = 0;
    const el = this.stage;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener("pointerdown", (e) => {
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
      if (pointers.size === 1) {
        dragDist += Math.hypot(p.x - prev.x, p.y - prev.y);
        if (dragDist > 8) this.cam.pan(p.x - prev.x, p.y - prev.y);
      } else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d = Math.hypot(p.x - other.x, p.y - other.y);
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        if (pinchDist > 0) this.cam.zoomAt(mid.x, mid.y, d / pinchDist);
        this.cam.pan((p.x - prev.x) / 2, (p.y - prev.y) / 2);
        pinchDist = d;
      }
      pointers.set(e.pointerId, p);
    });
    const up = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (p && pointers.size === 0 && dragDist <= 8 && e.type === "pointerup") this.tap(p.x, p.y);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.cam.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (e.key === " ") {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === "1" || e.key === "2" || e.key === "3") this.setSpeed([1, 2, 4][+e.key - 1]);
      else if (e.key === "h") this.order("hold");
      else if (e.key === "s") this.order("storm");
      else if (e.key === "r") this.order("retreat");
      else if (e.key === "a") this.setMode(this.mode === "arty" ? "none" : "arty");
      else if (e.key === "Escape") {
        if (this.mode !== "none") this.setMode("none");
        else this.select(-1);
      }
    });
  }

  private setSpeed(s: number) {
    this.speed = s;
    document.querySelectorAll<HTMLButtonElement>(".speed").forEach((b) => b.classList.toggle("on", +b.dataset.speed! === s));
    if (this.paused) this.togglePause(false);
  }

  private bindButtons() {
    $("#pause").addEventListener("click", () => this.togglePause());
    document.querySelectorAll<HTMLButtonElement>(".speed").forEach((b) =>
      b.addEventListener("click", () => this.setSpeed(+b.dataset.speed!)),
    );
    document.querySelectorAll<HTMLButtonElement>("#orders button").forEach((b) =>
      b.addEventListener("click", () => this.order(b.dataset.order!)),
    );
    $("#arty").addEventListener("click", () => this.setMode(this.mode === "arty" ? "none" : "arty"));
    $("#modecancel").addEventListener("click", () => this.setMode("none"));
    $("#reserve").addEventListener("click", () => {
      this.battle.callReserve(PLAYER);
      this.updateHud();
    });
    $("#fit").addEventListener("click", () => this.cam.fit());
    this.setSpeed(1);
    this.togglePause(true);
  }

  // --------------------------------------------------------------------- HUD

  private updateHud() {
    const b = this.battle;
    const m = Math.floor(b.time / 60);
    const s = Math.floor(b.time % 60);
    $("#clock").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    const objs = b.objectives
      .map((o) => `<i style="background:${o.owner === PLAYER ? "var(--player)" : "var(--enemy)"}"></i>`)
      .join("");
    $("#strength").innerHTML =
      `<span style="color:var(--player)">${b.groundStrength(PLAYER)}</span>` +
      `<span class="objs">${objs}</span>` +
      `<span style="color:var(--enemy)">${b.groundStrength(ENEMY)}</span>`;

    const side = b.sides[PLAYER];
    const arty = $<HTMLButtonElement>("#arty");
    arty.textContent = `Artillerie (${side.artyCharges})` + (side.artyCharges < 3 ? ` ${Math.ceil(side.artyTimer)}s` : "");
    arty.disabled = side.artyCharges === 0 && this.mode !== "arty";
    const res = $<HTMLButtonElement>("#reserve");
    res.textContent = `Reserve (${side.reserves})` + (side.reserveCooldown > 0 ? ` ${Math.ceil(side.reserveCooldown)}s` : "");
    res.disabled = side.reserves === 0 || side.reserveCooldown > 0;
    res.title = `Neue Kompanie von hinten, danach ${RESERVE_COOLDOWN}s Wartezeit`;

    const sel = b.companies[this.selected];
    if (sel && sel.alive <= 0) this.selected = -1;
    const hasSel = this.selected >= 0;
    document.querySelectorAll<HTMLButtonElement>("#orders button").forEach((btn) => {
      btn.disabled = !hasSel || sel.order === "rout";
    });
    $("#selinfo").innerHTML = hasSel ? this.describe(sel) : "Tippe auf eine eigene Kompanie (blaue Fahne), um sie zu befehligen.";

    for (const c of b.companies) {
      if (c.side !== PLAYER) continue;
      let chip = this.chipEls.get(c.id);
      if (!chip) {
        chip = document.createElement("button");
        chip.addEventListener("click", () => {
          this.select(c.id);
          if (this.selected === c.id && this.cam.zoom > this.cam.fitZoom() * 1.3) this.cam.centerOn(c.cx, c.cy);
        });
        $("#chips").appendChild(chip);
        this.chipEls.set(c.id, chip);
      }
      chip.hidden = c.alive <= 0;
      chip.classList.toggle("sel", c.id === this.selected);
      const color = moraleColor(c);
      chip.innerHTML = `<span style="color:${color}">■</span> ${shortName(c)} ${c.type === UNIT_MAGE ? "Magier" : ""}<small>${c.alive} · ${orderText(c)}</small>`;
    }
  }

  private describe(c: Company) {
    const bar = (v: number, col: string) => `<span class="meter"><i style="width:${Math.max(0, v)}%;background:${col}"></i></span>`;
    const second =
      c.type === UNIT_MAGE
        ? `Mana ${bar(c.mana, "#7ff0ff")} · Schild hält · Reichweite 230`
        : `Moral ${bar(c.morale, moraleColor(c))} · ${orderText(c)}`;
    const hint =
      this.mode === "storm" ? "" : c.order === "rout" ? " · <b>flieht, sammelt sich hinten</b>" : " · Karte antippen = Position";
    return `<b>${c.name}</b> · ${c.alive}/${c.initial} Mann${hint}<br>${second}`;
  }

  // ----------------------------------------------------------------- Dialoge

  private showBriefing() {
    const d = $("#dialog");
    d.hidden = false;
    d.innerHTML = `<div class="card">
      <h1>Grabenfront</h1>
      <h2>Westfront, Abschnitt „Höhe 217“ · Das Spiel ist pausiert, bis du startest.</h2>
      <ul>
        <li><b>Ziel:</b> Nimm alle drei feindlichen Grabenstellungen (rote Fahnen) ein oder zerschlage die feindliche Armee.</li>
        <li><b>Kompanie antippen</b> (blaue Fahne oder Liste unten), dann <b>Karte antippen</b>: Sie rückt dorthin vor und sucht Deckung.</li>
        <li><b>Sturm!</b> Rennt ohne Halt zum Ziel und greift im Nahkampf an. Teuer gegen MGs!</li>
        <li><b>Artillerie</b> schlägt nach 6 Sekunden ein. Trifft auch deine eigenen Leute.</li>
        <li><b>Magier ✦</b> fliegen über das Niemandsland und müssen zum Aufladen zurück.</li>
        <li>Jederzeit <b>pausieren</b> und in Ruhe Befehle geben. Ziehen = Karte verschieben, zwei Finger/Mausrad = Zoom.</li>
      </ul>
      <button id="start">Zum Angriff!</button>
    </div>`;
    $("#start").addEventListener("click", () => {
      d.hidden = true;
      this.togglePause(false);
    });
  }

  private showResult() {
    this.resultShown = true;
    const r = this.battle.result!;
    const won = r.winner === PLAYER;
    const b = this.battle;
    const lost = (s: number) =>
      b.companies.filter((c) => c.side === s).reduce((n, c) => n + (c.initial - c.alive), 0);
    const d = $("#dialog");
    d.hidden = false;
    d.innerHTML = `<div class="card">
      <h1>${won ? "Sieg!" : "Niederlage"}</h1>
      <h2>${r.reason} · Dauer ${Math.floor(b.time / 60)} Minuten</h2>
      <ul>
        <li>Eigene Verluste: <b>${lost(PLAYER)}</b></li>
        <li>Feindliche Verluste: <b>${lost(ENEMY)}</b></li>
      </ul>
      <button id="again">Neues Gefecht</button>
    </div>`;
    $("#again").addEventListener("click", () => {
      d.hidden = true;
      this.newBattle();
      this.cam.fit();
      this.showBriefing();
      this.togglePause(true);
    });
  }
}

function moraleColor(c: Company) {
  if (c.type === UNIT_MAGE) return "#7ff0ff";
  if (c.order === "rout") return "var(--bad)";
  return c.morale > 60 ? "var(--ok)" : c.morale > 35 ? "var(--warn)" : "var(--bad)";
}

function orderText(c: Company) {
  switch (c.order) {
    case "storm":
      return "stürmt";
    case "retreat":
      return "zieht sich zurück";
    case "rout":
      return "flieht!";
    default: {
      if (c.type === UNIT_MAGE) return c.mana < 20 ? "erschöpft" : "einsatzbereit";
      const moving = Math.hypot(c.cx - c.tx, c.cy - c.ty) > 15;
      if (moving) return "rückt vor";
      return Math.abs(c.cy - TRENCH_Y[PLAYER]) < 40 ? "hält Graben" : "hält Stellung";
    }
  }
}

// Für Debugging in der Browser-Konsole: game.battle, game.cam …
(window as unknown as { game: Game }).game = new Game();
