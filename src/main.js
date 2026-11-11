/* ============================================================
   NEBULA STRIKE — neon void combat
   A single-file Three.js game: rendering, simulation,
   procedural assets, synthesized audio, input & UI.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------------- config & state ---------------- */

const BOUNDS = { x: 24, y: 13 };
const SPAWN_Z = -175;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let state = 'menu';            // menu | playing | paused | gameover
let elapsed = 0;
let score = 0, high = 0, lives = 3, wave = 0;
let comboChain = 0, comboTimer = 0;
let weaponTimer = 0, shieldTimer = 0, invulnTimer = 0;
let fireCooldown = 0, fireSide = 1;
let shake = 0;
let muted = false;
let bossIndex = 0;

// wave spawning
let waveQueue = [];
let spawnTimer = 0;
let asteroidsQuota = 0, asteroidTimer = 0;
let waveClearTimer = -1;

try { high = parseInt(localStorage.getItem('nebula-strike-high') || '0', 10) || 0; } catch (e) {}
try { muted = localStorage.getItem('nebula-strike-muted') === '1'; } catch (e) {}

const shipTarget = { x: 0, y: 0 };
const keys = {};
let firing = false;

/* ---------------- DOM ---------------- */

const $ = id => document.getElementById(id);
const ui = {
  hud: $('hud'), score: $('score'), waveLabel: $('waveLabel'), hearts: $('hearts'),
  combo: $('combo'), timers: $('timers'), muteBtn: $('muteBtn'),
  banner: $('banner'), bannerText: $('bannerText'), bannerSub: $('bannerSub'),
  bossBar: $('bossBar'), bossFill: $('bossFill'), bossLabel: $('bossLabel'),
  menu: $('menu'), startBtn: $('startBtn'), menuHigh: $('menuHigh'),
  keyControls: $('keyControls'), touchHint: $('touchHint'),
  gameover: $('gameover'), finalScore: $('finalScore'), finalHigh: $('finalHigh'),
  newRecord: $('newRecord'), restartBtn: $('restartBtn'),
  pause: $('pause'), nogl: $('nogl'), hitflash: $('hitflash'),
  popups: $('popups'),
};

ui.menuHigh.textContent = high;
if (isTouch) {
  ui.keyControls.classList.add('hidden');
  ui.touchHint.classList.remove('hidden');
}
function applyMuteIcon() { ui.muteBtn.textContent = muted ? '🔇' : '🔊'; }
applyMuteIcon();

/* ---------------- audio (all synthesized) ---------------- */

const AudioFX = {
  ctx: null, master: null, musicGain: null, noiseBuf: null,
  musicTimer: null, step: 0, nextBeat: 0,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.55;
      this.musicGain.connect(this.master);

      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.startMusic();
    } catch (e) { /* audio unavailable — game still runs */ }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) {
    muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
    try { localStorage.setItem('nebula-strike-muted', m ? '1' : '0'); } catch (e) {}
  },
  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  },
  tone(o) {
    if (!this.ctx) return;
    const c = this.ctx, t = o.t ?? c.currentTime;
    const osc = c.createOscillator();
    osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t + o.dur);
    const g = c.createGain();
    this.env(g, t, o.a ?? 0.008, o.peak, o.dur);
    osc.connect(g); g.connect(o.dest || this.master);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  },
  noise(o) {
    if (!this.ctx) return;
    const c = this.ctx, t = o.t ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const flt = c.createBiquadFilter();
    flt.type = o.type || 'lowpass';
    flt.frequency.setValueAtTime(o.f0, t);
    if (o.f1) flt.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 10), t + o.dur);
    const g = c.createGain();
    this.env(g, t, 0.012, o.peak, o.dur);
    src.connect(flt); flt.connect(g); g.connect(o.dest || this.master);
    src.start(t); src.stop(t + o.dur + 0.05);
  },

  pew()  { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.tone({ type: 'sawtooth', f0: 920, f1: 170, dur: 0.13, peak: 0.15, t });
           this.tone({ type: 'square',   f0: 1840, f1: 340, dur: 0.08, peak: 0.045, t }); },
  zap()  { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.tone({ type: 'square', f0: 300, f1: 85, dur: 0.22, peak: 0.07, t }); },
  boom(size = 1) { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.noise({ dur: 0.65 * size, f0: 1100, f1: 70, peak: 0.45 * Math.min(size, 1.5), t });
           this.tone({ type: 'sine', f0: 115, f1: 34, dur: 0.5 * size, peak: 0.4, t }); },
  hit()  { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.noise({ dur: 0.3, f0: 700, f1: 90, peak: 0.4, t });
           this.tone({ type: 'triangle', f0: 210, f1: 55, dur: 0.32, peak: 0.3, t }); },
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.tone({ type: 'sine', f0: 660, dur: 0.1, peak: 0.2, t });
           this.tone({ type: 'sine', f0: 990, dur: 0.14, peak: 0.2, t: t + 0.09 }); },
  wave() { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.4, peak: 0.11, t });
           this.tone({ type: 'triangle', f0: 495, f1: 990, dur: 0.45, peak: 0.09, t: t + 0.08 }); },
  ui()   { if (!this.ctx) return; const t = this.ctx.currentTime;
           this.tone({ type: 'sine', f0: 520, dur: 0.08, peak: 0.14, t }); },

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const spb = 60 / 104 / 2;                       // 8th notes @104 bpm
    const bass = [55, 0, 55, 55, 0, 65.41, 0, 55, 49, 0, 49, 49, 0, 58.27, 0, 43.65];
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63]];
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      while (this.nextBeat < this.ctx.currentTime + 0.3) {
        const t = this.nextBeat, i = this.step;
        const f = bass[i];
        if (f) this.tone({ type: 'sawtooth', f0: f, dur: 0.22, peak: 0.05, t, dest: this.musicGain });
        if (i % 8 === 0) {
          const ch = chords[(i / 8) % 2];
          for (const cf of ch) this.tone({ type: 'sine', f0: cf, dur: 2.4, peak: 0.012, a: 0.5, t, dest: this.musicGain });
        }
        this.step = (this.step + 1) % 16;
        this.nextBeat += spb;
      }
    }, 90);
  },
};

/* ---------------- renderer / scene ---------------- */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  ui.nogl.classList.remove('hidden');
  ui.menu.classList.add('hidden');
  throw e;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02010a);
scene.fog = new THREE.FogExp2(0x02010a, 0.0042);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
camera.position.set(0, 3.4, 30);

