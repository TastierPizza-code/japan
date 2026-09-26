# Grabenfront

Strategiespiel im Stil eines Anime-Grabenkriegs (inspiriert von Serien wie *Saga of Tanya the Evil*,
eigenes Setting): riesige Schlachten mit Tausenden Soldaten wie in *Songs of Syx*, später eingebettet
in eine rundenbasierte Weltkampagne. Läuft im Browser, auf dem Handy wie am PC.

## Stand: Schlacht-Prototyp (v0.1)

- ~3.000 Soldaten gleichzeitig (Schützen, MG-Stellungen, fliegende Magier) in Echtzeit mit Pause
- Grabenkrieg: Zickzack-Gräben, Stacheldraht, Granattrichter als Deckung, Moral und Flucht
- **Allgemeine Befehle statt Mikromanagement:** Kompanie antippen, Karte antippen → sie rückt vor und
  sucht selbst Deckung. Dazu *Halten*, *Sturm!* und *Rückzug*
- **Artillerie:** Zielgebiet antippen, Einschlag nach 6 Sekunden. Trifft auch eigene Leute und hinterlässt
  neue Trichter
- **Magier:** fliegen übers Niemandsland, Flächenzauber, kämpfen gegen feindliche Magier, müssen zum
  Aufladen zurück
- Computergegner mit Vorbereitung (Artillerie → Bereitstellung → Sturm), Gegenangriffen und Reserven
- Langsames Tempo: eine Schlacht dauert etwa 15 Minuten, mit 1×/2×/4× Geschwindigkeit

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
npm run dev        # Entwicklung, mit automatischem Neuladen
```

Die Konsole zeigt eine Adresse wie `http://192.168.x.x:5173`. Die kannst du **auf dem Handy im
selben WLAN** öffnen.

### Auf dem Home-PC als Server

```bash
npm start          # baut das Spiel und startet es auf Port 8080
```

Dann auf dem Handy `http://<IP-deines-PCs>:8080` öffnen. Tipp: Im Handy-Browser „Zum Startbildschirm
hinzufügen“, dann läuft es wie eine App im Vollbild.

### Steuerung

| Aktion             | Handy                      | PC                      |
| ------------------ | -------------------------- | ----------------------- |
| Kompanie wählen    | Fahne oder Liste antippen  | Klick                   |
| Position zuweisen  | Karte antippen             | Klick                   |
| Karte verschieben  | Ziehen                     | Ziehen                  |
| Zoom               | Zwei Finger                | Mausrad                 |
| Pause              | ⏸                          | Leertaste               |
| Tempo              | 1× 2× 4×                   | Tasten 1 / 2 / 3        |
| Halten/Sturm/Rückz. | Buttons                   | H / S / R               |
| Artillerie         | Button, dann Ziel antippen | A, dann Klick           |

## Aufbau des Codes

```
src/sim/       Simulation, ohne Grafik (läuft auch auf dem Server / in Node)
  config.ts    alle Balancing-Werte an einer Stelle
  battle.ts    Soldaten, Kompanien, Kampf, Moral, Artillerie, Ziele
  terrain.ts   Gräben, Draht, Trichter als Deckungs-/Bewegungsraster
  grid.ts      räumliches Raster für schnelle Nachbarsuche
  ai.ts        Computergegner
src/render/    WebGL-Darstellung der Einheiten, Gelände-Canvas, Kamera
src/ui/        Fahnen und Markierungen auf der Karte
src/main.ts    Spielschleife, Eingabe, Menüs
scripts/headless.ts  KI gegen KI ohne Grafik, für Balancing und Performance
```

Balancing testen: `npm run sim -- <seed> <minuten>` lässt eine ganze Schlacht in wenigen Sekunden
durchlaufen und zeigt Verlauf, Sieger und Rechenzeit pro Tick.

## Nächste Schritte

1. **Kampagnenkarte:** rundenbasierte Weltkarte mit Provinzen, Armeen bewegen, Fronten
2. **Einfache Wirtschaft:** Gold, Nahrung, Material, Rekruten pro Provinz; klare Upgrade-Stufen
3. **Verbindung:** Aufeinandertreffen auf der Karte → Schlacht (selbst führen oder auto-berechnen),
   Verluste und Gebietsgewinne fließen zurück
4. **Speichern auf dem Home-Server**, damit man zwischen Handy und PC wechseln kann
5. Mehr Einheiten: Scharfschützen, Flammenwerfer, Panzer-Prototypen, Magier-Asse mit Fähigkeiten
