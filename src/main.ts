import "./style.css";
import { BattleAI } from "./sim/ai.ts";
import { Battle } from "./sim/battle.ts";
import { ENEMY, PLAYER, TICK } from "./sim/config.ts";
import { BIOME_NAMES, BIOMES, type Biome } from "./sim/terrain.ts";
import { CampaignView } from "./campaign/campaignView.ts";
import { BattleView } from "./ui/battleView.ts";
import { decodeMap, type GameMap, type MapFile } from "./world/mapData.ts";
import { World, type WorldEvent } from "./world/world.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const PLAYABLE = ["VEL", "CAR", "BRY", "DAN", "VOS", "VAL", "ANA"];

/** Hält alles zusammen: Spielschleife, Pause/Tempo, Wechsel zwischen Karte und Schlacht. */
class App {
  map: GameMap;
  world: World | null = null;
  campaign: CampaignView | null = null;
  battleView = new BattleView();
  /** Schnelles Gefecht ohne Kampagne */
  skirmish: { battle: Battle; ais: BattleAI[]; shown: boolean } | null = null;
  view: "map" | "battle" | "menu" = "menu";
  paused = true;
  speed = 1;
  private acc = 0;
  private last = performance.now();
  private hudTimer = 0;
  private shownDecision = -1;

  constructor(map: GameMap) {
    this.map = map;
    $("#pause").addEventListener("click", () => this.togglePause());
    document.querySelectorAll<HTMLButtonElement>(".speed").forEach((b) =>
      b.addEventListener("click", () => this.setSpeed(+b.dataset.speed!)),
    );
    $("#back").addEventListener("click", () => this.backToMap());
    const sound = $("#soundBtn");
    const syncSound = () => (sound.textContent = this.battleView.audio.enabled ? "🔊" : "🔇");
    sound.addEventListener("click", () => {
      this.battleView.audio.unlock();
      this.battleView.audio.toggle();
      syncSound();
    });
    syncSound();
    // Browser erlauben Ton erst nach einer Berührung/einem Klick
    window.addEventListener("pointerdown", () => this.battleView.audio.unlock(), { capture: true });
    $("#toasts").addEventListener("click", (e) => {
      // Meldung aus der Schlacht: Kamera dorthin
      const bx = (e.target as HTMLElement).closest<HTMLElement>("[data-bx]");
      if (bx && this.view === "battle") {
        this.battleView.focus(Number(bx.dataset.bx), Number(bx.dataset.by));
        return;
      }
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-point]");
      if (t && this.campaign) {
        this.backToMap();
        const p = this.world!.point(Number(t.dataset.point));
        if (p) {
          this.campaign.select({ t: "point", id: p.id });
          this.campaign.centerOn(p.x, p.y);
        }
      }
    });
    $("#dialog").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-decision]");
      if (!b || !this.world) return;
      this.world.resolveDecision(Number(b.dataset.decision), Number(b.dataset.option));
      $("#dialog").hidden = true;
      $("#dialog").innerHTML = "";
      this.shownDecision = -1;
    });
    window.addEventListener("keydown", (e) => this.key(e));
    this.setSpeed(1);
    this.togglePause(true);
    this.menu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ================================================================ Menüs

  menu() {
    this.view = "menu";
    const d = $("#dialog");
    d.hidden = false;
    const nations = this.map.nations.filter((n) => PLAYABLE.includes(n.key));
    d.innerHTML = `<div class="card">
      <h1>Grabenfront</h1>
      <h2>Europa, Sommer 1914 – eine andere Geschichte</h2>
      <p>Die Welt läuft in Echtzeit (1 Minute = 1 Tag) und lässt sich jederzeit pausieren. Wenn du Krieg führst,
      entstehen an den Grenzen <b>Frontpunkte</b>. Jeder ist eine laufende Schlacht. Wer dort
      <b>70 % der Gesamtstärke</b> stellt, schiebt die Front vor und erobert Provinz um Provinz.</p>
      <h4>Wähle deine Nation</h4>
      <div class="nations">${nations
        .map((n) => `<button data-nation="${n.id}" style="--c:${n.color}"><i></i>${n.name}</button>`)
        .join("")}</div>
      <button id="skirmish" class="wide">Nur ein schnelles Gefecht</button>
    </div>`;
    d.querySelectorAll<HTMLButtonElement>("[data-nation]").forEach((b) =>
      b.addEventListener("click", () => this.startCampaign(Number(b.dataset.nation))),
    );
    $("#skirmish").addEventListener("click", () => this.skirmishMenu());
    this.battleView.onReport = (text, kind, x, y) => {
      const el = this.toast(text, kind === "info" ? "info" : kind === "good" ? "good" : "bad");
      el.dataset.bx = String(Math.round(x));
      el.dataset.by = String(Math.round(y));
    };
  }

  skirmishMenu() {
    const d = $("#dialog");
    d.innerHTML = `<div class="card">
      <h1>Schnelles Gefecht</h1>
      <h2>Beide Seiten mit Infanterie, MGs, Tankgewehren, Flammenwerfern, Panzern, Feldgeschützen und Magiern.</h2>
      <div class="row" style="margin-bottom:8px">
        <button id="optBig" class="${this.skBig ? "on" : ""}">Großschlacht (~8.000 Mann)</button>
        <button id="optWatch" class="${this.skWatch ? "on" : ""}">Zuschauen (KI gegen KI)</button>
        <button id="optVet" class="${this.skVeteran ? "on" : ""}" title="Erfahrene Offiziere nutzen Nebel, Drahtlücken, Feuerwalzen und halten ihre Magier über der eigenen Stellung">Gegner: ${this.skVeteran ? "erfahren" : "unerfahren"}</button>
      </div>
      <div class="list">${BIOMES.map((b) => `<button class="rowbtn" data-biome="${b}"><span>${BIOME_NAMES[b]}</span></button>`).join("")}
        <button class="rowbtn primary" data-biome="random"><span>Zufällige Landschaft</span></button>
      </div>
      <button id="menuBack" class="wide">Zurück</button></div>`;
    $("#optBig").addEventListener("click", () => {
      this.skBig = !this.skBig;
      this.skirmishMenu();
    });
    $("#optVet").addEventListener("click", () => {
      this.skVeteran = !this.skVeteran;
      this.skirmishMenu();
    });
    $("#optWatch").addEventListener("click", () => {
      this.skWatch = !this.skWatch;
      this.skirmishMenu();
    });
    d.querySelectorAll<HTMLButtonElement>("[data-biome]").forEach((b) =>
      b.addEventListener("click", () => this.startSkirmish(b.dataset.biome === "random" ? undefined : (b.dataset.biome as Biome))),
    );
    $("#menuBack").addEventListener("click", () => this.menu());
  }

  startCampaign(player: number) {
    $("#dialog").hidden = true;
    const w = new World(this.map, player, (Math.random() * 1e9) | 0);
    this.world = w;
    w.onEvent = (e) => this.onEvent(e);
    this.campaign = new CampaignView(w);
    this.campaign.onOpenBattle = (id) => this.openBattle(id);
    this.campaign.show();
    this.campaign.focusCapital();
    this.view = "map";
    const me = w.nations[player];
    this.toast(`Du führst ${me.name}. Die Lage auf dem Balkan ist angespannt …`, "info");
    this.setSpeed(1);
  }

  skBig = false;
  skWatch = false;
  skVeteran = true;

  startSkirmish(biome?: Biome) {
    $("#dialog").hidden = true;
    const battle = new Battle((Math.random() * 1e9) | 0, { biome, big: this.skBig });
    // Eigene Offiziere: verteidigen von sich aus; Angriffe befiehlt der Spieler (Haltung oder „Angriff planen“)
    const officer = new BattleAI(PLAYER, this.skWatch ? "balanced" : "defensive");
    const ais = [new BattleAI(ENEMY, "balanced", this.skVeteran), officer];
    this.skirmish = { battle, ais, shown: false };
    this.battleView.open({ battle, spectator: this.skWatch, officer });
    this.view = "battle";
    this.toast(this.battleView.biomeName(), "info");
    this.setSpeed(1);
  }

  openBattle(pointId: number) {
    const w = this.world!;
    const p = w.point(pointId);
    if (!p?.battle) return;
    this.campaign!.hide();
    w.viewedPoint = pointId;
    const ps = w.sideAt(p, w.player);
    // Befehle an die Offiziere nur in eigenen Schlachten, nicht bei Verbündeten
    const principal = ps >= 0 && (ps === 0 ? p.a : p.b) === w.player;
    this.battleView.open({ battle: p.battle.battle, world: w, pointId, spectator: ps < 0, officer: principal ? p.battle.ai[0] : undefined });
    this.view = "battle";
    $("#back").hidden = false;
  }

  backToMap() {
    if (!this.world || this.view !== "battle") return;
    this.battleView.close();
    this.world.viewedPoint = -1;
    this.campaign!.show();
    this.view = "map";
    $("#back").hidden = true;
  }

  // ============================================================ Schleife

  frame(now: number) {
    const real = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let simDt = 0;
    const blocked = !$("#dialog").hidden;
    if (!this.paused && !blocked && this.view !== "menu") {
      this.acc += real * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 24) {
        this.tick();
        this.acc -= TICK;
        simDt += TICK;
        steps++;
      }
      if (steps === 24) this.acc = 0;
    }

    if (this.view === "battle") {
      // Kampagnen-Schlacht beendet oder ersetzt? Zurück zur Karte.
      if (this.world) {
        const p = this.world.point(this.world.viewedPoint);
        if (!p || !p.battle || p.battle.battle !== this.battleView.ctx?.battle) {
          this.toast("Die Schlacht an diesem Frontpunkt ist vorbei.", "info");
          this.backToMap();
        }
      }
      if (this.view === "battle") this.battleView.frame(simDt);
    } else if (this.view === "map") {
      this.campaign!.frame();
    }

    this.hudTimer -= real;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      this.hud();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick() {
    if (this.world) {
      this.world.update(TICK);
    } else if (this.skirmish) {
      const s = this.skirmish;
      if (!s.battle.result) {
        for (const ai of s.ais) ai.update(s.battle, TICK);
        s.battle.update(TICK);
      }
    }
  }

  private hud() {
    if (this.world) {
      $("#clock").textContent = this.world.dateString();
      if (this.view === "map") this.campaign!.hud();
      this.showDecision();
    } else if (this.skirmish) {
      const t = this.skirmish.battle.time;
      $("#clock").textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
      if (this.skirmish.battle.result && !this.skirmish.shown) this.skirmishResult();
    }
    if (this.view === "battle") this.battleView.hud();
  }

  // ================================================================ Pause

  togglePause(force?: boolean) {
    this.paused = force ?? !this.paused;
    $("#pause").textContent = this.paused ? "▶" : "⏸";
    $("#pause").classList.toggle("on", this.paused);
  }

  setSpeed(s: number) {
    this.speed = s;
    document.querySelectorAll<HTMLButtonElement>(".speed").forEach((b) => b.classList.toggle("on", +b.dataset.speed! === s));
    if (this.paused && this.view !== "menu") this.togglePause(false);
  }

  private key(e: KeyboardEvent) {
    if (this.view === "menu") return;
    if (e.key === " ") {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (["1", "2", "3", "4"].includes(e.key)) return this.setSpeed([1, 2, 4, 8][+e.key - 1]);
    if (this.view === "battle" && this.battleView.key(e)) return;
    if (e.key === "Escape" && this.view === "battle") this.backToMap();
  }

  // ============================================================ Ereignisse

  private onEvent(e: WorldEvent) {
    this.toast(e.text, e.kind, e.point);
    if (e.pause && this.world?.autoPause && !this.paused) {
      this.togglePause(true);
      this.toast("⏸ Automatisch pausiert", "info");
    }
  }

  private toast(text: string, kind: string, point?: number): HTMLElement {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    if (point !== undefined) el.dataset.point = String(point);
    const box = $("#toasts");
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => el.classList.add("out"), 5000);
    setTimeout(() => el.remove(), 5600);
    return el;
  }

  private showDecision() {
    const w = this.world!;
    const d = w.decisions[0];
    if (!d || this.shownDecision === d.id || !$("#dialog").hidden) return;
    this.shownDecision = d.id;
    const box = $("#dialog");
    box.innerHTML = `<div class="card"><h3>Entscheidung</h3><p>${d.text}</p><div class="row">${d.options
      .map((o, i) => `<button data-decision="${d.id}" data-option="${i}" class="${i === 0 ? "primary" : ""}">${o.label}</button>`)
      .join("")}</div></div>`;
    box.hidden = false;
  }

  private skirmishResult() {
    const s = this.skirmish!;
    s.shown = true;
    const r = s.battle.result!;
    const b = s.battle;
    const lost = (side: number) => b.companies.filter((c) => c.side === side).reduce((n, c) => n + (c.initial - c.alive), 0);
    const d = $("#dialog");
    d.hidden = false;
    d.innerHTML = `<div class="card">
      <h1>${r.winner === PLAYER ? "Sieg!" : "Niederlage"}</h1>
      <h2>${r.reason} · Dauer ${Math.floor(b.time / 60)} Minuten</h2>
      <ul><li>Eigene Verluste: <b>${lost(PLAYER)}</b></li><li>Feindliche Verluste: <b>${lost(ENEMY)}</b></li></ul>
      <button id="again" class="wide primary">Zurück zum Menü</button></div>`;
    $("#again").addEventListener("click", () => {
      this.battleView.close();
      this.skirmish = null;
      this.togglePause(true);
      this.menu();
    });
  }
}

async function boot() {
  const file = (await (await fetch(`${import.meta.env.BASE_URL}maps/europa.json`)).json()) as MapFile;
  const app = new App(decodeMap(file));
  // Für Debugging in der Browser-Konsole
  (window as unknown as { app: App }).app = app;
}
boot();