scene.add(new THREE.AmbientLight(0x334466, 0.65));
const sun = new THREE.DirectionalLight(0xaaccff, 1.25);
sun.position.set(6, 10, 8);
scene.add(sun);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.95, 0.5, 0.18);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ---------------- procedural textures ---------------- */

function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [off, col] of stops) grad.addColorStop(off, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

const texGlow = radialTexture(128, [
  [0, 'rgba(255,255,255,1)'], [0.25, 'rgba(190,240,255,0.65)'],
  [0.6, 'rgba(80,180,255,0.22)'], [1, 'rgba(0,0,0,0)'],
]);
const texParticle = radialTexture(64, [
  [0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)'],
]);
function nebulaTexture(hex) {
  return radialTexture(256, [
    [0, hex + 'e6'], [0.4, hex + '55'], [0.75, hex + '18'], [1, hex + '00'],
  ]);
}

/* ---------------- background: stars & nebulae ---------------- */

const drifters = [];

function makeStars(count, minR, maxR, size, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const tints = [new THREE.Color(0xffffff), new THREE.Color(0x9fd8ff), new THREE.Color(0xffd9a8), new THREE.Color(0xff9fd0)];
  for (let i = 0; i < count; i++) {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
      .multiplyScalar(minR + Math.random() * (maxR - minR));
    pos.set([v.x, v.y, v.z], i * 3);
    const c = tints[(Math.random() * tints.length) | 0].clone().multiplyScalar(0.55 + Math.random() * 0.45);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, map: texParticle, transparent: true, opacity, vertexColors: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
}

const starFar = makeStars(isTouch ? 2400 : 4600, 140, 420, 1.15, 0.9);
const starNear = makeStars(isTouch ? 500 : 900, 60, 140, 1.9, 0.85);

const NEB_COLORS = ['#7b2fff', '#00e5ff', '#ff2f92', '#ff7b2f'];
for (let i = 0; i < 6; i++) {
  const mat = new THREE.SpriteMaterial({
    map: nebulaTexture(NEB_COLORS[i % NEB_COLORS.length]),
    transparent: true, opacity: 0.30, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.position.set((Math.random() - 0.5) * 320, (Math.random() - 0.5) * 150, -160 - Math.random() * 150);
  const sc = 110 + Math.random() * 90;
  s.scale.set(sc, sc, 1);
  mat.rotation = Math.random() * Math.PI * 2;
  scene.add(s);
  drifters.push({ obj: s, mat, spin: (Math.random() - 0.5) * 0.02 });
}

/* ---------------- the ship ---------------- */

function buildShip() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a2340, metalness: 0.85, roughness: 0.32 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b1030, metalness: 0.9, roughness: 0.25 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0b1030, metalness: 0.8, roughness: 0.3, emissive: 0x00e5ff, emissiveIntensity: 1.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1626, metalness: 1, roughness: 0.12, emissive: 0x1b6d8a, emissiveIntensity: 0.5 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x141d3a, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.62, 4.0, 24), hullMat);
  body.rotation.x = -Math.PI / 2;
  g.add(body);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 2.8), trimMat);
  spine.position.set(0, 0.56, 0.15);
  g.add(spine);

  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 1.15), darkMat);
  housing.position.set(0, -0.02, 2.0);
  g.add(housing);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), glassMat);
  cockpit.scale.set(1, 0.75, 1.6);
  cockpit.position.set(0, 0.42, -0.35);
  g.add(cockpit);

  // swept delta wings (extruded shapes)
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.7); shape.lineTo(3.1, -0.1); shape.lineTo(3.5, 0.4);
  shape.lineTo(0.45, 0.8); shape.lineTo(0, 0.55); shape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false });
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(0, -0.045, 0);

  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.position.set(0.5, -0.05, 0.35);
  wingR.rotation.z = -0.07;
  g.add(wingR);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.scale.x = -1;
  wingL.position.set(-0.5, -0.05, 0.35);
  wingL.rotation.z = 0.07;
  g.add(wingL);

  // engines: center + two wing pods
  const engGeo = new THREE.CylinderGeometry(0.3, 0.42, 0.9, 14);
  engGeo.rotateX(Math.PI / 2);
  const engineC = new THREE.Mesh(engGeo, darkMat); engineC.position.set(0, 0, 2.55); g.add(engineC);
  const engineL = new THREE.Mesh(engGeo, darkMat); engineL.scale.setScalar(0.6); engineL.position.set(-2.4, 0, 1.6); g.add(engineL);
  const engineR = new THREE.Mesh(engGeo, darkMat); engineR.scale.setScalar(0.6); engineR.position.set(2.4, 0, 1.6); g.add(engineR);

  // engine glow sprites
  const glowAt = (x, y, z, s) => {
    const m = new THREE.SpriteMaterial({ map: texGlow, color: 0x59d9ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sp = new THREE.Sprite(m);
    sp.position.set(x, y, z); sp.scale.set(s, s, 1);
    g.add(sp); return sp;
  };
  const glows = [glowAt(0, 0, 3.2, 2.6), glowAt(-2.4, 0, 2.2, 1.3), glowAt(2.4, 0, 2.2, 1.3)];

  const engineLight = new THREE.PointLight(0x66ccff, 2.2, 16, 2);
  engineLight.position.set(0, 0.4, 3.0);
  g.add(engineLight);

  g.scale.setScalar(1.12);
  scene.add(g);
  return { group: g, glows, engineLight };
}
const ship = buildShip();

// shield bubble
const shieldMesh = new THREE.Mesh(
  new THREE.SphereGeometry(2.7, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x7cf7ff, wireframe: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
);
shieldMesh.visible = false;
scene.add(shieldMesh);

/* ---------------- effect pools ---------------- */

class Burst {
  constructor(n = 54) {
    this.n = n;
    this.vel = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.55, map: texParticle, transparent: true, opacity: 0,
      vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.life = 0; this.maxLife = 0.9;
  }
  fire(pos, palette, speed = 7, size = 0.55, dur = 0.9) {
    const p = this.geo.attributes.position.array;
    const c = this.geo.attributes.color.array;
    const col = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = Math.cos(ph) * sp;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      col.set(palette[(Math.random() * palette.length) | 0]);
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mat.size = size;
    this.maxLife = dur; this.life = dur;
    this.points.visible = true;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) { this.points.visible = false; this.mat.opacity = 0; return; }
    const p = this.geo.attributes.position.array;
    for (let i = 0; i < this.n * 3; i++) {
      p[i] += this.vel[i] * dt;
      this.vel[i] *= Math.exp(-2.2 * dt);
    }
    this.geo.attributes.position.needsUpdate = true;
    const t01 = this.life / this.maxLife;
    this.mat.opacity = t01;
    this.mat.size = 0.4 + 0.5 * t01;
  }
}
const bursts = [];
const BURST_POOL = isTouch ? 16 : 26;
for (let i = 0; i < BURST_POOL; i++) bursts.push(new Burst());
function burst(pos, palette, opts = {}) {
  const b = bursts.reduce((a, x) => (x.life < a.life ? x : a));
  b.fire(pos, palette, opts.speed ?? 7, opts.size ?? 0.55, opts.dur ?? 0.9);
}

class Flash {
  constructor() {
    this.light = new THREE.PointLight(0xffffff, 0, 34, 2);
    this.light.visible = false;
    scene.add(this.light);
    this.life = 0; this.base = 0;
  }
  fire(pos, color, intensity) {
    this.light.position.copy(pos);
    this.light.color.set(color);
    this.base = intensity;
    this.life = 0.38;
    this.light.visible = true;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) { this.light.visible = false; this.light.intensity = 0; return; }
    this.light.intensity = this.base * (this.life / 0.38);
  }
}
const flashes = [];
for (let i = 0; i < 5; i++) flashes.push(new Flash());
function flash(pos, color, intensity = 6) {
  const f = flashes.reduce((a, x) => (x.life < a.life ? x : a));
  f.fire(pos, color, intensity);
}

