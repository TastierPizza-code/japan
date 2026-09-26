# Grabenfront – Spielkonzept

Lebendes Dokument. Hält fest, worauf wir uns geeinigt haben. Offene Punkte stehen unten.

## Grundidee

Anime-Grabenkrieg in einem **alternativen Europa und einer alternativen Welt um 1914** (im Stil von
*Saga of Tanya the Evil*, aber eigenes Setting mit eigenen Ländern und Namen). Man spielt eine Nation und
erobert über lange Zeit Stück für Stück die Welt. Gespielt wird nur gegen den Computer.

- Riesige Schlachten mit Tausenden Soldaten, einfache Pixel-Grafik wie *Songs of Syx*
- Wirtschaft und Upgrades bewusst einfach
- Läuft als **Server auf dem eigenen PC**. Gespielt wird im Browser, am PC oder auf dem Handy.

## Zeit: eine durchgehende Echtzeit-Welt

- Kampagnenkarte und alle Schlachten laufen **gleichzeitig in Echtzeit**.
- Die ganze Welt ist jederzeit **pausierbar**.
- **Automatische Pause** bei wichtigen Ereignissen: Ein Frontpunkt fällt, eine Kriegserklärung kommt,
  eine Front bricht zusammen, ein Bündnispartner ruft zu Hilfe.
- **Spiel geschlossen = Welt steht still.** Man kann nicht im Schlaf verlieren und es wird kein
  Idle-Game. Später vielleicht als Option: Die Welt läuft weiter, aber die Offiziere verteidigen nur.

## Krieg und Fronten

- Man ist **nicht automatisch mit allen im Krieg**. Krieg muss erklärt werden (oder wird einem erklärt).
- Im Krieg bilden sich entlang jeder gemeinsamen Grenze **Frontpunkte**. Die Anzahl hängt von der
  Grenzlänge ab, z. B.:
  - Frankreich–Deutschland ≈ 2 Punkte
  - USA–Kanada ≈ 4 Punkte
- **Ein Frontpunkt ist eine laufende Schlacht** (siehe Schlacht-Prototyp).
- Truppen, Artillerie und Magier werden **über die Kampagnenkarte zu einem Punkt geschickt**. Sie sind
  je nach Entfernung eine Weile unterwegs und greifen dann vom hinteren Kartenrand ins laufende
  Gefecht ein.
- **Unbewachte Punkte** sind gefährlich: Dort kommt der Gegner schon mit wenigen Truppen durch. Wer mit
  zu vielen Ländern gleichzeitig Krieg führt, kann nicht alle Punkte halten.

## Einnahme eines Frontpunkts

Maßgeblich ist der **Anteil an der Gesamtstärke** am Punkt. Stärke heißt Menge und Qualität zusammen:
Soldaten, Ausbildung, Ausrüstung, Artillerie, Magier.

```
eigener Anteil = eigene Stärke / (eigene Stärke + gegnerische Stärke)

Beispiel: 7.000 eigene, 3.000 gegnerische Stärke → 7.000 / 10.000 = 0,70
```

| Eigener Anteil | Zustand                                                                |
| -------------- | ---------------------------------------------------------------------- |
| ≥ 0,70         | **Wir nehmen ein**, der Balken wandert zu uns                          |
| 0,30 – 0,70    | **Stellungskrieg**, der Balken kehrt langsam zur Mitte zurück (neutral) |
| < 0,30         | **Der Gegner nimmt ein**                                               |

### Wie schnell? (Balken 0 bis 100 Punkte)

Für jedes Prozent, das der Unterlegene unter 30 % liegt, wird der Balken schneller. Der Anstieg ist
linear pro Prozentpunkt:

```
Punkte pro Minute = 1,67 + 0,172 × (29 − Anteil des Unterlegenen in %)
```

| Anteil des Unterlegenen | Punkte/Min | Dauer bis eingenommen |
| ----------------------- | ---------- | --------------------- |
| 29 %                    | 1,67       | 60 Min                |
| 25 %                    | 2,36       | 42 Min                |
| 20 %                    | 3,22       | 31 Min                |
| 15 %                    | 4,08       | 25 Min                |
| 10 %                    | 4,94       | 20 Min                |
| 5 %                     | 5,80       | 17 Min                |
| 0 %                     | 6,67       | 15 Min                |

Im Stellungskrieg (30–70 %) läuft der Balken mit etwa 2 Punkten pro Minute zurück zur Mitte.

Ist der Balken voll, **rückt der Frontpunkt vor** und die Provinz dahinter wechselt den Besitzer. Die
Truppen am Punkt ziehen mit.

