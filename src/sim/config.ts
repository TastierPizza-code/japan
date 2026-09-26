// Zentrale Balancing-Werte der Schlacht. Alles, was Tempo und Tödlichkeit bestimmt,
// steht hier, damit man es an einer Stelle drehen kann.
//
// Maßstab: 1 Einheit ≈ 0,5 m. Das Gefechtsfeld ist also etwa 800 m breit und 1200 m tief.
// Figuren werden etwas größer gezeichnet als echt, damit man sie erkennt.

export const WORLD_W = 1600;
export const WORLD_H = 2400;
export const METERS_PER_UNIT = 0.5;

/** Simulationsschritt in Sekunden (20 Ticks pro Sekunde). */
export const TICK = 0.05;

/** Seite 0 = Spieler (unten), Seite 1 = Gegner (oben). */
export const PLAYER = 0;
export const ENEMY = 1;

/** Richtung (y) zum Feind hin. */
export const FORWARD = [-1, 1] as const;

/** Grundlinien der Stellungen je Seite (tatsächlicher Verlauf ist geschwungen, siehe Terrain). */
export const FRONT_BASE = [1840, 560] as const;
export const SUPPORT_OFFSET = 150; // Unterstützungsgraben hinter der Front
export const WIRE_OFFSET = 60; // Draht vor der Front
export const GUN_Y = [2290, 110] as const; // Geschützstellungen
export const REAR_Y = [2375, 25] as const; // hier kommt Nachschub an

export const UNIT_RIFLE = 0;
export const UNIT_MG = 1;
export const UNIT_MAGE = 2;
export const UNIT_TANK = 3;
export const UNIT_AT = 4;
export const UNIT_FLAME = 5;
export const UNIT_GUN = 6;
export const UNIT_STORM = 7;

export interface WeaponStats {
  name: string;
  range: number;
  reload: number; // Sekunden
  reloadJitter: number;
  hit: number; // Basis-Trefferchance
  suppress: number; // Niederhalten beim Ziel pro Schuss
  hp: number;
  walk: number; // Bewegung u/s
  run: number;
  fireWhileMoving: boolean;
  /** gepanzert: Gewehr- und MG-Feuer prallt meist ab */
  armored?: boolean;
  /** Radius für Abstand zu anderen Einheiten */
  radius: number;
  /** Anteil des Niederhaltens, der wirkt (1 = voll, 0.5 = halb so stark) */
  nerve?: number;
  /** wirft Handgranaten auf Gegner in Deckung */
  grenades?: boolean;
}

export const STATS: Record<number, WeaponStats> = {
  [UNIT_RIFLE]: {
    name: "Schütze",
    range: 330,
    reload: 4.0,
    reloadJitter: 1.5,
    hit: 0.12,
    suppress: 0.08,
    hp: 1,
    walk: 7,
    run: 13,
    fireWhileMoving: false,
    radius: 2.2,
    grenades: true,
  },
  [UNIT_MG]: {
    name: "Maschinengewehr",
    range: 450,
    reload: 0.3,
    reloadJitter: 0.1,
    hit: 0.05,
    suppress: 0.12,
    hp: 3,
    walk: 4,
    run: 6,
    fireWhileMoving: false,
    radius: 4,
  },
  [UNIT_MAGE]: {
    name: "Magier",
    range: 240,
    reload: 2.5,
    reloadJitter: 0.6,
    hit: 0.55,
    suppress: 0.5,
    hp: 14,
    walk: 45,
    run: 55,
    fireWhileMoving: true,
    radius: 3,
  },
  [UNIT_TANK]: {
    name: "Panzer",
    range: 330,
    reload: 0.35,
    reloadJitter: 0.1,
    hit: 0.05,
    suppress: 0.14,
    hp: 40,
    walk: 4.5,
    run: 5,
    fireWhileMoving: true,
    armored: true,
    radius: 11,
  },
  [UNIT_AT]: {
    name: "Tankgewehr",
    range: 380,
    reload: 5,
    reloadJitter: 1.5,
    hit: 0.12,
    suppress: 0.1,
    hp: 1,
    walk: 6,
    run: 11,
    fireWhileMoving: false,
    radius: 2.6,
  },
  [UNIT_FLAME]: {
    name: "Flammenwerfer",
    range: 38,
    reload: 0.15,
    reloadJitter: 0.05,
    hit: 0.22,
    suppress: 0.5,
    hp: 1,
    walk: 6.5,
    run: 12,
    fireWhileMoving: false,
    radius: 2.4,
  },
  [UNIT_STORM]: {
    name: "Stoßtrupp",
    range: 260,
    reload: 3.0,
    reloadJitter: 1,
    hit: 0.14,
    suppress: 0.1,
    hp: 1,
    walk: 8.5,
    run: 15,
    // Karabiner und Maschinenpistole: schießen im Vorgehen (Feuer und Bewegung)
    fireWhileMoving: true,
    radius: 2.2,
    nerve: 0.45,
    grenades: true,
  },
  [UNIT_GUN]: {
    name: "Feldgeschütz",
    range: 700,
    reload: 6,
    reloadJitter: 1,
    hit: 0.35,
    suppress: 0.3,
    hp: 5,
    walk: 0,
    run: 0,
    fireWhileMoving: false,
    radius: 7,
  },
};