// engine trail sprites
const trails = [];
for (let i = 0; i < (isTouch ? 26 : 42); i++) {
  const m = new THREE.SpriteMaterial({ map: texGlow, color: 0x59d9ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.set(0.9, 0.9, 1);
  s.visible = false;
  scene.add(s);
  trails.push({ sprite: s, life: 0, max: 0.5 });
}
let trailTimer = 0;
function spawnTrail() {
  const t = trails.reduce((a, x) => (x.life < a.life ? x : a));
  ship.group.updateMatrixWorld(true);
  t.sprite.position.copy(ship.group.localToWorld(new THREE.Vector3(0, 0, 2.9)));
  t.sprite.material.color.set(0x59d9ff);
  t.sprite.scale.set(0.9, 0.9, 1);
  t.sprite.visible = true;
  t.life = t.max = 0.5;
}
function updateTrails(dt) {
  for (const t of trails) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) { t.sprite.visible = false; continue; }
    t.sprite.position.z += 9 * dt;
    const k = t.life / t.max;
    t.sprite.material.opacity = 0.75 * k;
    const s = 0.9 * (0.6 + 0.8 * k);
    t.sprite.scale.set(s, s, 1);
  }
}

/* ---------------- bullets ---------------- */

const boltGeoP = new THREE.CylinderGeometry(0.09, 0.09, 1.9, 6);
boltGeoP.rotateX(Math.PI / 2);
const boltMatP = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, fog: false });
const boltGeoE = new THREE.SphereGeometry(0.26, 8, 8);
const boltMatE = {
  0xff4d6d: new THREE.MeshBasicMaterial({ color: 0xff4d6d, fog: false }),
  0xffd24d: new THREE.MeshBasicMaterial({ color: 0xffd24d, fog: false }),
  0xff7b2f: new THREE.MeshBasicMaterial({ color: 0xff7b2f, fog: false }),
  0xff2f92: new THREE.MeshBasicMaterial({ color: 0xff2f92, fog: false }),
  0xff5e3a: new THREE.MeshBasicMaterial({ color: 0xff5e3a, fog: false }),
};

const playerBolts = [];
const enemyBolts = [];

function makeBolt(list, geo, mat, speed) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  scene.add(mesh);
  const b = { mesh, vel: new THREE.Vector3(), life: 0, speed, alive: false };
  list.push(b);
  return b;
}
function spawnBolt(list, geo, mat, speed, pos, dir) {
  const free = list.find(b => !b.alive) || makeBolt(list, geo, mat, speed);
  free.mesh.material = mat;
  free.mesh.position.copy(pos);
  free.vel.copy(dir).multiplyScalar(speed);
  free.alive = true;
  free.mesh.visible = true;
  return free;
}

/* ---------------- enemies ---------------- */

const droneGeo = new THREE.OctahedronGeometry(0.95, 0);
const ringGeo = new THREE.TorusGeometry(1.18, 0.07, 8, 26);
const eyeGeo = new THREE.SphereGeometry(0.3, 12, 10);
const enemyLightPalette = {
  weaver: [0xff4d6d, 0xffffff, 0xff9fb0],
  sniper: [0xffd24d, 0xffffff, 0xfff3b0],
  tank:   [0xff7b2f, 0xffffff, 0xffc48f],
  swarm:  [0xff2f92, 0xffffff, 0xff9fd0],
  boss:   [0xff5e3a, 0xffffff, 0xffb347, 0xff2f92],
};

const TYPES = {
  weaver: { hp: 2, score: 100, scale: 1.0, hold: [-46, -30], amp: [6, 10], freq: [1.1, 1.9], fire: [2.2, 3.2], boltSpeed: 24, color: 0xff4d6d, holdDur: [6, 9] },
  sniper: { hp: 2, score: 140, scale: 1.0, hold: [-62, -52], amp: [3, 5],  freq: [0.7, 1.1], fire: [2.6, 3.6], boltSpeed: 36, color: 0xffd24d, holdDur: [7, 10] },
  tank:   { hp: 5, score: 220, scale: 1.65, hold: [-40, -30], amp: [3, 5],  freq: [0.6, 0.9], fire: [2.4, 3.2], boltSpeed: 20, color: 0xff7b2f, holdDur: [8, 11], spread: 3 },
  swarm:  { hp: 1, score: 80,  scale: 0.6,  fire: [4, 6], boltSpeed: 22, color: 0xff2f92, seek: true, speed: 15 },
};

const enemies = [];