Alle Zahlen stehen später an einer Stelle im Code und können leicht angepasst werden.

## Schlachten

- Echtzeit, langsames Tempo, ~3.000+ Soldaten pro Gefecht
- Man bewegt keine einzelnen Einheiten, sondern gibt allgemeine Befehle: Positionen, Ziele, Sturm,
  Rückzug, Artillerie, Magier
- **KI-Offiziere pro Flanke** (links / Mitte / rechts) mit grober Einstellung:
  *Halten · Defensiv · Ausgewogen · Aggressiv*. Sie führen die Schlacht, auch wenn man nicht hinschaut.
  Man kann jederzeit selbst übernehmen.
- Die Stärke im Gefecht (lebende Soldaten × Qualität) ist genau die Stärke, die für die Einnahme zählt.
  Wer die Schlacht gut führt, verschiebt also direkt den Balken.

### Ziel für die Gefechte (erste Ausbaustufe umgesetzt in v0.3)

Die Schlachten sollen später richtig gut aussehen und sich glaubwürdig anfühlen.

**Sichtbarkeit**
- Jeder Schuss sichtbar: Mündungsfeuer, Leuchtspur, Einschlag (Erdspritzer bei Fehlschuss)
- Treffer erkennbar: Soldat zuckt/fällt, Blut an der Stelle, das **mit der Zeit verblasst**
- Artillerie: Einschlag, Druckwelle, Erdfontäne, Rauch; Trichter bleiben dauerhaft
- Magier: sichtbare Zauberstrahlen, Schildblitzen bei Treffern

**Logisches Verhalten**
- Truppen halten ihre **Position** und kämpfen auf **wirksamer Reichweite** ihrer Waffe, statt
  wahllos in den Gegner zu rennen
- Deckung aktiv nutzen: unter Beschuss ducken, von Trichter zu Trichter vorgehen
- MGs bleiben in befestigten Stellungen, Schützen halten Abstand
- Sturmangriffe nur auf Befehl oder wenn der Offizier die Lage als günstig einschätzt
  (z. B. nach Artillerie, gegen geschwächte Stellungen)
- Verwundete/Fliehende ziehen sich nach hinten zurück, Nachschub rückt geordnet nach

## Wirtschaft (einfach)

- Wenige Ressourcen: **Gold, Nahrung, Material, Rekruten**
- Jede Provinz produziert etwas davon
- Upgrades sind klare Stufen (z. B. Infanterie I → II → III), keine Produktionsketten

## Diplomatie (einfach)

- Jedes Land hat eine **Meinung** über jedes andere (mögen ↔ nicht mögen).
- Aktionen verändern die Meinung, z. B. Krieg gegen einen Freund, Truppen an der Grenze oder
  eroberte Nachbarprovinzen.
- **Einfache Bündnisse**: Wird ein Partner angegriffen, wird man um Hilfe gerufen.

## Technik

- **Server** (Node.js auf dem Home-PC) rechnet die ganze Welt und alle Schlachten und speichert.
- **Browser-Clients** (PC oder Handy) zeigen an und schicken Befehle.
- Eine Schlacht kostet aktuell ~0,7 ms pro Rechenschritt, also etwa 1–2 % CPU. 10–20 gleichzeitige
  Schlachten sind für einen normalen PC kein Problem.

## Reihenfolge

1. ✅ Schlacht-Prototyp
2. ✅ Kampagnen-Prototyp: alternatives Europa 1914 (13 Nationen, 677 Provinzen), Julikrise und
   Bündnisse, Frontpunkte mit Stärke-Balken, Truppen schicken, KI-Offiziere pro Flanke, Punkt
   antippen öffnet die laufende Schlacht, einfache Wirtschaft und Diplomatie
3. Server/Client-Trennung und Speichern
4. Wirtschaft und Upgrades
5. Diplomatie und Bündnisse
6. Ganze Welt, mehr Einheiten und Magier-Asse

## Offene Punkte

- Weitere Regionen der Welt (Kolonien, Amerika, Asien): Der Kartengenerator ist dafür vorbereitet,
  es fehlen nur weitere Regionen und Nationen in `scripts/mapdef.ts`.
- Seekrieg / Landungen (Brythanien erreicht die Front bisher nur über Verbündete)

- Namen und Aussehen der Länder (alternative Versionen der Großmächte von 1914)
- Wie lange soll eine ganze Kampagne ungefähr dauern?
- Wie wird die Stärke genau aus Menge und Qualität berechnet?