export const COMPANY_SIZE = 250;
export const MG_PER_SECTION = 4;
export const MAGES_PER_SQUAD = 4;
export const GUNS_PER_BATTERY = 4;
export const TANKS_PER_PLATOON = 3;
export const STORM_PER_SQUAD = 40;
export const AT_PER_SQUAD = 8;
export const FLAME_PER_SQUAD = 10;

/** Treffer-Multiplikator, wenn auf fliegende Magier geschossen wird. */
export const MAGE_EVASION = 0.3;
export const MAGE_SPELL_RADIUS = 14;
/** Trefferchance eines Zaubers mitten im Wirkungskreis (ohne Deckung) */
export const MAGE_SPELL_KILL = 0.45;
export const MAGE_MANA_MAX = 100;
export const MAGE_MANA_DRAIN = 0.5; // pro Sekunde im Einsatz
export const MAGE_MANA_PER_SPELL = 2.5; // pro Zauber eines einzelnen Magiers
export const MAGE_MANA_REGEN = 2.5; // pro Sekunde zu Hause
export const MAGE_SHIELD_REGEN = 0.6;

export const MELEE_RANGE = 6;
export const MELEE_KILL = 0.35;
export const STORM_ENGAGE_RANGE = 35;

// Artillerie: sichtbare Geschütze feuern echte Granaten mit Flugzeit
export const ARTY_SHELLS_PER_GUN = 4;
export const ARTY_SHELL_INTERVAL = 1.6;
export const ARTY_SPREAD = 55;
export const ARTY_KILL_RADIUS = 16;
export const ARTY_SUPPRESS_RADIUS = 45;
export const ARTY_RELOAD = 45; // Batterie braucht so lange bis zum nächsten Feuerschlag
export const SHELL_SPEED = 320; // Einheiten pro Sekunde (Flugzeit)

// Panzer und Panzerabwehr
export const TANK_CANNON_RANGE = 420;
export const TANK_CANNON_RELOAD = 7;
export const TANK_BREAKDOWN_PER_SEC = 0.0006;
export const AT_DAMAGE = 5;
export const GUN_DIRECT_DAMAGE = 15;
export const MINE_TRIGGER = 4;
export const MINE_RADIUS = 8;
export const MINE_TANK_DAMAGE = 20;

// Nebel: Schüsse durch Rauch treffen kaum
export const SMOKE_RADIUS = 50;
/** Flankenfeuer: Wer von der Seite (längs des Grabens) beschossen wird, hat nur diesen Anteil seiner Deckung */
export const ENFILADE_COVER = 0.45;
export const SMOKE_DURATION = 80;
export const SMOKE_BLOCK = 0.85; // so stark sinkt die Trefferchance mitten durch dichten Nebel
export const WIND = 2.5; // Nebel treibt langsam nach rechts

// Handgranaten
export const GRENADE_RANGE = 28;
export const GRENADE_RADIUS = 5.5;
export const GRENADE_RELOAD = 9;

// Flammenwerfer
export const FLAME_CONE = 0.45; // halber Öffnungswinkel in Radiant
export const FIRE_DURATION = 7;

export const RESERVE_COOLDOWN = 60;
export const START_RESERVES = 2;

/** Moralverlust, wenn die ganze Kompanie fiele (je Gefallenem anteilig). Bei gut 60 % Verlusten bricht ein Sturm zusammen. */
export const MORALE_PER_LOSS = 130;
export const MORALE_ROUT = 20;
export const MORALE_ROUT_STORM = 12;
export const MORALE_RALLY = 50;

export const OBJECTIVE_RADIUS = 70;
export const OBJECTIVE_CAPTURE_TIME = 20; // Sekunden bei klarer Überzahl

/** Sekunden, bis Blut vollständig verblasst ist. */
export const BLOOD_FADE = 180;