class Enemy {
  constructor(type, x, y) {
    const T = TYPES[type];
    this.type = type;
    this.T = T;
    this.alive = true;
    this.hp = T.hp;
    this.score = T.score;
    this.r = 1.15 * T.scale;
    this.t = Math.random() * 10;
    this.mode = T.seek ? 'seek' : 'enter';
    this.flash = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.freq = T.freq ? T.freq[0] + Math.random() * (T.freq[1] - T.freq[0]) : 0;
    this.amp = T.amp ? T.amp[0] + Math.random() * (T.amp[1] - T.amp[0]) : 0;
    this.holdZ = T.hold ? T.hold[0] + Math.random() * (T.hold[1] - T.hold[0]) : 0;
    this.holdDur = T.holdDur ? T.holdDur[0] + Math.random() * (T.holdDur[1] - T.holdDur[0]) : 999;
    this.fireTimer = 1 + Math.random() * (T.fire[1] - T.fire[0]);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x22082e, metalness: 0.7, roughness: 0.35, flatShading: true,
      emissive: T.color, emissiveIntensity: 1.1,
    });

    this.group = new THREE.Group();
    const core = new THREE.Mesh(droneGeo, this.mat);
    if (type === 'sniper') core.scale.set(0.85, 1.0, 1.45);
    this.group.add(core);
    if (type !== 'swarm') {
      const ring = new THREE.Mesh(ringGeo, boltMatE[T.color]);
      ring.rotation.x = 1.25;
      this.ring = ring;
      this.group.add(ring);
    }
    const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    eye.position.z = -0.85;
    this.eye = eye;
    this.group.add(eye);
    this.group.scale.setScalar(T.scale);
    this.group.position.set(x, y, SPAWN_Z - Math.random() * 30);
    scene.add(this.group);
  }

  update(dt) {
    const p = this.group.position;
    this.t += dt;
    if (this.mode === 'enter') {
      p.z += 30 * dt;
      if (p.z >= this.holdZ) this.mode = 'hold';
    } else if (this.mode === 'hold') {
      p.x = this.baseX + Math.sin(this.t * this.freq + this.phase) * this.amp;
      p.y = this.baseY + Math.cos(this.t * this.freq * 0.8 + this.phase) * this.amp * 0.6;
      this.holdDur -= dt;
      if (this.holdDur <= 0) this.mode = 'leave';
    } else if (this.mode === 'leave') {
      p.z += 12 * dt;
      if (p.z > 42) { this.remove(); return; }
    } else { // seek (swarm)
      const dv = tmpV.copy(ship.group.position).sub(p).normalize();
      p.addScaledVector(dv, (this.T.speed + wave * 0.4) * dt);
      p.x += Math.sin(this.t * 7 + this.phase) * 2.2 * dt;
      p.y += Math.cos(this.t * 6 + this.phase) * 2.2 * dt;
      if (p.z > 26) { this.remove(); return; }
    }
    if (this.ring) { this.ring.rotation.z += 2.6 * dt; this.ring.rotation.y = Math.sin(this.t) * 0.4; }
    this.eye.scale.setScalar(1 + Math.max(0, 0.9 - this.fireTimer) * 0.5);
    this.flash *= Math.exp(-8 * dt);
    this.mat.emissiveIntensity = 1.1 + this.flash * 5;

    // fire
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && state === 'playing') {
      this.fire();
      this.fireTimer = this.T.fire[0] + Math.random() * (this.T.fire[1] - this.T.fire[0]);
    }
  }

  fire() {
    this.group.updateMatrixWorld(true);
    const from = this.group.position;
    const aim = tmpV.copy(ship.group.position).sub(from).normalize();
    const colors = [this.T.color];
    if (this.T.spread) {
      for (let i = 0; i < this.T.spread; i++) {
        const d = aim.clone();
        const a = (i - (this.T.spread - 1) / 2) * 0.16;
        d.x += a; d.normalize();
        spawnBolt(enemyBolts, boltGeoE, boltMatE[this.T.color], this.T.boltSpeed, from, d);
      }
    } else {
      if (this.type !== 'sniper') aim.x += (Math.random() - 0.5) * 0.08, aim.y += (Math.random() - 0.5) * 0.06, aim.normalize();
      spawnBolt(enemyBolts, boltGeoE, boltMatE[this.T.color], this.T.boltSpeed, from, aim);
    }
    AudioFX.zap();
    flash(from, colors[0], 2.5);
  }

  hit(dmg) {
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) this.die(true);
  }

  die(reward) {
    if (!this.alive) return;
    burst(this.group.position, enemyLightPalette[this.type], { speed: 8, dur: 0.85 });
    flash(this.group.position, this.T.color, 6);
    AudioFX.boom(this.type === 'tank' ? 1.3 : 0.9);
    if (reward) {
      const mult = 1 + comboChain * 0.25;
      addScore(Math.round(this.score * mult / 5) * 5, this.group.position, '#aef6ff');
      if (Math.random() < 0.14) spawnPickup(this.group.position);
    }
    this.remove();
  }

  remove() {
    this.alive = false;
    scene.remove(this.group);
    this.mat.dispose();
  }
}

function spawnEnemy(type) {
  const x = (Math.random() - 0.5) * 32;
  const y = (Math.random() - 0.5) * 14;
  const e = new Enemy(type, x, y);
  e.baseX = x; e.baseY = y;
  enemies.push(e);
}

/* ---------------- boss ---------------- */

class Boss {
  constructor() {
    this.type = 'boss';
    this.alive = true;
    this.isBoss = true;
    bossIndex++;
    this.hp = this.maxHp = 55 + 12 * bossIndex;
    this.r = 3.8;
    this.t = 0;
    this.mode = 'enter';
    this.flash = 0;
    this.pattern = 0;
    this.patternTimer = 2.4;

    this.mat = new THREE.MeshStandardMaterial({
      color: 0x2a0812, metalness: 0.75, roughness: 0.3, flatShading: true,
      emissive: 0xff5e3a, emissiveIntensity: 1.0,
    });
    this.group = new THREE.Group();
    const core = new THREE.Mesh(droneGeo, this.mat);
    core.scale.setScalar(3.2);
    this.group.add(core);
    const r1 = new THREE.Mesh(ringGeo, boltMatE[0xff5e3a]); r1.scale.setScalar(1.45); r1.rotation.x = 1.25; this.r1 = r1; this.group.add(r1);
    const r2 = new THREE.Mesh(ringGeo, boltMatE[0xff2f92]); r2.scale.setScalar(1.7); r2.rotation.y = 1.25; this.r2 = r2; this.group.add(r2);
    const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    eye.scale.setScalar(2.2); eye.position.z = -2.8; this.eye = eye; this.group.add(eye);
    this.group.position.set(0, 0, SPAWN_Z);
    this.light = new THREE.PointLight(0xff5e3a, 2.4, 46, 2);
    this.group.add(this.light);
    scene.add(this.group);
  }

  update(dt) {
    const p = this.group.position;
    this.t += dt;
    if (this.mode === 'enter') {
      p.z += 26 * dt;
      if (p.z >= -48) this.mode = 'hold';
    } else {
      p.x = Math.sin(this.t * 0.55) * 15;
      p.y = Math.cos(this.t * 0.85) * 4.5;
      this.patternTimer -= dt;
      this.eye.scale.setScalar(2.2 + Math.max(0, 1.2 - this.patternTimer) * 0.8);
      if (this.patternTimer <= 0 && state === 'playing') {
        this.attack();
        this.patternTimer = 2.1;
      }
    }
    this.r1.rotation.z += 1.8 * dt;
    this.r2.rotation.z -= 1.4 * dt;
    this.flash *= Math.exp(-7 * dt);
    this.mat.emissiveIntensity = 1.0 + this.flash * 4;

    ui.bossBar.classList.remove('hidden');
    ui.bossLabel.classList.remove('hidden');
    ui.bossFill.style.width = Math.max(0, this.hp / this.maxHp * 100) + '%';
  }

