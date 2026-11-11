# 🚀 NEBULA STRIKE

> Neon void combat — survive the waves. A fully procedural **3D space combat game** that runs in your browser. No build step, no assets to download — every star, explosion and sound is generated in code.

**▶ PLAY NOW: <https://ayan27612-oss.github.io/nebula-strike/>**

---

## ✨ Features

- **Real-time 3D** rendered with [Three.js](https://threejs.org) and glowing **UnrealBloom** post-processing
- **Procedural everything** — nebulae, starfields, asteroids, drones and the boss are generated at runtime (zero image assets)
- **4 enemy classes** — Weavers, Snipers, Tanks and Swarm drones, each with distinct flight & fire patterns
- **Boss fights** every 5th wave: the *Dreadnought* with radial bullet-hell bursts, aimed volleys and escorts
- **Combo system** — chain kills within 2.5s to multiply your score up to ×3
- **Power-ups** — 🔧 Repair, 🛡 Shield (invulnerability), ⚡ Triple-shot
- **Destructible asteroids** that split into fragments when destroyed
- **Synthesized sound** — lasers, explosions, pickups and a generative bass/pad soundtrack via WebAudio (no audio files)
- **Score popups, screen shake, hit flashes, engine trails** and other juice
- **Mobile friendly** — drag to fly, auto-fire on touch
- High score saved in `localStorage`

## 🎮 Controls

| Action | Desktop | Mobile |
|---|---|---|
| Fly | Mouse / `WASD` / Arrows | Drag anywhere |
| Fire | Hold click / `Space` | Auto-fire while touching |
| Pause | `P` / `Esc` | — |
| Mute | `M` | 🔊 button |

## 🧪 Tech

- Three.js `0.160` (ES modules via import map — no bundler)
- `EffectComposer` → `RenderPass` → `UnrealBloomPass` → `OutputPass`
- Procedural geometry (noise-displaced icosahedra, extruded ship wings)
- Pooled bullets / particles / trail sprites for stable framerates
- WebAudio API: oscillators + filtered noise, all synthesized live

## 🏃 Run locally

Any static server works:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

(Deployed via GitHub Pages.)

## 📁 Structure

```
nebula-strike/
├── index.html      # markup, neon UI, styles, import map
├── src/
│   └── main.js     # the entire game: render, sim, audio, input
└── README.md
```

## 📄 License

MIT — see [LICENSE](LICENSE).

---

*Built with [OpenCode](https://opencode.ai).*
