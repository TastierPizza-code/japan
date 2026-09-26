import type { BattleAI, Stance } from "../sim/ai.ts";
import type { Battle, Company } from "../sim/battle.ts";
import { BLOOD_FADE, METERS_PER_UNIT, PLAYER, RESERVE_COOLDOWN, STATS, UNIT_GUN, UNIT_MAGE, UNIT_TANK } from "../sim/config.ts";
import { BIOME_NAMES } from "../sim/terrain.ts";
import { BattleAudio } from "../render/audio.ts";
import { Camera } from "../render/camera.ts";
import { GlRenderer, STYLE_NAMES, type RenderStyle } from "../render/glRenderer.ts";
import { BloodLayer, TerrainPainter } from "../render/terrainPainter.ts";
import { STANCE_NAMES, type World } from "../world/world.ts";
import { bindGestures, watchSize } from "./gestures.ts";
import { Overlay, shortName } from "./overlay.ts";

type Mode = "none" | "arty" | "smoke" | "gas" | "plan" | "blast" | "dome";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface BattleContext {
  battle: Battle;
  /** Kampagne: die Welt und der Frontpunkt, zu dem die Schlacht gehört */
  world?: World;
  pointId?: number;
  /** Der Spieler führt keine Seite (fremde Schlacht) */
  spectator: boolean;
  /** Die KI-Offiziere des Spielers (führen alles, was der Spieler nicht selbst übernimmt) */
  officer?: BattleAI;
}

const STANCE_ORDER: Stance[] = ["hold", "defensive", "balanced", "aggressive"];
const LANE_NAMES = ["Links", "Mitte", "Rechts"];

/** Ansicht einer laufenden Schlacht: Darstellung, Auswahl und Befehle. */
/** Reserve hinter dem Abschnitt und Nachschubtempo beider Seiten (Kampagne) */
function reserveInfo(b: Battle, me: number): string {
  const tempo = (every: number) => (every <= 0 ? "leer" : every <= 8 ? "schnell" : every <= 18 ? "mittel" : "langsam");
  const one = (s: number, color: string) =>
    `<span style="color:var(${color})">${fmt(b.sides[s].pool)} · ${tempo(b.sides[s].flowEvery)}</span>`;
  return `<small class="reserve" title="Reserve: Soldaten, die hinter diesem Abschnitt warten. Große Reserven füllen Lücken schneller auf.">Reserve ${one(me, "--player")} : ${one(1 - me, "--enemy")}</small>`;
}

export class BattleView {
  ctx: BattleContext | null = null;
  cam = new Camera();
  selected = -1;
  mode: Mode = "none";
  private gl: GlRenderer;
  private painter: TerrainPainter | null = null;
  private overlay!: Overlay;
  private bg = $<HTMLCanvasElement>("#bg");
  private bgCtx = this.bg.getContext("2d")!;
  private stage = $("#stage");
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private chipEls = new Map<number, HTMLButtonElement>();
  private resize: () => void;
  private blood = new BloodLayer();
  audio = new BattleAudio();