  attack() {
    const from = this.group.position;
    this.group.updateMatrixWorld(true);
    if (this.pattern === 0) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.t;
        const d = tmpV.set(Math.cos(a), Math.sin(a), 0.4).normalize();
        spawnBolt(enemyBolts, boltGeoE, boltMatE[0xff5e3a], 17, from, d);
      }
      AudioFX.boom(0.7);
    } else if (this.pattern === 1) {
      const aim = tmpV.copy(ship.group.position).sub(from).normalize();
      for (const off of [-0.14, 0, 0.14]) {
        const d = aim.clone(); d.x += off; d.normalize();
        spawnBolt(enemyBolts, boltGeoE, boltMatE[0xff5e3a], 30, from, d);
      }
      AudioFX.zap();
    } else {
      if (enemies.filter(e => e.alive && e.type === 'swarm').length < 6) {
        for (const off of [-4, 4]) {
          const s = new Enemy('swarm', from.x + off, from.y);
          s.baseX = s.baseY = 0;
          s.group.position.set(from.x + off, from.y, from.z - 2);
          enemies.push(s);
        }
      } else {
        const n = 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4;
          spawnBolt(enemyBolts, boltGeoE, boltMatE[0xff5e3a], 14, from, tmpV.set(Math.cos(a), Math.sin(a), 0.3).normalize());
        }
      }
      AudioFX.zap();
    }
    this.pattern = (this.pattern + 1) % 3;
  }

  hit(dmg) {
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    const p = this.group.position;
    for (let i = 0; i < 3; i++) {
      const delay = i * 220;
      setTimeout(() => {
        burst(p, enemyLightPalette.boss, { speed: 10 + i * 3, dur: 1.1 });
        flash(p, 0xff5e3a, 9);
        AudioFX.boom(1.6);
        shake = Math.min(shake + 0.8, 1.6);
      }, delay);
    }
    addScore(2500 + 500 * bossIndex, p, '#ffd24d');
    if (lives < 5) { lives++; popup('+1 LIFE', p, '#7dff9e'); }
    spawnPickup(p);
    spawnPickup(p, Math.random() < 0.5 ? 'shield' : 'weapon');
    AudioFX.wave();
    this.remove();
  }

  remove() {
    this.alive = false;
    scene.remove(this.group);
    this.mat.dispose();
    ui.bossBar.classList.add('hidden');
    ui.bossLabel.classList.add('hidden');
  }
}

/* ---------------- asteroids ---------------- */

function pseudoNoise(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
function rockGeo(size) {
  const geo = new THREE.IcosahedronGeometry(size, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.setLength(size * (0.72 + 0.5 * pseudoNoise(v.x, v.y, v.z)));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
const rockMat = new THREE.MeshStandardMaterial({ color: 0x9c8f80, roughness: 0.95, metalness: 0.08, flatShading: true });
const rockPalette = [0x9c8f80, 0x6b5f52, 0xffd9a0];

const asteroids = [];

class Asteroid {
  constructor(size, x, y, z, vel) {
    this.size = size;
    this.r = size * 1.05;
    this.hp = size > 2.6 ? 4 : size > 1.5 ? 2 : 1;
    this.alive = true;
    this.geo = rockGeo(size);
    this.mesh = new THREE.Mesh(this.geo, rockMat);
    this.mesh.position.set(x, y, z);
    this.vel = vel || new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, 6.5 + Math.random() * 7);
    this.spin = new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6);
    scene.add(this.mesh);
  }
  update(dt) {
    this.mesh.position.addScaledVector(this.vel, dt);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    if (this.mesh.position.z > 50) this.remove();
  }
  hit(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) this.die();
  }
  die() {
    burst(this.mesh.position, rockPalette, { speed: 5, dur: 0.8, size: 0.5 });
    flash(this.mesh.position, 0xffc48f, 3);
    AudioFX.boom(0.7);
    addScore(this.size > 2.6 ? 60 : this.size > 1.5 ? 40 : 25, this.mesh.position, '#ffd9a8');
    if (this.size > 1.7) {
      for (const off of [-0.8, 0.8]) {
        const a = new Asteroid(this.size / 1.7, this.mesh.position.x + off, this.mesh.position.y + off * 0.5, this.mesh.position.z,
          new THREE.Vector3(off * 2.4, (Math.random() - 0.5) * 2, this.vel.z * 0.9));
        asteroids.push(a);
      }
    }
    this.remove();
  }
  remove() {
    this.alive = false;
    scene.remove(this.mesh);
    this.geo.dispose();
  }
}

function spawnAsteroid() {
  const roll = Math.random();
  const size = roll < 0.3 ? 3.2 : roll < 0.68 ? 1.9 : 1.1;
  asteroids.push(new Asteroid(size, (Math.random() - 0.5) * 44, (Math.random() - 0.5) * 22, SPAWN_Z - 10));
}

/* ---------------- pickups ---------------- */

const PICKUPS = {
  repair: { color: 0x2fff7b },
  shield: { color: 0x00e5ff },
  weapon: { color: 0x7c4dff },
};
const pickupGeo = {
  repair: new THREE.BoxGeometry(0.62, 0.2, 0.2),
  shield: new THREE.TorusGeometry(0.5, 0.1, 8, 20),
  weapon: new THREE.OctahedronGeometry(0.48, 0),
};

const pickups = [];

