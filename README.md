# NEBULA STRIKE

A 3D space shooter that runs in the browser, built with Three.js.

Fly around, shoot down drones and asteroids, survive the waves. Every 5th wave there is a boss. Waves keep getting harder until you run out of lives — your high score is saved locally.

Everything in the game (models, backgrounds, explosions, sounds) is generated in code, so there are no asset files.

**Play:** <https://ayan27612-oss.github.io/nebula-strike/>

## Controls

| | Desktop | Mobile |
|---|---|---|
| Move | mouse / WASD / arrows | drag on the left half of the screen |
| Fire | hold click / space | auto-fires while flying, or hold FIRE |
| Pause | P / Esc | pause button |
| Mute | M | mute button |

On phones the game asks for fullscreen and locks to landscape if the browser allows it. If your browser blocks that, just rotate the phone manually.

## Power-ups

Drones sometimes drop pickups: repair (+1 life), shield (6s invulnerability) and triple shot (8s). The boss always drops two.

## Run locally

Any static server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## License

MIT
