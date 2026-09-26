// Balancing der Kampagne. Zeiten in Sekunden Echtzeit bei Tempo 1×.
// 1 Minute Echtzeit = 1 Tag im Spiel.

export const SECONDS_PER_DAY = 60;
export const START_DATE = Date.UTC(1914, 6, 28); // 28. Juli 1914

/** Wie oft die Weltlogik (Wirtschaft, Bewegung, Einnahme) rechnet. */
export const WORLD_STEP = 0.25;

// ------------------------------------------------------------ Frontpunkte

/**
 * Anzahl der Frontpunkte je Grenzlänge in km.
 * Etwa: 350 km (Carmaux–Veldmark) → 2, 9000 km (USA–Kanada) → 4.
 */
export function frontPointsFor(borderKm: number): number {
  return Math.max(1, Math.round(-1.63 + 0.619 * Math.log(Math.max(1, borderKm))));
}

/** Ab diesem Anteil an der Gesamtstärke nimmt man ein (0,7 = 70 %). */
export const CAPTURE_SHARE = 0.7;
/** Balken läuft von -100 bis +100. */
export const BAR_MAX = 100;
/** Balken-Punkte pro Minute für einen Unterlegenen mit u % Anteil (0 ≤ u < 30). */
export function captureRate(underdogPercent: number): number {
  const u = Math.min(29, Math.max(0, underdogPercent));
  return 1.67 + 0.172 * (29 - u);
}
/** Im Stellungskrieg läuft der Balken so schnell zurück zur Mitte (Punkte/Minute). */
export const BAR_DECAY = 2;

// ------------------------------------------------------------ Truppen

export type UnitKind = "infantry" | "mg" | "artillery" | "mage";

export interface UnitSpec {
  name: string;
  short: string;
  /** Mannschaften/Geräte bei voller Stärke */
  size: number;
  /** Kampfkraft pro Mann/Gerät */
  power: number;
  cost: { gold: number; material: number; recruits: number };
  trainTime: number;
  /** Nahrungsverbrauch pro Tag bei voller Stärke */
  food: number;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  infantry: {
    name: "Infanterie-Division",
    short: "Inf",
    size: 1000,
    power: 1,
    cost: { gold: 60, material: 30, recruits: 1000 },
    trainTime: 180,
    food: 1,
  },
  mg: {
    name: "MG-Abteilung",
    short: "MG",
    size: 8,
    power: 25,
    cost: { gold: 50, material: 60, recruits: 80 },
    trainTime: 180,
    food: 0.2,
  },
  artillery: {
    name: "Artillerie-Batterie",
    short: "Art",
    size: 1,
    power: 200,
    cost: { gold: 80, material: 120, recruits: 150 },
    trainTime: 240,
    food: 0.3,
  },
  mage: {
    name: "Magier-Trupp",
    short: "Mag",
    size: 4,
    power: 60,
    cost: { gold: 220, material: 20, recruits: 4 },
    trainTime: 300,
    food: 0.1,
  },
};

/** Marschgeschwindigkeit (Eisenbahn + Fußmarsch) in km pro Sekunde Echtzeit. */
export const TRAVEL_KM_PER_SEC = 1.2;
/** Mindestdauer einer Verlegung in Sekunden. */
export const TRAVEL_MIN = 20;

/** Höchstens so viele Schützenkompanien pro Seite gleichzeitig auf dem Gefechtsfeld. */
export const FIELD_RIFLE_COMPANIES = 8;

// ------------------------------------------------------------ Wirtschaft (pro Tag)

export const PROVINCE_YIELD = {
  land: { gold: 0.5, food: 0.8, material: 0.4, recruits: 12 },
  agrar: { gold: 0.4, food: 2.0, material: 0.2, recruits: 14 },
  industrie: { gold: 0.6, food: 0.4, material: 1.6, recruits: 10 },
  stadt: { gold: 1.6, food: 0.3, material: 0.6, recruits: 18 },
};
export const CAPITAL_BONUS = 3;
/** Ohne Nahrung kämpfen Truppen schlechter. */
export const HUNGER_PENALTY = 0.75;

// ------------------------------------------------------------ Diplomatie

export const OPINION_WAR_DECLARED_ON_ME = -100;
export const OPINION_WAR_ON_FRIEND = -40;
export const OPINION_AGGRESSION = -10;
export const PEACE_MIN_DAYS = 20;