function spawnPickup(pos, kind) {
  kind = kind || (Math.random() < 0.4 ? 'repair' : Math.random() < 0.5 ? 'shield' : 'weapon');
  const P = PICKUPS[kind];
  const mat = new THREE.MeshStandardMaterial({ color: 0x060a18, emissive: P.color, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 });
  const group = new THREE.Group();
  if (kind === 'repair') {
    const a = new THREE.Mesh(pickupGeo.repair, mat);
    const b = new THREE.Mesh(pickupGeo.repair, mat);
    b.rotation.z = Math.PI / 2;
    group.add(a, b);
  } else {
    group.add(new THREE.Mesh(pickupGeo[kind], mat));
  }
  const m = new THREE.SpriteMaterial({ map: texGlow, color: P.color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glow = new THREE.Sprite(m);
  glow.scale.set(2.4, 2.4, 1);
  group.add(glow);
  group.position.copy(pos);
  scene.add(group);
  pickups.push({ kind, group, mat, t: Math.random() * 6, life: 20, alive: true });
}

function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.alive) continue;
    p.t += dt;
    p.life -= dt;
    p.group.rotation.y += 2.2 * dt;
    p.group.rotation.x += 0.8 * dt;
    const d = tmpV.copy(ship.group.position).sub(p.group.position);
    const dist = d.length();
    if (dist < 10) p.group.position.addScaledVector(d.normalize(), 13 * dt);   // magnet
    else p.group.position.z += 3 * dt;
    if (dist < 2.4 && state === 'playing') { collectPickup(p); continue; }
    if (p.life <= 0 || p.group.position.z > 40) { p.alive = false; scene.remove(p.group); p.mat.dispose(); }
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (!pickups[i].alive) pickups.splice(i, 1);
}

function collectPickup(p) {
  p.alive = false;
  scene.remove(p.group);
  p.mat.dispose();
  AudioFX.pickup();
  burst(p.group.position, [PICKUPS[p.kind].color, 0xffffff], { speed: 4, dur: 0.6, size: 0.4 });
  if (p.kind === 'repair') { lives = Math.min(5, lives + 1); popup('+1 LIFE', p.group.position, '#7dff9e'); }
  if (p.kind === 'shield') { shieldTimer = 6; popup('SHIELD', p.group.position, '#7cf7ff'); }
  if (p.kind === 'weapon') { weaponTimer = 8; popup('TRIPLE SHOT', p.group.position, '#c9a6ff'); }
}

/* ---------------- score & popups ---------------- */

const popupPool = [];
for (let i = 0; i < 14; i++) {
  const d = document.createElement('div');
  ui.popups.appendChild(d);
  popupPool.push({ el: d, life: 0, pos: new THREE.Vector3() });
}
function popup(text, worldPos, color) {
  const p = popupPool.reduce((a, b) => (a.life < b.life ? a : b));
  p.el.textContent = text;
  p.el.style.color = color || '#aef6ff';
  p.pos.copy(worldPos);
  p.life = 1;
}
const projV = new THREE.Vector3();
function updatePopups(dt) {
  for (const p of popupPool) {
    if (p.life <= 0) continue;
    p.life -= dt * 1.05;
    if (p.life <= 0) { p.el.style.opacity = 0; continue; }
    projV.copy(p.pos).project(camera);
    p.el.style.left = (projV.x * 0.5 + 0.5) * innerWidth + 'px';
    p.el.style.top = (-projV.y * 0.5 + 0.5) * innerHeight + 'px';
    p.el.style.opacity = Math.min(1, p.life * 2);
    p.el.style.transform = `translate(-50%,-50%) translateY(${(1 - p.life) * -46}px)`;
  }
}

function addScore(base, pos, color) {
  const mult = 1 + comboChain * 0.25;
  const pts = Math.round(base * mult);
  score += pts;
  if (pos) popup('+' + pts, pos, color);
}

/* ---------------- waves ---------------- */

function waveComposition(n) {
  if (n % 5 === 0) return { list: ['boss'], asteroids: Math.min(3 + n, 8) };
  const counts = {
    weaver: 3 + Math.min(n, 6),
    sniper: Math.min(1 + Math.floor(n / 2), 5),
    tank: Math.min(Math.floor(n / 3), 4),
    swarm: Math.min(n, 10),
  };
  const list = [];
  for (const [type, c] of Object.entries(counts)) for (let i = 0; i < c; i++) list.push(type);
  // shuffle
  for (let i = list.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { list: list.slice(0, 18), asteroids: Math.min(2 + n, 9) };
}

function startWave(n) {
  wave = n;
  const comp = waveComposition(n);
  waveQueue = comp.list;
  asteroidsQuota = comp.asteroids;
  asteroidTimer = 2.0;
  spawnTimer = 0.8;
  waveClearTimer = -1;
  bannerShow('WAVE ' + n, n % 5 === 0 ? '⚠ DREADNOUGHT DETECTED ⚠' : '');
  AudioFX.wave();
}

let bannerHide = 0;
function bannerShow(text, sub) {
  ui.bannerText.textContent = text;
  ui.bannerSub.textContent = sub;
  ui.banner.classList.remove('hidden');
  for (const el of [ui.bannerText, ui.bannerSub]) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
  bannerHide = elapsed + 2.35;
}

/* ---------------- player damage ---------------- */

function playerHit() {
  if (state !== 'playing') return;
  if (shieldTimer > 0) {
    burst(ship.group.position, [0x7cf7ff, 0xffffff], { speed: 4, dur: 0.4, size: 0.35 });
    AudioFX.ui();
    return;
  }
  if (invulnTimer > 0) return;
  lives--;
  invulnTimer = 1.15;
  comboChain = 0;
  shake = Math.min(shake + 0.9, 1.5);
  AudioFX.hit();
  ui.hitflash.style.transition = 'none';
  ui.hitflash.style.opacity = 1;
  requestAnimationFrame(() => {
    ui.hitflash.style.transition = 'opacity .5s ease';
    ui.hitflash.style.opacity = 0;
  });
  if (lives <= 0) gameOver();
}

/* ---------------- game flow ---------------- */

function clearEntities() {
  for (const e of enemies) { e.alive = false; scene.remove(e.group); if (e.mat) e.mat.dispose(); }
  enemies.length = 0;
  for (const a of asteroids) { a.alive = false; scene.remove(a.mesh); a.geo.dispose(); }
  asteroids.length = 0;
  for (const b of playerBolts) { b.alive = false; b.mesh.visible = false; }
  for (const b of enemyBolts) { b.alive = false; b.mesh.visible = false; }
  for (const p of pickups) { p.alive = false; scene.remove(p.group); p.mat.dispose(); }
  pickups.length = 0;
  for (const b of bursts) { b.life = 0; b.points.visible = false; }
  for (const f of flashes) { f.life = 0; f.light.visible = false; }
  for (const t of trails) { t.life = 0; t.sprite.visible = false; }
  waveQueue = [];
  ui.bossBar.classList.add('hidden');
  ui.bossLabel.classList.add('hidden');
}

function resetGame() {
  clearEntities();
  score = 0; lives = 3; comboChain = 0; comboTimer = 0;
  weaponTimer = 0; shieldTimer = 0; invulnTimer = 0;
  fireCooldown = 0; shake = 0; bossIndex = 0;
  shipTarget.x = 0; shipTarget.y = 0;
  ship.group.position.set(0, 0, 0);
  ship.group.rotation.set(0, 0, 0);
  ship.group.visible = true;
  shieldMesh.visible = false;
  startWave(1);
  state = 'playing';
}

function startGame() {
  AudioFX.init();
  AudioFX.resume();
  ui.menu.classList.add('hidden');
  ui.gameover.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  resetGame();
}

function gameOver() {
  state = 'gameover';
  firing = false;
  ship.group.visible = false;
  shieldMesh.visible = false;
  const p = ship.group.position.clone();
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      if (state !== 'gameover') return;
      burst(p, [0x59d9ff, 0xffffff, 0xff7b2f], { speed: 9 + i * 3, dur: 1.1 });
      flash(p, 0x59d9ff, 8);
      AudioFX.boom(1.5);
      shake = 1.4;
    }, i * 260);
  }
  const isRecord = score > high;
  if (isRecord) {
    high = score;
    try { localStorage.setItem('nebula-strike-high', String(high)); } catch (e) {}
  }
  setTimeout(() => {
    ui.finalScore.textContent = score.toLocaleString();
    ui.finalHigh.textContent = high.toLocaleString();
    ui.menuHigh.textContent = high.toLocaleString();
    ui.newRecord.classList.toggle('hidden', !isRecord);
    ui.gameover.classList.remove('hidden');
  }, 900);
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    ui.pause.classList.remove('hidden');
  } else if (state === 'paused') {
    state = 'playing';
    ui.pause.classList.add('hidden');
  }
}