  constructor() {
    this.gl = new GlRenderer($<HTMLCanvasElement>("#gl"));
    try {
      const st = localStorage.getItem("grabenfront.style") as RenderStyle | null;
      if (st && st in STYLE_NAMES) this.gl.style = st;
    } catch {
      /* ohne Speicher */
    }
    this.gl.onSound = (kind, x, y, big) => this.sound(kind, x, y, big ?? 1);
    $("#styleBtn").addEventListener("click", () => this.cycleStyle());
    this.resize = watchSize(this.stage, [this.bg, $<HTMLCanvasElement>("#gl")], this.dpr, this.cam);
    bindGestures(this.stage, () => this.cam, (x, y) => this.tap(x, y));
    document.querySelectorAll<HTMLButtonElement>("#orders button").forEach((b) =>
      b.addEventListener("click", () => this.order(b.dataset.order!)),
    );
    $("#arty").addEventListener("click", () => this.setMode(this.mode === "arty" ? "none" : "arty"));
    $("#smokeBtn").addEventListener("click", () => this.setMode(this.mode === "smoke" ? "none" : "smoke"));
    $("#planBtn").addEventListener("click", () => this.planButton());
    $("#generalBtn").addEventListener("click", () => this.generalButton());
    $("#retreatAllBtn").addEventListener("click", () => {
      if (this.ctx?.officer && !this.ctx.spectator) this.ctx.officer.fullRetreat(this.battle);
      this.hud();
    });
    $("#gasBtn").addEventListener("click", () => this.setMode(this.mode === "gas" ? "none" : "gas"));
    $("#modecancel").addEventListener("click", () => this.setMode("none"));
    $("#reserve").addEventListener("click", () => {
      this.ctx?.battle.callReserve(PLAYER);
      this.hud();
    });
    $("#fit").addEventListener("click", () => this.cam.fit());
    $("#flankRow").addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-lane]");
      if (btn) this.cycleStance(+btn.dataset.lane!);
    });
  }

  get battle() {
    return this.ctx!.battle;
  }

  open(ctx: BattleContext) {
    this.ctx = ctx;
    // Alte Meldungen (aus der Zeit, in der niemand hinsah) nicht nachträglich zeigen
    if (ctx.officer) ctx.officer.reports.length = 0;
    // Solange du zuschaust, halten die Offiziere eine Batterie für dich frei
    if (ctx.officer && !ctx.spectator) ctx.officer.keepBatteries = 1;
    this.painter = new TerrainPainter(ctx.battle.terrain, this.gl.atlas);
    this.painter.replay(ctx.battle.corpses, ctx.battle.scars);
    this.blood = new BloodLayer();
    ctx.battle.clearEvents();
    this.gl.viewerSide = PLAYER;
    $("#styleBtn").textContent = `Darstellung: ${STYLE_NAMES[this.gl.style]}`;
    this.gl.reset();
    this.selected = -1;
    this.setMode("none");
    $("#flags").innerHTML = "";
    $("#chips").innerHTML = "";
    this.chipEls.clear();
    this.overlay = new Overlay($("#overlay") as unknown as SVGSVGElement, $("#flags"), (id) => this.select(id));
    this.stage.hidden = false;
    $("#panel").hidden = false;
    this.resize();
    this.cam.fit();
    const campaign = !!ctx.world;
    $("#reserve").hidden = campaign;
    // Du führst die Magier, alles andere führen die Offiziere
    for (const c of ctx.battle.companies) if (c.side === PLAYER && !commandable(c)) c.manual = false;
    $("#orders").hidden = ctx.spectator;
    $("#support").hidden = ctx.spectator;
    this.hud();
  }

  close() {
    if (this.ctx?.officer) this.ctx.officer.keepBatteries = 0;
    this.ctx = null;
    this.painter = null;
    this.stage.hidden = true;
    $("#panel").hidden = true;
    $("#modebar").hidden = true;
  }

  /** Meldungen der eigenen Offiziere (main zeigt sie als Toast) */
  onReport: ((text: string, kind: string, x: number, y: number) => void) | null = null;

  /** Kamera auf eine gemeldete Stelle richten */
  focus(x: number, y: number) {
    if (!this.ctx) return;
    this.cam.zoom = Math.max(this.cam.zoom, 0.8);
    this.cam.centerOn(x, y);
  }

  /** Einmal pro Bild: Ereignisse übernehmen und zeichnen. */
  frame(simDt: number) {
    if (!this.ctx || !this.painter) return;
    const off = this.ctx.officer;
    if (off && off.reports.length > 0) {
      for (const r of off.reports.splice(0)) if (!this.ctx.spectator) this.onReport?.(r.text, r.kind, r.x, r.y);
    }
    const b = this.battle;
    const e = b.events;
    const painter = this.painter;
    for (let i = 0; i < e.deaths.length; i += 5) {
      const type = e.deaths[i + 3];
      if (type === UNIT_TANK || type === UNIT_GUN || type === UNIT_MAGE) continue;
      painter.corpse(e.deaths[i], e.deaths[i + 1], e.deaths[i + 2], e.deaths[i + 4]);
    }
    for (let i = 0; i < e.craters.length; i += 3) painter.crater(e.craters[i], e.craters[i + 1], e.craters[i + 2]);
    for (let i = 0; i < e.tracks.length; i += 3) painter.track(e.tracks[i], e.tracks[i + 1], e.tracks[i + 2]);
    for (let i = 0; i < e.wrecks.length; i += 3) painter.wreck(e.wrecks[i], e.wrecks[i + 1], e.wrecks[i + 2], 1);
    this.gl.ingest(b, (x, y, size) => this.blood.splat(x, y, size));
    b.clearEvents();
    this.blood.fade(simDt, BLOOD_FADE);

    // Kamerawackeln bei nahen Explosionen
    const shake = this.gl.shake * 3 / Math.max(0.5, this.cam.zoom);
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    this.cam.x += sx;
    this.cam.y += sy;

    const ctx = this.bgCtx;
    const z = this.cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1914";
    ctx.fillRect(0, 0, this.bg.width, this.bg.height);
    ctx.imageSmoothingEnabled = this.cam.zoom < 1;
    ctx.setTransform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    ctx.drawImage(painter.canvas, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.blood.canvas, 0, 0, this.blood.canvas.width / BloodLayer.SCALE, this.blood.canvas.height / BloodLayer.SCALE);
    this.gl.selected = this.selected;
    this.gl.render(b, this.cam, this.dpr, simDt);
    const plan = off && !this.ctx.spectator ? off.attackPlan() : null;
    const artyMode = this.mode === "arty" || this.mode === "smoke" || this.mode === "gas";
    this.overlay.update(b, this.cam, this.selected, plan ? { ...plan, label: off!.attackStatus() ?? "" } : null, artyMode);
    this.cam.x -= sx;
    this.cam.y -= sy;
    this.updateScale();
  }

  /** Maßstabsleiste unten links */
  private updateScale() {
    const el = $("#scalebar");
    const pxPerMeter = this.cam.zoom / METERS_PER_UNIT;
    let meters = 10;
    for (const m of [10, 25, 50, 100, 200, 500]) {
      meters = m;
      if (m * pxPerMeter >= 70) break;
    }
    el.style.width = `${Math.round(meters * pxPerMeter)}px`;
    el.dataset.label = `${meters} m`;
  }

  private sound(kind: string, x: number, y: number, big: number) {
    const cam = this.cam;
    const halfW = cam.viewW / cam.zoom / 2;
    const halfH = cam.viewH / cam.zoom / 2;
    const cx = cam.x + halfW;
    const cy = cam.y + halfH;
    const reach = Math.max(halfW, halfH) * 1.6 + 150;
    const d = Math.hypot(x - cx, y - cy);
    // Weit herausgezoomt: alles etwas leiser, sonst wird es zu laut bei Tausenden Schützen
    const zoomVol = Math.min(1, 0.35 + cam.zoom * 0.35);
    const vol = Math.max(0, 1 - d / reach) * zoomVol;
    this.audio.play(kind, vol, (x - cx) / halfW, big);
  }

  cycleStyle() {
    const order: RenderStyle[] = ["klassisch", "deutlich", "punkte"];
    this.gl.style = order[(order.indexOf(this.gl.style) + 1) % order.length];
    try {
      localStorage.setItem("grabenfront.style", this.gl.style);
    } catch {
      /* egal */
    }
    $("#styleBtn").textContent = `Darstellung: ${STYLE_NAMES[this.gl.style]}`;
  }

  /** Name der Landschaft für die Anzeige */
  biomeName() {
    return this.ctx ? BIOME_NAMES[this.ctx.battle.terrain.biome] : "";
  }

  // ---------------------------------------------------------------- Befehle

  /** Generalangriff: alle Flanken stürmen gleichzeitig */
  private generalButton() {
    const off = this.ctx?.officer;
    if (!off || this.ctx?.spectator) return;
    off.generalAttack(this.battle);
    this.hud();
  }

  select(id: number) {
    const c = this.battle.companies[id];
    if (!c || c.side !== PLAYER || c.alive <= 0 || this.ctx?.spectator) id = -1;
    this.selected = this.selected === id ? -1 : id;
    this.hud();
  }

  private tap(sx: number, sy: number) {
    if (!this.ctx || this.ctx.spectator) return;
    const w = this.cam.toWorld(sx, sy);
    const b = this.battle;
    if (this.mode === "plan") {
      if (this.ctx.officer?.planAttack(b, w.x)) this.setMode("none");
      else $("#modetext").textContent = "Dort stehen keine freien Schützen für einen Angriff";
      this.hud();
      return;
    }
    if (this.mode === "blast" || this.mode === "dome") {
      const kind = this.mode === "blast" ? "blast" : "dome";
      // Die ausgewählte Staffel, sonst die nächste, die es jetzt kann
      const mages = b.companies
        .filter((c) => c.side === PLAYER && c.type === UNIT_MAGE && c.alive > 0)
        .sort((p, q) => (p.id === this.selected ? -1 : q.id === this.selected ? 1 : Math.hypot(p.cx - w.x, p.cy - w.y) - Math.hypot(q.cx - w.x, q.cy - w.y)));
      const caster = mages.find((c) => !b.mageCan(c.id, kind, w.x, w.y));
      if (caster) {
        if (kind === "blast") b.mageBlast(caster.id, w.x, w.y);
        else b.mageDome(caster.id, w.x, w.y);
        this.setMode("none");
      } else $("#modetext").textContent = mages.length ? `Geht nicht: ${b.mageCan(mages[0].id, kind, w.x, w.y)}` : "Keine Magier mehr";
      this.hud();
      return;
    }
    if (this.mode === "arty" || this.mode === "smoke" || this.mode === "gas") {
      if (!b.inArtyRange(PLAYER, w.x, w.y)) $("#modetext").textContent = "Außer Reichweite – die Geschütze reichen nur bis zum feindlichen vorderen Graben";
      else if (b.callArtillery(PLAYER, w.x, w.y, this.mode === "arty" ? "he" : this.mode)) this.setMode("none");
      this.hud();
      return;
    }
    const sel = b.companies[this.selected];
    if (sel && sel.alive > 0 && commandable(sel)) {
      // Direkt führen: die Staffel fliegt dorthin und kämpft (bis du ihr wieder einen Befehl gibst)
      sel.manual = true;
      b.orderMove(sel.id, w.x, w.y);
      this.hud();
      return;
    }
    // Nichts (Führbares) ausgewählt: nächste eigene Kompanie in der Nähe auswählen, Magier bevorzugt
    let best: Company | null = null;
    let bd = 50 / this.cam.zoom;
    for (const c of b.companies) {
      if (c.side !== PLAYER || c.alive <= 0) continue;
      if (!commandable(c) && best && commandable(best)) continue;
      const d = Math.hypot(c.cx - w.x, c.cy - w.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) this.select(best.id);
  }

  /** Befehle für die Magier – gelten für alle Staffeln */
  order(kind: string) {
    if (!this.ctx || this.ctx.spectator) return;
    const b = this.battle;
    const mages = b.companies.filter((c) => c.side === PLAYER && c.type === UNIT_MAGE && c.alive > 0);
    if (mages.length === 0) return;
    const off = this.ctx.officer;
    if (kind === "cover" || kind === "escort" || kind === "hunt") {
      if (off) off.mageOrder = kind;
      for (const m of mages) m.manual = false;
    } else if (kind === "blast" || kind === "dome") {
      this.setMode(this.mode === kind ? "none" : kind);
    } else if (kind === "retreat") {
      for (const m of mages) {
        m.manual = true;
        b.orderRetreat(m.id);
      }
    }
    this.hud();
  }

  setMode(m: Mode) {
    this.mode = m;
    $("#modebar").hidden = m === "none";
    $("#modetext").textContent =
      m === "arty"
        ? "Artillerie: Zielgebiet antippen"
        : m === "plan"
          ? "Angriff: Abschnitt antippen – der Offizier zerschießt den Draht, legt Nebel und stürmt"
        : m === "gas"
          ? "Gas: Ziel antippen – gut gegen Reserven und Batterien, treibt nach rechts"
        : m === "smoke"
          ? "Nebel: auf den feindlichen Graben legen, dann stürmen (treibt mit dem Wind nach rechts)"
          : m === "blast"
            ? "Sprengzauber: Stelle antippen (bis 160 m von den Magiern)"
            : m === "dome"
              ? "Schutzkuppel: über eigene Truppen legen (bis 160 m von den Magiern)"
              : "";
    $("#arty").classList.toggle("on", m === "arty");
    $("#smokeBtn").classList.toggle("on", m === "smoke");
    $("#gasBtn").classList.toggle("on", m === "gas");
    $("#planBtn").classList.toggle("on", m === "plan");
    $('[data-order="blast"]').classList.toggle("on", m === "blast");
    $('[data-order="dome"]').classList.toggle("on", m === "dome");
  }

  key(e: KeyboardEvent): boolean {
    if (!this.ctx) return false;
    const k = e.key.toLowerCase();
    if (k === "l") this.order("cover");
    else if (k === "b") this.order("escort");
    else if (k === "j") this.order("hunt");
    else if (k === "z") this.order("blast");
    else if (k === "x") this.order("dome");
    else if (k === "r") this.order("retreat");
    else if (k === "a") this.setMode(this.mode === "arty" ? "none" : "arty");
    else if (k === "n") this.setMode(this.mode === "smoke" ? "none" : "smoke");
    else if (k === "g") this.generalButton();
    else if (k === "q") {
      if (this.ctx.officer && !this.ctx.spectator) this.ctx.officer.fullRetreat(this.battle);
    }
    else if (k === "p") this.planButton();
    else if (k === "k") this.setMode(this.mode === "gas" ? "none" : "gas");
    else if (k === "v") this.cycleStyle();
    else if (k === "escape" && (this.mode !== "none" || this.selected >= 0)) {
      if (this.mode !== "none") this.setMode("none");
      else this.select(-1);
    } else return false;
    return true;
  }

  private playerPointSide(): number {
    const { world, pointId } = this.ctx!;
    const p = world!.point(pointId!);
    if (!p || !p.battle) return -1;
    return p.battle.sideMap[0];
  }

  /** Angriff planen – oder den laufenden abbrechen */
  private planButton() {
    const off = this.ctx?.officer;
    if (!off || this.ctx?.spectator) return;
    if (off.attackStatus()) {
      off.cancelAttack(this.battle);
      this.setMode("none");
    } else this.setMode(this.mode === "plan" ? "none" : "plan");
    this.hud();
  }

  private cycleStance(lane: number) {
    const { world, pointId, officer } = this.ctx!;
    const p = world?.point(pointId!);
    if (!p) {
      if (!officer) return;
      const cur = officer.stances[lane];
      officer.stances[lane] = STANCE_ORDER[(STANCE_ORDER.indexOf(cur) + 1) % STANCE_ORDER.length];
      this.hud();
      return;
    }
    const side = this.playerPointSide();
    const cur = p.stance[side][lane];
    const next = STANCE_ORDER[(STANCE_ORDER.indexOf(cur) + 1) % STANCE_ORDER.length];
    world!.setStance(p.id, side, lane, next);
    this.hud();
  }

  // --------------------------------------------------------------------- HUD

  hud() {
    if (!this.ctx) return;
    const b = this.battle;
    const { world, pointId } = this.ctx;
    const point = world?.point(pointId!);

    if (world && point) {
      const ps = this.playerPointSide();
      const mine = point.strength[ps] ?? 0;
      const theirs = point.strength[1 - ps] ?? 0;
      const total = mine + theirs;
      const share = total > 0 ? mine / total : 0.5;
      const bar = ps === 0 ? point.bar : -point.bar;
      const nA = world.nations[ps === 0 ? point.a : point.b];
      const nB = world.nations[ps === 0 ? point.b : point.a];
      $("#topinfo").innerHTML =
        `<span style="color:var(--player)">${nA.short} ${fmt(mine)}</span>` +
        `<span class="capbar" title="Dein Anteil an der Gesamtstärke: ab 70 % rückst du vor, unter 30 % der Feind"><i style="left:${share * 100}%"></i></span>` +
        `<span style="color:var(--enemy)">${fmt(theirs)} ${nB.short}</span>` +
        `<small>${Math.round(share * 100)}%${Math.abs(bar) >= 1 ? ` · ${bar > 0 ? "Vormarsch" : "Rückzug"} ${Math.round(Math.abs(bar))}%` : ""}</small>` +
        reserveInfo(b, point.battle ? point.battle.battleSide(ps) : PLAYER);
      // Flanken-Haltungen
      const flank = $("#flankRow");
      const principal = ps === 0 ? point.a : point.b;
      if (!this.ctx.spectator && principal === world.player) {
        flank.hidden = false;
        flank.innerHTML = [0, 1, 2]
          .map((l) => {
            const s = point.stance[ps][l];
            return `<button data-lane="${l}" class="stance ${s}"><small>${LANE_NAMES[l]}</small>${STANCE_NAMES[s]}</button>`;
          })
          .join("");
      } else flank.hidden = true;
    } else {
      const objs = b.objectives
        .map((o) => `<i style="background:${o.owner === PLAYER ? "var(--player)" : "var(--enemy)"}"></i>`)
        .join("");
      $("#topinfo").innerHTML =
        `<span style="color:var(--player)">${b.groundStrength(PLAYER)}</span>` +
        `<span class="objs">${objs}</span>` +
        `<span style="color:var(--enemy)">${b.groundStrength(1)}</span>`;
      const off = this.ctx.officer;
      const flank = $("#flankRow");
      flank.hidden = !off || this.ctx.spectator;
      if (off && !this.ctx.spectator) {
        flank.innerHTML = [0, 1, 2]
          .map((l) => {
            const s = off.stances[l];
            return `<button data-lane="${l}" class="stance ${s}"><small>${LANE_NAMES[l]}</small>${STANCE_NAMES[s]}</button>`;
          })
          .join("");
      }
    }

    const side = b.sides[PLAYER];
    const gen = $<HTMLButtonElement>("#generalBtn");
    const genLeft = this.ctx.officer ? this.ctx.officer.generalUntil - b.time : 0;
    gen.hidden = !this.ctx.officer;
    const ret = $<HTMLButtonElement>("#retreatAllBtn");
    ret.hidden = !this.ctx.officer;
    const retLeft = this.ctx.officer ? this.ctx.officer.retreatUntil - b.time : 0;
    ret.textContent = retLeft > 0 ? `Rückzug · ${Math.ceil(retLeft)}s` : "Rückzug";
    gen.disabled = genLeft > 0;
    gen.textContent = genLeft > 0 ? `General\u00ADangriff · ${Math.ceil(genLeft)}s` : "General\u00ADangriff";
    const plan = $<HTMLButtonElement>("#planBtn");
    const status = this.ctx.officer?.attackStatus();
    plan.hidden = !this.ctx.officer;
    plan.textContent = status ? `${status} ✕` : "Angriff planen";
    plan.title = status ? "Angriff abbrechen (P): alle zurück in die Ausgangsstellung" : "Angriff planen (P)";
    const arty = $<HTMLButtonElement>("#arty");
    arty.textContent =
      side.artyMax === 0
        ? "Keine Artillerie"
        : `Artillerie ${side.artyCharges}/${side.artyMax}` + (side.artyCharges < side.artyMax ? ` · ${Math.ceil(side.artyTimer)}s` : "");
    arty.disabled = side.artyCharges === 0 && this.mode !== "arty";
    $<HTMLButtonElement>("#smokeBtn").disabled = side.artyCharges === 0 && this.mode !== "smoke";
    $<HTMLButtonElement>("#gasBtn").disabled = side.artyCharges === 0 && this.mode !== "gas";
    const res = $<HTMLButtonElement>("#reserve");
    res.textContent = `Reserve (${side.reserves})` + (side.reserveCooldown > 0 ? ` ${Math.ceil(side.reserveCooldown)}s` : "");
    res.disabled = side.reserves === 0 || side.reserveCooldown > 0;
    res.title = `Neue Kompanie von hinten, danach ${RESERVE_COOLDOWN}s Wartezeit`;

    const sel = b.companies[this.selected];
    if (sel && sel.alive <= 0) this.selected = -1;
    const hasSel = this.selected >= 0;
    // Magier-Befehle: gelten für alle Staffeln; aktiver Befehl leuchtet, Fähigkeiten zeigen ihre Abklingzeit
    const mages = b.companies.filter((c) => c.side === PLAYER && c.type === UNIT_MAGE && c.alive > 0);
    const off = this.ctx.officer;
    const auto = mages.some((m) => !m.manual);
    const ready = (f: (m: Company) => number) => Math.min(...mages.map((m) => Math.max(0, f(m) - b.time)));
    document.querySelectorAll<HTMLButtonElement>("#orders button").forEach((btn) => {
      const k = btn.dataset.order!;
      btn.disabled = mages.length === 0 || !!this.ctx?.spectator;
      if (k === "cover" || k === "escort" || k === "hunt") btn.classList.toggle("on", auto && off?.mageOrder === k);
      if (k === "blast" || k === "dome") {
        const left = mages.length ? ready((m) => (k === "blast" ? m.blastReady : m.domeReady)) : 0;
        btn.textContent = (k === "blast" ? "Sprengzauber" : "Kuppel") + (left > 0 ? ` · ${Math.ceil(left)}s` : "");
      }
    });
    $("#selinfo").innerHTML = this.ctx.spectator
      ? "Fremde Schlacht – du schaust nur zu."
      : hasSel
        ? this.describe(sel)
        : mages.length
          ? `Deine Magier ✦ ${mages.map((m) => `${m.alive}/${m.initial} ${meterBar(m.mana, "#7ff0ff")}`).join(" ")} · ${
              mages.every((m) => m.manual) ? "von dir geführt" : { auto: "selbstständig", cover: "Luftschutz", escort: "begleiten", hunt: "auf Jagd" }[off?.mageOrder ?? "auto"]
            }<br><small>Befehl wählen oder Magier antippen und direkt führen. Die Kompanien führen deine Offiziere.</small>`
          : "Deine Magier sind gefallen. Die Kompanien führen deine Offiziere.";

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
      // Unten nur die Magier: die führst du selbst
      chip.hidden = c.alive <= 0 || !commandable(c);
      chip.classList.toggle("sel", c.id === this.selected);
      const color = moraleColor(c);
      const who = world ? (c.manual ? " ✋" : "") : "";
      chip.innerHTML = `<span style="color:${color}">■</span> ${shortName(c)}${c.type === UNIT_MAGE ? " Magier" : ""}${who}<small>${c.alive} · ${orderText(c, b)}</small>`;
    }
  }

  private describe(c: Company) {
    const bar = meterBar;
    const b = this.battle;
    const st = STATS[c.type];
    const range = `Reichweite ${Math.round(st.range * METERS_PER_UNIT)} m`;
    let second: string;
    if (c.type === UNIT_MAGE) second = `Mana ${bar(c.mana, "#7ff0ff")} · ${range}`;
    else if (c.type === UNIT_TANK || c.type === UNIT_GUN) {
      const hp = c.members.filter((m) => b.alive[m]).map((m) => Math.round((b.hp[m] / st.hp) * 100));
      const ready = c.type === UNIT_GUN ? (c.readyAt <= b.time ? " · feuerbereit" : ` · lädt ${Math.ceil(c.readyAt - b.time)}s`) : "";
      second = `Zustand ${hp.map((h) => `${h}%`).join(" / ")}${ready} · ${range}`;
    } else second = `Moral ${bar(c.morale, moraleColor(c))} · ${orderText(c, b)} · ${range}`;
    const hint =
      c.order === "rout"
          ? " · <b>flieht, sammelt sich hinten</b>"
          : c.manual
            ? " · <b>von dir geführt</b>"
            : this.ctx?.officer
              ? " · Offizier führt"
              : " · Karte antippen = Position";
    const unit = c.type === UNIT_TANK ? "Panzer" : c.type === UNIT_GUN ? "Geschütze" : c.type === UNIT_MAGE ? "Magier" : "Mann";
    return `<b>${c.name}</b> <small>(${st.name})</small> · ${c.alive}/${c.initial} ${unit}${hint}<br>${second}`;
  }
}

export function moraleColor(c: Company) {
  if (c.type === UNIT_MAGE) return "#7ff0ff";
  if (c.order === "rout") return "var(--bad)";
  return c.morale > 60 ? "var(--ok)" : c.morale > 35 ? "var(--warn)" : "var(--bad)";
}

function orderText(c: Company, b: Battle) {
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
      if (c.type === UNIT_GUN) return "in Feuerstellung";
      return Math.abs(c.cy - b.terrain.frontY(c.side, c.cx)) < 40 ? "hält Graben" : "hält Stellung";
    }
  }
}

export function fmt(n: number) {
  return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}

/** Was der Spieler selbst führt: die Magier. Alles andere führen die Offiziere. */
function commandable(c: Company) {
  return c.type === UNIT_MAGE;
}

function meterBar(v: number, col: string) {
  return `<span class="meter"><i style="width:${Math.max(0, v)}%;background:${col}"></i></span>`;
}
