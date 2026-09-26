// Zentrale Balancing-Werte. Alles, was das Tempo und die Tödlichkeit der
// Gefechte bestimmt, steht hier, damit man es an einer Stelle drehen kann.

export const WORLD_W = 1200;
export const WORLD_H = 2000;

/** Simulationsschritt in Sekunden (20 Ticks pro Sekunde). */
export const TICK = 0.05;

/** Seite 0 = Spieler (unten), Seite 1 = Computer (oben). */
export const PLAYER = 0;
export const ENEMY = 1;

export const TRENCH_Y = [1720, 280] as const; // vordere Gräben
export const SUPPORT_Y = [1870, 130] as const; // Unterstützungsgräben
export const WIRE_Y = [1640, 360] as const; // Stacheldraht vor den Gräben
export const REAR_Y = [1960, 40] as const; // hier kommen Reserven an

/** Richtung (y) zum Feind hin. */
export const FORWARD = [-1, 1] as const;

export const UNIT_RIFLE = 0;
export const UNIT_MG = 1;
export const UNIT_MAGE = 2;

export interface WeaponStats {
  range: number;
  reload: number; // Sekunden
  reloadJitter: number;
  hit: number; // Basis-Trefferchance
  suppress: number; // Niederhalten beim Ziel pro Schuss
  hp: number;
  walk: number; // Bewegung u/s
  run: number;
  fireWhileMoving: boolean;
}

export const STATS: Record<number, WeaponStats> = {
  [UNIT_RIFLE]: {
    range: 320,
    reload: 4.0,
    reloadJitter: 1.5,
    hit: 0.12,
    suppress: 0.08,
    hp: 1,
    walk: 7,
    run: 13,
    fireWhileMoving: false,
  },
  [UNIT_MG]: {
    range: 430,
    reload: 0.3,
    reloadJitter: 0.1,
    hit: 0.05,
    suppress: 0.12,
    hp: 3,
    walk: 4,
    run: 6,
    fireWhileMoving: false,
  },
  [UNIT_MAGE]: {
    range: 230,
    reload: 2.5,
    reloadJitter: 0.6,
    hit: 0.55,
    suppress: 0.5,
    hp: 14,
    walk: 45,
    run: 55,
    fireWhileMoving: true,
  },
};

export const COMPANY_SIZE = 250;
export const MG_PER_SECTION = 4;
export const MAGES_PER_SQUAD = 4;

/** Treffer-Multiplikator, wenn auf fliegende Magier geschossen wird. */
export const MAGE_EVASION = 0.3;
export const MAGE_SPELL_RADIUS = 14;
export const MAGE_MANA_MAX = 100;
export const MAGE_MANA_DRAIN = 0.5; // pro Sekunde im Einsatz
export const MAGE_MANA_PER_SPELL = 2.5; // pro Zauber eines einzelnen Magiers
export const MAGE_MANA_REGEN = 6; // pro Sekunde zu Hause
export const MAGE_SHIELD_REGEN = 0.6;

export const MELEE_RANGE = 6;
export const MELEE_KILL = 0.35;
export const STORM_ENGAGE_RANGE = 35;

export const ARTY_DELAY = 6; // Flugzeit bis zum ersten Einschlag
export const ARTY_SHELLS = 16;
export const ARTY_DURATION = 6;
export const ARTY_SPREAD = 55;
export const ARTY_KILL_RADIUS = 16;
export const ARTY_SUPPRESS_RADIUS = 45;
export const ARTY_CHARGES = 3;
export const ARTY_RECHARGE = 45;

export const RESERVE_COOLDOWN = 60;
export const START_RESERVES = 2;

export const MORALE_ROUT = 20;
export const MORALE_ROUT_STORM = 12;
export const MORALE_RALLY = 50;

export const OBJECTIVE_RADIUS = 60;
export const OBJECTIVE_CAPTURE_TIME = 20; // Sekunden bei klarer Überzahl