function toggleMute() {
  AudioFX.setMuted(!muted);
  applyMuteIcon();
}

/* ---------------- input ---------------- */

addEventListener('pointermove', e => {
  if (state !== 'playing') return;
  shipTarget.x = (e.clientX / innerWidth * 2 - 1) * BOUNDS.x;
  shipTarget.y = -(e.clientY / innerHeight * 2 - 1) * BOUNDS.y;
  if (e.pointerType === 'touch') firing = true;
});
renderer.domElement.addEventListener('pointerdown', e => {
  AudioFX.init(); AudioFX.resume();
  if (state !== 'playing') return;
  firing = true;
  if (e.pointerType !== 'touch') {
    shipTarget.x = (e.clientX / innerWidth * 2 - 1) * BOUNDS.x;
    shipTarget.y = -(e.clientY / innerHeight * 2 - 1) * BOUNDS.y;
  }
});
addEventListener('pointerup', () => { firing = false; });
addEventListener('pointercancel', () => { firing = false; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

addEventListener('keydown', e => {
  AudioFX.init(); AudioFX.resume();
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'playing') firing = true;
  }
  if (e.repeat) return;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter') {
    if (state === 'menu') { ui.startBtn.blur(); startGame(); }
    else if (state === 'gameover') { ui.restartBtn.blur(); startGame(); }
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Space') firing = false;
});

ui.startBtn.addEventListener('click', () => { ui.startBtn.blur(); startGame(); });
ui.restartBtn.addEventListener('click', () => { ui.restartBtn.blur(); startGame(); });
ui.muteBtn.addEventListener('click', () => { ui.muteBtn.blur(); toggleMute(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') togglePause();
});

/* ---------------- HUD ---------------- */

function updateHUD() {
  ui.score.textContent = String(score).padStart(7, '0');
  ui.waveLabel.textContent = 'WAVE ' + wave;
  ui.hearts.textContent = '♥'.repeat(Math.max(0, lives)) || '—';
  if (comboChain >= 2) ui.combo.textContent = `COMBO ×${comboChain} — ×${(1 + comboChain * 0.25).toFixed(2)} SCORE`;
  else ui.combo.textContent = '';
  let t = '';
  if (weaponTimer > 0) t += '⚡ TRIPLE ' + weaponTimer.toFixed(1) + 's   ';
  if (shieldTimer > 0) t += '🛡 SHIELD ' + shieldTimer.toFixed(1) + 's';
  ui.timers.textContent = t;
}

/* ---------------- main loop ---------------- */

const tmpV = new THREE.Vector3();
const camLook = new THREE.Vector3(0, 0, -40);
let last = performance.now();
let hudScoreCache = -1;

function firePlayer() {
  ship.group.updateMatrixWorld(true);
  const muzzle = ship.group.localToWorld(new THREE.Vector3(0.55 * fireSide, -0.06, -2.1));
  const dir = tmpV.set(0, 0, -1);
  spawnBolt(playerBolts, boltGeoP, boltMatP, 95, muzzle, dir);
  fireSide = -fireSide;
  if (weaponTimer > 0) {
    for (const off of [-0.55, 0.55]) {
      const m2 = ship.group.localToWorld(new THREE.Vector3(off * 1.6, -0.06, -1.8));
      const d2 = tmpV.set(off * 0.28, 0, -1).normalize();
      spawnBolt(playerBolts, boltGeoP, boltMatP, 95, m2, d2);
    }
  }
  AudioFX.pew();
}

function tick(now) {
  requestAnimationFrame(tick);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (state === 'paused') { composer.render(); return; }
  elapsed += dt;

  /* --- ship control --- */
  if (state === 'playing') {
    const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const ky = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    if (kx || ky) {
      shipTarget.x = THREE.MathUtils.clamp(shipTarget.x + kx * 46 * dt, -BOUNDS.x, BOUNDS.x);
      shipTarget.y = THREE.MathUtils.clamp(shipTarget.y + ky * 46 * dt, -BOUNDS.y, BOUNDS.y);
    }
    const k = 1 - Math.exp(-9 * dt);
    ship.group.position.x += (shipTarget.x - ship.group.position.x) * k;
    ship.group.position.y += (shipTarget.y - ship.group.position.y) * k;
    ship.group.position.z = Math.sin(elapsed * 1.7) * 0.35;
    ship.group.rotation.z = THREE.MathUtils.clamp((shipTarget.x - ship.group.position.x) * -0.09, -0.7, 0.7);
    ship.group.rotation.x = THREE.MathUtils.clamp((shipTarget.y - ship.group.position.y) * 0.05, -0.35, 0.35);
    ship.group.rotation.y = THREE.MathUtils.clamp((shipTarget.x - ship.group.position.x) * -0.03, -0.3, 0.3);

    // firing
    fireCooldown -= dt;
    if (firing && fireCooldown <= 0) {
      firePlayer();
      fireCooldown = weaponTimer > 0 ? 0.19 : 0.165;
    }

    // invuln blink
    invulnTimer = Math.max(0, invulnTimer - dt);
    if (invulnTimer > 0) ship.group.visible = Math.floor(elapsed * 18) % 2 === 0;
    else ship.group.visible = true;

    // timers
    weaponTimer = Math.max(0, weaponTimer - dt);
    shieldTimer = Math.max(0, shieldTimer - dt);
    shieldMesh.visible = shieldTimer > 0;
    if (shieldTimer > 0) {
      shieldMesh.position.copy(ship.group.position);
      shieldMesh.rotation.y += dt;
      const s = 1 + 0.04 * Math.sin(elapsed * 10);
      shieldMesh.scale.setScalar(s);
    }
    comboTimer -= dt;
    if (comboTimer <= 0) comboChain = 0;

    /* --- spawning --- */
    if (waveQueue.length && spawnTimer <= 0 && enemies.filter(e => e.alive).length < 9) {
      const t = waveQueue.shift();
      if (t === 'boss') enemies.push(new Boss());
      else spawnEnemy(t);
      spawnTimer = THREE.MathUtils.clamp(1.4 - wave * 0.05, 0.55, 1.4);
    }
    spawnTimer -= dt;
    if (asteroidsQuota > 0 && asteroidTimer <= 0) {
      spawnAsteroid();
      asteroidsQuota--;
      asteroidTimer = 2.2 + Math.random() * 1.2;
    }
    asteroidTimer -= dt;

    if (!waveQueue.length && !enemies.some(e => e.alive)) {
      if (waveClearTimer < 0) waveClearTimer = 2.6;
      else {
        waveClearTimer -= dt;
        if (waveClearTimer <= 0) {
          score += 300 + wave * 120;
          startWave(wave + 1);
        }
      }
    }
  } else if (state === 'menu') {
    ship.group.position.x = Math.sin(elapsed * 0.6) * 1.6;
    ship.group.position.y = Math.cos(elapsed * 0.8) * 0.9;
    ship.group.position.z = 0;
    ship.group.rotation.z = Math.sin(elapsed * 0.6) * 0.18;
    ship.group.rotation.y = Math.sin(elapsed * 0.45) * 0.25;
    ship.group.visible = true;
  }

  /* --- engine glow & trail --- */
  const flick = 0.9 + 0.18 * Math.sin(elapsed * 40) + Math.random() * 0.1;
  for (const g of ship.glows) {
    const base = g === ship.glows[0] ? 1 : 0.55;
    g.scale.set(2.6 * base * flick, 2.6 * base * flick, 1);
  }
  trailTimer -= dt;
  if (trailTimer <= 0 && ship.group.visible) { spawnTrail(); trailTimer = 0.038; }
  updateTrails(dt);

  /* --- entities --- */
  for (const e of enemies) if (e.alive) e.update(dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);

  for (const b of playerBolts) {
    if (!b.alive) continue;
    b.mesh.position.addScaledVector(b.vel, dt);
    if (b.mesh.position.z < -300 || Math.abs(b.mesh.position.x) > 120) { b.alive = false; b.mesh.visible = false; }
  }
  for (const b of enemyBolts) {
    if (!b.alive) continue;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life += dt;
    if (b.life > 7 || b.mesh.position.z > 42) { b.alive = false; b.mesh.visible = false; b.life = 0; }
  }

  for (const a of asteroids) if (a.alive) a.update(dt);
  for (let i = asteroids.length - 1; i >= 0; i--) if (!asteroids[i].alive) asteroids.splice(i, 1);
  updatePickups(dt);

  /* --- collisions --- */
  if (state === 'playing') {
    for (const b of playerBolts) {
      if (!b.alive) continue;
      for (const e of enemies) {
        if (!e.alive) continue;
        const rr = e.r + 0.4;
        if (b.mesh.position.distanceToSquared(e.group.position) < rr * rr) {
          b.alive = false; b.mesh.visible = false;
          burst(b.mesh.position, [0xffffff, 0x9ff8ff], { speed: 3, dur: 0.3, size: 0.3 });
          e.hit(1);
          break;
        }
      }
      if (!b.alive) continue;
      for (const a of asteroids) {
        if (!a.alive) continue;
        if (b.mesh.position.distanceToSquared(a.mesh.position) < a.r * a.r) {
          b.alive = false; b.mesh.visible = false;
          burst(b.mesh.position, rockPalette, { speed: 3, dur: 0.3, size: 0.3 });
          a.hit(1);
          break;
        }
      }
    }
    for (const b of enemyBolts) {
      if (!b.alive) continue;
      if (b.mesh.position.distanceToSquared(ship.group.position) < 2.6) {
        b.alive = false; b.mesh.visible = false;
        playerHit();
      }
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      const rr = e.r + 1.6;
      if (e.group.position.distanceToSquared(ship.group.position) < rr * rr) {
        playerHit();
        e.die(false);
      }
    }
    for (const a of asteroids) {
      if (!a.alive) continue;
      const rr = a.r + 1.5;
      if (a.mesh.position.distanceToSquared(ship.group.position) < rr * rr) {
        playerHit();
        a.hit(2);
      }
    }
  }

  /* --- fx --- */
  for (const b of bursts) b.update(dt);
  for (const f of flashes) f.update(dt);
  for (const d of drifters) { d.mat.rotation += d.spin * dt; }

  starFar.rotation.z += 0.0035 * dt * 10;
  starNear.rotation.z += 0.006 * dt * 10;
  starFar.material.opacity = 0.85 + 0.1 * Math.sin(elapsed * 2.2);

  /* --- camera --- */
  const shipPos = ship.group.position;
  const bx = shipPos.x * 0.2, by = 3.4 + shipPos.y * 0.15;
  const ck = 1 - Math.exp(-5 * dt);
  camera.position.x += (bx - camera.position.x) * ck;
  camera.position.y += (by - camera.position.y) * ck;
  if (state === 'menu') {
    camera.position.x = Math.sin(elapsed * 0.15) * 7;
    camera.position.y = 3.4 + Math.sin(elapsed * 0.2) * 1.2;
  }
  shake *= Math.exp(-5.5 * dt);
  camera.position.x += (Math.random() - 0.5) * shake * 0.55;
  camera.position.y += (Math.random() - 0.5) * shake * 0.55;
  camLook.set(shipPos.x * 0.4, shipPos.y * 0.55, -40);
  camera.lookAt(camLook);

  /* --- UI --- */
  if (score !== hudScoreCache) { updateHUD(); hudScoreCache = score; }
  updateHUD();
  updatePopups(dt);
  if (bannerHide > 0 && elapsed > bannerHide) ui.banner.classList.add('hidden');

  composer.render();
}

/* ---------------- boot ---------------- */

updateHUD();
requestAnimationFrame(t => { last = t; tick(t); });
