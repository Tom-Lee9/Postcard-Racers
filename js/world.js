// Noosa: track shape, terrain, sea, clouds, palms, plants and props.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/RGBELoader.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const TRACK_Y = 0.5, HALF_W = 7;
const nTmp = { i: 0, lat: 0, d: 0 };
const gh = (track, x, z) => track.groundH(x, z, track.nearest(x, z, false, nTmp));   // ground height anywhere

// ---------- small maths helpers ----------
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, z, oct = 4) { let s = 0, a = 0.5, f = 1; for (let k = 0; k < oct; k++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s; }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;     // repeatable random, same world every load
const rr = (a, b) => a + (b - a) * rand();

// ---------- the land ----------
// x = east, z = south. Tom's My Maps route at 1/6 scale (origin = the surf club start line).
// Ocean to the east (Sunshine Beach), the national park headland bulges out past Lions Rock, Laguna Bay to the north.
const eastShore = z => 14 + 2 * Math.sin(z * 0.03) + 62 * ss(-150, -195, z) * ss(-470, -330, z);
const northShore = x => -448 + 4 * Math.sin(x * 0.02);
export const seaDist = (x, z) => Math.max(x - eastShore(z), northShore(x) - z);   // + = out to sea
function natural(x, z) {
  const d = seaDist(x, z);
  let h = d > 0 ? -d * 0.06 - Math.max(0, d - 40) * 0.1 : Math.min(0.45, -d * 0.03);
  h += ss(-30, -70, d) * (1.5 + 2.5 * (fbm(x * 0.011, z * 0.011) + 0.5));   // dunes behind the beach
  h += ss(-60, -220, d) * (6 + 10 * (fbm(x * 0.004 + 7, z * 0.004) + 0.5)); // green hills inland (kept under the clouds)
  return h;
}
// track surfaces that don't flatten the ground around them (you can fall off these)
const FLOATING = { cloud: 1, gap: 1 };

// ---------- the track ----------
// [x, z, height, surface, half width]. Racing order; the start/finish line is the first point.
const CTRL = [
  [0, 0, 0.5, 'sand', 7], [3, -18, 0.5, 'sand', 7],
  [12, -36, -1, 'under', 7], [30, -52, -4, 'under', 7], [44, -78, -4.5, 'under', 7], [47, -116, -4.5, 'under', 7], [37, -144, -1.5, 'under', 7], // underwater along the coast
  [31, -160, 1.5, 'rock', 6], [41, -175, 8, 'rock', 6], [45, -190, 14, 'rock', 6],                    // up Lions Rock and the stairs
  [47, -198, 15, 'gap', 6], [50, -209, 15, 'gap', 6],                                                  // launch: fly straight over the gap...
  [52.5, -219, 17, 'cloud', 10], [58, -240, 18.5, 'cloud', 9], [63, -262, 20, 'cloud', 8], [40, -284, 21.5, 'cloud', 7], [-12, -284, 22, 'cloud', 7], [-70, -290, 23, 'cloud', 7], [-112, -308, 24, 'cloud', 7],
  [-150, -345, 22, 'cloud', 7], [-185, -385, 18, 'cloud', 7], [-218, -408, 10, 'cloud', 7],          // ...race on the clouds
  [-247, -428, 2.5, 'road', 7], [-275, -404, 2, 'road', 7], [-305, -366, 2, 'road', 7],               // Noosa Heads: boosts + ramps
  [-336, -332, 2, 'road', 7], [-356, -318, 2, 'road', 7], [-362, -298, 2.5, 'road', 7], [-386, -268, 3, 'road', 7],
  [-391, -164, 4, 'road', 7], [-326, -109, 5, 'road', 7], [-292, -101, 5, 'road', 8],
  [-243, -104, 5, 'road', 13],                                                                         // Noosa Junction roundabout
  [-205, -86, 5, 'road', 8], [-176, -68, 5, 'dirt', 7], [-160, -75, 4.5, 'dirt', 7],                 // bush trail
  [-131, -76, 4, 'creek', 7], [-112, -72, 4.5, 'dirt', 7], [-88, -67, 5.5, 'dirt', 7],
  [-74, -66, 8, 'road', 7], [-58, -50, 12, 'road', 7], [-52, -38, 12.5, 'road', 7],                  // up the hill...
  [-45, -24, 10, 'gap', 7], [-38, -9, 7, 'gap', 7],                                                    // ...jump over the rooftops
  [-30, 5, 4.5, 'road', 7], [-19, 14, 1.5, 'sand', 7], [-4, 22, 0.5, 'sand', 7],                     // down to the beach + finish
];

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z, y]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
    this.length = curve.getLength();
    const N = this.N = Math.round(this.length / 1.5);
    const pts = curve.getSpacedPoints(N);
    this.ds = this.length / N;
    this.p = []; this.t = []; this.r = []; this.surf = []; this.curv = []; this.dist = []; this.th = []; this.w = [];
    for (let i = 0; i < N; i++) { this.p.push(new THREE.Vector2(pts[i].x, pts[i].z)); this.th.push(pts[i].y); }
    // surface + width from the nearest control point (width smoothed so the roundabout opens out gradually)
    const raw = [];
    for (let i = 0; i < N; i++) {
      let best = 1e18, c = CTRL[0];
      for (const k of CTRL) { const d = (k[0] - this.p[i].x) ** 2 + (k[1] - this.p[i].y) ** 2; if (d < best) { best = d; c = k; } }
      this.surf.push(c[3]); raw.push(c[4]);
    }
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -15; k <= 15; k++) s += raw[(i + k + N) % N]; this.w.push(s / 31); }
    for (let i = 0; i < N; i++) {
      const a = this.p[(i - 1 + N) % N], b = this.p[(i + 1) % N];
      const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
      this.t.push(t); this.r.push(new THREE.Vector2(-t.y, t.x));
      this.dist.push(i * this.ds);
    }
    for (let i = 0; i < N; i++) {                              // signed curvature, + = left turn
      const a = this.t[(i - 2 + N) % N], b = this.t[(i + 2) % N];
      this.curv.push((a.y * b.x - a.x * b.y) / (4 * this.ds));
    }
    // spatial grid of samples (20 m cells) for fast nearest-point lookups
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = Math.floor(this.p[i].x / 20) + ',' + Math.floor(this.p[i].y / 20);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    }
    const f = (x, z, len, h, halfW, lat = 0, kind = 'ramp') => this.feature(x, z, len, h, halfW, lat, kind);
    this.ramps = [
      f(45, -190, 7, 2.6, 6, 0, 'launch'),                    // blue launch off Lions Rock
      f(-290, -384, 8, 1.4, 3, -3), f(-322, -346, 8, 1.4, 3, 3),                     // Noosa Heads
      f(-170, -71, 2.4, 0.55, 7, 0, 'log'), f(-150, -77, 2.4, 0.55, 7, 0, 'log'), f(-100, -70, 2.4, 0.55, 7, 0, 'log'),  // bush logs
      f(-53, -40, 7, 1.6, 6, 0, 'launch'),                    // rooftop jump
    ];
    this.boosts = [
      f(33, -164, 5, 0, 2.5, -2), f(39, -174, 5, 0, 2.5, 2), f(43, -184, 4, 0, 2.5, 0),   // up the rock + stairs
      f(-262, -417, 6, 0, 2.2, 2), f(-312, -358, 6, 0, 2.2, -2),                          // Noosa Heads
      f(-250, -110, 6, 0, 2.2, 9), f(-232, -99, 6, 0, 2.2, 9),                            // roundabout: outside line
      f(-375, -230, 6, 0, 2.2, 0),
    ];
    this.ramps[0].vy = 13; this.ramps[6].vy = 9;           // launch ramps kick you up this fast (m/s)
    this.island = { x: -243, z: -104, r: 6 };                // roundabout island (grass, slows you down)
    this.surfClub = { x: -14, z: -16 };
    this._n = { i: 0, lat: 0, d: 0 };
    this._g = { h: 0, surf: 'road', i: 0, lat: 0, boost: false, ramp: false };
  }
  feature(x, z, len, h, halfW, lat = 0, kind = 'ramp') {
    const i = this.nearestScan(x, z), r = this.r[i];
    return { i, p: new THREE.Vector2(this.p[i].x + r.x * lat, this.p[i].y + r.y * lat), t: this.t[i], r, len, h, halfW, lat, kind };
  }
  nearestScan(x, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.N; i++) { const p = this.p[i], d = (x - p.x) ** 2 + (z - p.y) ** 2; if (d < best) { best = d; bi = i; } }
    return bi;
  }
  // nearest sample + sideways offset (lat, + = right of the racing direction). Far away: exact only if `far`.
  nearest(x, z, far = true, out = this._n) {
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    let best = 1e18, bi = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const cell = this.grid.get((cx + a) + ',' + (cz + b)); if (!cell) continue;
      for (const i of cell) { const p = this.p[i], d = (x - p.x) ** 2 + (z - p.y) ** 2; if (d < best) { best = d; bi = i; } }
    }
    if (bi < 0 || best > 400) {
      if (!far) { out.i = -1; out.lat = 1e9; out.d = 1e9; return out; }
      bi = this.nearestScan(x, z);
    }
    const p = this.p[bi], r = this.r[bi];
    out.i = bi; out.lat = (x - p.x) * r.x + (z - p.y) * r.y; out.d = Math.abs(out.lat);
    return out;
  }
  // natural ground, flattened to the track's height near it
  groundH(x, z, n) {
    if (n.i < 0 || FLOATING[this.surf[n.i]]) return natural(x, z);
    const base = this.th[n.i] - 0.05, w = this.w[n.i];
    return base + (natural(x, z) - base) * ss(w + 1.5, w + 11, n.d);
  }
  // local frame of a feature (ramp / boost pad): along = metres forward from its start, lat = sideways
  local(f, x, z) {
    const dx = x - f.p.x, dz = z - f.p.y;
    return [dx * f.t.x + dz * f.t.y, dx * f.r.x + dz * f.r.y];
  }
  // everything the kart needs to know about the ground under a point
  ground(x, z, out = this._g) {
    const n = this.nearest(x, z), s = this.surf[n.i], on = n.d < this.w[n.i];
    let h = s === 'cloud' && on ? this.th[n.i] : this.groundH(x, z, n);
    out.ramp = false; out.launch = 0;
    for (const R of this.ramps) {
      const [ra, rl] = this.local(R, x, z);
      if (ra > 0 && ra < R.len && Math.abs(rl) < R.halfW) { out.ramp = true; out.launch = R.vy || 0; h = this.th[R.i] + R.h * ra / R.len; }
    }
    out.boost = false;
    for (const b of this.boosts) { const [a, l] = this.local(b, x, z); if (a > 0 && a < b.len && Math.abs(l) < b.halfW) out.boost = true; }
    let surf = on && s !== 'gap' ? s : h < -0.05 ? 'water' : 'off';
    const I = this.island, di = Math.hypot(x - I.x, z - I.z);
    if (di < I.r) { surf = 'off'; h += 0.35 * ss(I.r, I.r - 2, di); }
    out.h = h; out.i = n.i; out.lat = n.lat; out.surf = out.ramp ? (s === 'gap' ? 'road' : s) : surf;
    return out;
  }
  // place an object on the track: local -z = racing direction, +x = right
  place(obj, i, lat = 0, y = this.th[i]) {
    const p = this.p[i], r = this.r[i], t = this.t[i];
    obj.position.set(p.x + r.x * lat, y, p.y + r.y * lat);
    obj.rotation.y = Math.atan2(-t.x, -t.y);
    return obj;
  }
  // contiguous runs of sample indices where pred(i) is true (with one sample of overlap each end)
  runs(pred) {
    const N = this.N, out = [];
    let s0 = 0; while (s0 < N && pred(s0)) s0++;
    if (s0 === N) return [[...Array(N + 1).keys()].map(i => i % N)];
    let cur = null;
    for (let k = 1; k <= N; k++) {
      const i = (s0 + k) % N;
      if (pred(i)) { if (!cur) cur = [(i - 1 + N) % N]; cur.push(i); }
      else if (cur) { cur.push(i); out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  }
  // ribbon between two sideways offsets (numbers, or functions of the sample index) at track height + yOff
  strip(idx, latA, latB, yOff, vScale) {
    const L = (v, i) => typeof v === 'function' ? v(i) : v;
    const pos = [], uv = [], ind = [];
    let v = 0;
    idx.forEach((i, k) => {
      if (k > 0) v += this.p[i].distanceTo(this.p[idx[k - 1]]) / vScale;
      let a = L(latA, i), b = L(latB, i); if (a > b) [a, b] = [b, a];
      const p = this.p[i], r = this.r[i], y = this.th[i] + yOff;
      pos.push(p.x + r.x * a, y, p.y + r.y * a, p.x + r.x * b, y, p.y + r.y * b);
      uv.push(0, v, 1, v);
      if (k > 0) { const q = (k - 1) * 2; ind.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  }
}

// ---------- canvas textures (things too simple to need a photo texture) ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const frondTex = () => canvasTex(128, 512, (g, w, h) => {
  g.lineCap = 'round';
  for (let y = 20; y < h - 4; y += 7) {                  // leaflets, longest in the middle of the frond
    const t = y / h, len = 60 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 6;
    for (const s of [-1, 1]) {
      const sh = 70 + rand() * 40;
      g.strokeStyle = `rgb(${40 + sh * 0.3 | 0},${sh + 40 | 0},${25 + rand() * 20 | 0})`;
      g.lineWidth = 5 + rand() * 2;
      g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * len * 0.5, y - 6, w / 2 + s * len, y - 18 - rand() * 8); g.stroke();
    }
  }
  g.strokeStyle = '#6b6a2a'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
});
const stripeTex = (a, b, n = 2, horiz = false) => canvasTex(64, 64, (g, w, h) => {
  for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? b : a; horiz ? g.fillRect(k * w / n, 0, w / n, h) : g.fillRect(0, k * h / n, w, h / n); }
});
const checkerTex = (cols, rows) => canvasTex(cols * 32, rows * 32, (g) => {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; g.fillRect(i * 32, j * 32, 32, 32); }
});

// ---------- loading ----------
export async function loadAssets(renderer, onProgress) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tl = new THREE.TextureLoader(), gl = new GLTFLoader();
  let done = 0, total = 0;
  const track = p => { total++; return p.then(v => { onProgress(++done / total); return v; }); };
  const tex = (f, srgb = false) => track(tl.loadAsync('assets/tex/' + f).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }));
  const set = (names) => Promise.all([tex(names + '_diff.jpg', true), tex(names + '_nor.jpg'), tex(names + '_rough.jpg')]);
  const [sand, wetsand, asphalt, bark, grass, waterNormals, sky, fern, shrub] = await Promise.all([
    set('sand'), set('wetsand'), set('asphalt'),
    Promise.all([tex('bark_diff.jpg', true), tex('bark_nor.jpg')]),
    tex('grass_diff.jpg', true), tex('waternormals.jpg'),
    track(new RGBELoader().loadAsync('assets/tex/sky.hdr')),
    track(gl.loadAsync('assets/models/fern_02/fern_02.gltf')),
    track(gl.loadAsync('assets/models/shrub_02/shrub_02.gltf')),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  return { sand, wetsand, asphalt, bark, grass, waterNormals, sky, fern, shrub };
}

// brightest pixel of the sky = the sun. Also the average colour at the horizon (for fog).
function readSky(sky) {
  const { data, width: W, height: H } = sky.image;
  const f = THREE.DataUtils.fromHalfFloat;
  let best = -1, br = 0, bc = 0;
  for (let r = 0; r < H / 2; r += 2) for (let c = 0; c < W; c += 2) {
    const k = (r * W + c) * 4, l = f(data[k]) + f(data[k + 1]) + f(data[k + 2]);
    if (l > best) { best = l; br = r; bc = c; }
  }
  const dir = (r, c) => {
    const u = (c + 0.5) / W, v = 1 - (r + 0.5) / H, phi = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
    return new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
  };
  const sun = dir(br, bc);
  if (sun.y < 0.25) { sun.y = 0.6; sun.normalize(); }         // keep shadows sensible if the scan misfires
  const fog = new THREE.Color(0, 0, 0), row = Math.floor(H * 0.48);
  for (let c = 0; c < W; c += 4) { const k = (row * W + c) * 4; fog.r += f(data[k]); fog.g += f(data[k + 1]); fog.b += f(data[k + 2]); }
  fog.multiplyScalar(4 / W);
  return { sun, fog };
}

// ---------- build everything ----------
export function buildWorld(scene, renderer, A, Q) {
  const track = new Track();

  // sky + lighting from the photo sky (HDRI)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(A.sky).texture;
  scene.background = A.sky;
  const { sun, fog } = readSky(A.sky);
  scene.fog = new THREE.Fog(fog, 300, 1500);
  const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sunLight.position.copy(sun).multiplyScalar(150);
  scene.add(sunLight, sunLight.target);
  if (Q.shadow) {
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(Q.shadow, Q.shadow);
    const c = sunLight.shadow.camera; c.left = c.bottom = -45; c.right = c.top = 45; c.near = 1; c.far = 400;
    sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.04;
  }

  scene.add(buildTerrain(track, A, Q));
  scene.add(buildSea(track, A, sun));
  buildTrackSurface(scene, track, A);
  const props = buildProps(scene, track);
  buildNoosaProps(scene, track);
  buildPalms(scene, track, A, Q);
  buildPlants(scene, track, A, Q);

  const skyBg = scene.background, skyFog = scene.fog, waterFog = new THREE.Fog(0x0d6a7e, 1, 70), waterBg = new THREE.Color(0x0d6a7e);
  return {
    track, sunLight, sun, props,
    update(dt, t, focus) {
      const under = focus && focus.y + 1.1 < -0.15;                // camera below the sea surface: murky blue
      scene.fog = under ? waterFog : skyFog; scene.background = under ? waterBg : skyBg;
      if (focus) {                                            // shadow box follows the player
        sunLight.target.position.copy(focus);
        sunLight.position.copy(focus).addScaledVector(sun, 150);
      }
      props.update(dt, t);
      seaMat.uniforms.uTime.value = t;
    },
  };
}
let seaMat = null;
const CX = -180, CZ = -200;                  // middle of the map (terrain + sea are centred here)

function buildTerrain(track, A, Q) {
  const W = 720, D = 640, sx = Math.round(160 * Q.seg), sz = Math.round(140 * Q.seg);
  const geo = new THREE.PlaneGeometry(W, D, sx, sz);
  geo.rotateX(-Math.PI / 2); geo.translate(CX, 0, CZ);
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3), mix = new Float32Array(n * 2);
  const nb = { i: 0, lat: 0, d: 0 };
  for (let v = 0; v < n; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    const near = track.nearest(x, z, false, nb);
    const h = track.groundH(x, z, near);
    pos.setY(v, h);
    const dShore = seaDist(x, z);
    const hills = ss(-60, -200, dShore), dunes = ss(-30, -70, dShore);
    let grass = Math.min(1, hills * 1.1 + dunes * ss(0.05, 0.35, fbm(x * 0.02, z * 0.02 + 3, 3)));
    const tw = near.i >= 0 ? track.w[near.i] : HALF_W, ts = near.i >= 0 ? track.surf[near.i] : '';
    if (!FLOATING[ts]) grass *= ss(tw + 1, tw + 9, near.d);  // keep the track edge sandy...
    if (ts === 'road' || ts === 'dirt' || ts === 'rock') grass = Math.max(grass, 0.9 * ss(tw + 7, tw + 4, near.d) * ss(tw + 0.5, tw + 2, near.d)); // ...except a grass verge
    mix[v * 2] = grass;
    mix[v * 2 + 1] = ss(-9, 0.5, dShore);                       // wet sand near and under the water
    const b = 0.88 + 0.18 * fbm(x * 0.03, z * 0.03, 3);        // big soft light/dark patches so tiling doesn't show
    col[v * 3] = b; col[v * 3 + 1] = b; col[v * 3 + 2] = b * 0.98;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('mixes', new THREE.BufferAttribute(mix, 2));
  geo.computeVertexNormals();
  const [map, nor, rough] = A.sand;
  for (const t of [map, nor, rough]) t.repeat.set(W / 6, D / 6);
  A.grass.repeat.set(W / 6, D / 6);
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nor, roughnessMap: rough, vertexColors: true });
  mat.normalScale.set(0.8, 0.8);
  mat.onBeforeCompile = sh => {
    sh.uniforms.grassMap = { value: A.grass };
    sh.vertexShader = 'attribute vec2 mixes;\nvarying vec2 vMix;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvMix = mixes;');
    sh.fragmentShader = 'uniform sampler2D grassMap;\nvarying vec2 vMix;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 grassC = texture2D(grassMap, vMapUv * 0.73).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, grassC, vMix.x);
        diffuseColor.rgb *= mix(1.0, 0.6, vMix.y * (1.0 - vMix.x));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.45, vMix.y * (1.0 - vMix.x));`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// the sea: see-through turquoise in the shallows, deep blue further out, sky reflections, sun glints and foam
function buildSea(track, A, sun) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uNormals: { value: null }, uSky: { value: null }, uSun: { value: new THREE.Vector3() },
  }]);
  uniforms.uNormals.value = A.waterNormals; uniforms.uSky.value = A.sky; uniforms.uSun.value.copy(sun);
  seaMat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      attribute float depth;
      uniform float uTime;
      varying float vDepth; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        float a = 0.05 * smoothstep(0.0, 3.0, depth) + 0.015;
        p.y += a * (sin(p.x * 0.08 + uTime * 1.3) + sin(p.z * 0.11 + p.x * 0.03 - uTime * 0.9));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz; vDepth = depth;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform sampler2D uNormals; uniform sampler2D uSky; uniform vec3 uSun;
      varying float vDepth; varying vec3 vWorld;
      vec3 nrm(vec2 uv) { return texture2D(uNormals, uv).rgb * 2.0 - 1.0; }
      void main() {
        vec2 uv = vWorld.xz;
        vec3 n1 = nrm(uv * 0.035 + vec2(uTime * 0.012, uTime * 0.008));
        vec3 n2 = nrm(uv * 0.09 - vec2(uTime * 0.02, -uTime * 0.015));
        vec3 n = normalize(vec3(n1.x + n2.x, 2.4, n1.y + n2.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        vec3 sky = min(texture2D(uSky, equirectUv(R)).rgb, vec3(3.0));
        float deep = 1.0 - exp(-vDepth * 0.3);
        vec3 body = mix(vec3(0.22, 0.88, 0.8), vec3(0.02, 0.24, 0.42), deep) * (0.65 + 0.5 * uSun.y);
        vec3 col = mix(body, sky * 0.8, fres * 0.65);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, uSun), 0.0), 400.0) * 8.0;
        float roll = 0.5 + 0.5 * sin(vDepth * 9.0 - uTime * 2.2 + n1.x * 4.0);
        float foam = max(smoothstep(0.7, 0.0, vDepth) * roll * 0.85, smoothstep(0.1, 0.0, vDepth));
        float breakLine = 1.2 + 0.3 * sin(uTime * 0.5 + vWorld.z * 0.02);
        foam = max(foam, smoothstep(0.3, 0.0, abs(vDepth - breakLine)) * (0.5 + 0.5 * n2.x) * 0.75);
        col = mix(col, vec3(0.93, 0.96, 0.96), clamp(foam, 0.0, 1.0));
        float alpha = max(0.45 + 0.55 * smoothstep(0.0, 2.5, vDepth), foam);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(720, 640, 120, 106); geo.rotateX(-Math.PI / 2); geo.translate(CX, 0, CZ);
  const pos = geo.attributes.position, depth = new Float32Array(pos.count), nb = { i: 0, lat: 0, d: 0 };
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    depth[v] = Math.max(0, -track.groundH(x, z, track.nearest(x, z, false, nb)));
  }
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  const near = new THREE.Mesh(geo, seaMat); near.renderOrder = 1;
  const far = new THREE.PlaneGeometry(14000, 14000); far.rotateX(-Math.PI / 2);
  far.setAttribute('depth', new THREE.BufferAttribute(new Float32Array(far.attributes.position.count).fill(40), 1));
  const farMesh = new THREE.Mesh(far, seaMat); farMesh.position.y = -0.6;
  g.add(farMesh, near);
  return g;
}

function buildTrackSurface(scene, track, A) {
  const off = (m, k) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k });
  const std = o => new THREE.MeshStandardMaterial(o);
  const [am, an, ar] = A.asphalt;
  for (const t of [am, an, ar]) t.repeat.set(2, 2);
  const road = off(std({ map: am, normalMap: an, roughnessMap: ar }), 2);
  const rock = off(std({ map: am, normalMap: an, roughnessMap: ar, color: 0xc2a27c }), 2);       // Lions Rock: warm sandstone
  // packed wet sand / dirt, fading into the ground at the edges
  const [wm, wn, wr] = A.wetsand;
  for (const t of [wm, wn, wr]) t.repeat.set(3, 3);
  const fade = canvasTex(64, 4, (g, w) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#000'); gr.addColorStop(0.22, '#fff'); gr.addColorStop(0.78, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, 4); }, false);
  fade.wrapT = THREE.RepeatWrapping;
  const soft = color => off(std({ map: wm, normalMap: wn, roughnessMap: wr, alphaMap: fade, transparent: true, depthWrite: false, color }), 2);
  const sandRoad = soft(0xb9a68c), dirt = soft(0x7d5a3a);
  const seabed = off(std({ map: wm, normalMap: wn, roughnessMap: wr, color: 0xe2d2a8 }), 2);
  const cloudT = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#eef3fa'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 40; k++) { const x = rand() * w, y = rand() * h, r = 8 + rand() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  });
  cloudT.wrapS = cloudT.wrapT = THREE.RepeatWrapping;
  const cloud = std({ map: cloudT, roughness: 1, emissive: 0x9fb4cc, emissiveIntensity: 0.15 });
  const creek = off(std({ color: 0x3f93b5, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 }), 3);
  const white = off(std({ color: 0xf0f0ee, roughness: 0.6 }), 4);
  const kerbT = stripeTex('#d42a1e', '#f4f4f4'); kerbT.wrapT = THREE.RepeatWrapping;
  const kerb = off(std({ map: kerbT, roughness: 0.55 }), 5);

  const add = (geos, mat, shadow = true) => {
    if (!geos.length) return {};
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = shadow; scene.add(m); return m;
  };
  const W = i => track.w[i], is = k => i => track.surf[i] === k;
  const band = (k, mat, extra = 0, y = 0, v = 14) => add(track.runs(is(k)).map(r => track.strip(r, i => -W(i) - extra, i => W(i) + extra, y, v)), mat);
  band('road', road); band('rock', rock); band('under', seabed); band('cloud', cloud);
  band('sand', sandRoad, 2, 0.004, 18).renderOrder = 0.5;
  band('dirt', dirt, 2, 0.004, 18).renderOrder = 0.5;
  band('creek', creek, 1.5, 0.05);
  // white edge lines on the road, red/white kerbs on the corners
  const isRoad = is('road');
  const kerbed = i => isRoad(i) && Math.abs(track.curv[(i + 6) % track.N]) + Math.abs(track.curv[(i - 6 + track.N) % track.N]) > 0.022;
  const lines = [], kerbs = [];
  for (const r of track.runs(i => isRoad(i) && !kerbed(i))) for (const s of [-1, 1]) lines.push(track.strip(r, i => s * (W(i) - 0.45), i => s * (W(i) - 0.25), 0.01, 1));
  for (const r of track.runs(kerbed)) for (const s of [-1, 1]) kerbs.push(track.strip(r, i => s * (W(i) - 1.0), i => s * (W(i) + 0.3), 0.02, 3));
  add(lines, white); add(kerbs, kerb);
}

// ---------- props: start gantry, boost pads, ramp, signs, surf club, umbrellas, flags ----------
function buildProps(scene, track) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const shadowed = m => { m.castShadow = true; m.receiveShadow = true; return m; };

  // start / finish line + gantry
  const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * track.w[0], 2.4).rotateX(-Math.PI / 2),
    std({ map: checkerTex(12, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  track.place(line, 0, 0, track.th[0] + 0.015); line.receiveShadow = true; scene.add(line);
  const gantry = track.place(new THREE.Group(), 0);
  const pillarM = std({ color: 0x1f6fb2, roughness: 0.4, metalness: 0.3 });
  for (const s of [-1, 1]) gantry.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), pillarM).translateX(s * (HALF_W + 0.9)).translateY(3.2)));
  const banner = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 64; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); g.fillRect(i * 16, h - 32 + j * 16, 16, 16); }
    g.fillStyle = '#e8532a'; g.font = '900 62px Trebuchet MS, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POSTCARD RACERS  •  NOOSA', w / 2, h / 2 + 2);
  });
  gantry.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W + 2.5, 1.5, 0.35), [pillarM, pillarM, pillarM, pillarM, std({ map: banner, roughness: 0.5 }), std({ map: banner, roughness: 0.5 })]).translateY(5.9)));
  scene.add(gantry);

  // boost pads: glowing chevrons that flow forward
  const chevT = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#ff7a00'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff6a0'; g.lineWidth = 16; g.lineJoin = 'round';
    for (const y of [40, 104]) { g.beginPath(); g.moveTo(14, y + 22); g.lineTo(64, y - 22); g.lineTo(114, y + 22); g.stroke(); }
  });
  chevT.wrapT = THREE.RepeatWrapping; chevT.repeat.set(1, 3);
  const padM = new THREE.MeshBasicMaterial({ map: chevT, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  for (const b of track.boosts) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2 * b.halfW, b.len).rotateX(-Math.PI / 2).translate(0, 0, -b.len / 2), padM);
    track.place(pad, b.i, b.lat, track.th[b.i] + 0.04); pad.rotation.order = 'YXZ';
    pad.rotation.x = Math.atan2(track.th[(b.i + Math.round(b.len / track.ds)) % track.N] - track.th[b.i], b.len);   // tilt up slopes
    scene.add(pad);
  }

  // wooden jump ramp
  const plank = canvasTex(256, 512, (g, cw, ch) => {
    for (let y = 0; y < ch; y += 32) { const s = 150 + rand() * 40; g.fillStyle = `rgb(${s},${s * 0.68 | 0},${s * 0.4 | 0})`; g.fillRect(0, y, cw, 30); g.fillStyle = '#4a2e18'; g.fillRect(0, y + 30, cw, 2); }
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 18, ch); g.fillRect(cw - 18, 0, 18, ch);
  });
  const logM = std({ color: 0x6b4a2e, roughness: 0.9 }), moundM = std({ color: 0x5e4630, roughness: 1 }), plankM = std({ map: plank, roughness: 0.8, side: THREE.DoubleSide });
  for (const R of track.ramps) {
  const w = R.halfW, L = R.len, H = R.h;
  const rp = [-w, 0, 0, w, 0, 0, w, H, -L, -w, 0, 0, w, H, -L, -w, H, -L,   // top
    -w, H, -L, w, H, -L, w, 0, -L, -w, H, -L, w, 0, -L, -w, 0, -L,          // back face
    -w, 0, 0, -w, H, -L, -w, 0, -L, w, 0, 0, w, 0, -L, w, H, -L];           // sides
  const ruv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0.1, 0, 0, 1, 0.1, 0, 0.1, 0, 0, 1, 0.1, 1, 0, 0, 0, 1, 0, 1, 0.1];
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rg.computeVertexNormals();
  const rm = shadowed(track.place(new THREE.Mesh(rg, R.kind === 'log' ? moundM : plankM), R.i, R.lat));
  if (R.kind === 'log') rm.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2 * w + 1, 10).rotateZ(Math.PI / 2), logM)).translateY(H - 0.1).translateZ(-L));
  scene.add(rm);
  }

  // red/white marker posts along the edges of the beach section
  const postT = stripeTex('#d42a1e', '#f4f4f4', 4);
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.2, 8).translate(0, 0.6, 0);
  const postSpots = [];
  for (let i = 0; i < track.N; i += 5) if (track.surf[i] === 'sand' || track.surf[i] === 'dirt')
    for (const s of [-1, 1]) postSpots.push(track.place(new THREE.Object3D(), i, s * (track.w[i] + 1.7), track.th[i] - 0.05).position.clone());
  const posts = new THREE.InstancedMesh(postGeo, std({ map: postT, roughness: 0.6 }), postSpots.length);
  postSpots.forEach((p, k) => posts.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  posts.castShadow = true; scene.add(posts);

  // red/white chevron boards on the outside of the sharpest corners
  const chevBoard = canvasTex(256, 128, (g, cw, ch) => {
    g.fillStyle = '#d42a1e'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#fff';
    for (const x of [40, 120, 200]) { g.beginPath(); g.moveTo(x + 28, 14); g.lineTo(x - 22, ch / 2); g.lineTo(x + 28, ch - 14); g.lineTo(x + 48, ch - 14); g.lineTo(x - 2, ch / 2); g.lineTo(x + 48, 14); g.fill(); }
  });
  const boardM = std({ map: chevBoard, roughness: 0.5 }), postM = std({ color: 0x777777, roughness: 0.5, metalness: 0.6 });
  const peaks = [];
  for (let i = 0; i < track.N; i++) {
    const c = Math.abs(track.curv[i]);
    if (c > 0.02 && !FLOATING[track.surf[i]] && track.surf[i] !== 'under' && peaks.every(p => Math.min(Math.abs(p - i), track.N - Math.abs(p - i)) > 40)) {
      let best = i; for (let k = i; k < i + 40; k++) if (Math.abs(track.curv[k % track.N]) > Math.abs(track.curv[best % track.N])) best = k;
      peaks.push(best % track.N);
    }
  }
  for (const pk of peaks) {
    const left = track.curv[pk] > 0;
    for (const k of [-14, -6, 2]) {
      const i = (pk + k + track.N) % track.N;
      const sign = track.place(new THREE.Group(), i, (left ? 1 : -1) * (track.w[i] + 3.5), 0);
      sign.position.y = gh(track, sign.position.x, sign.position.z);
      sign.rotateY(Math.PI);                                   // face the oncoming karts
      const b = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), boardM)); b.position.y = 1.6;
      if (!left) b.scale.x = -1;                                // arrows point into the turn
      b.material.side = THREE.DoubleSide;
      sign.add(b);
      for (const s of [-0.8, 0.8]) sign.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), postM).translateX(s).translateY(0.8).translateZ(-0.03));
      scene.add(sign);
    }
  }

  // Sunshine Beach surf club next to the start
  const club = new THREE.Group();
  const wall = canvasTex(512, 256, (g, cw, ch) => {
    g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#5f8fb0'; for (let x = 16; x < cw; x += 62) { g.fillRect(x, 26, 48, 74); g.fillRect(x, 148, 48, 74); }
    g.fillStyle = 'rgba(255,255,255,0.35)'; for (let x = 16; x < cw; x += 62) { g.fillRect(x + 4, 30, 12, 66); g.fillRect(x + 4, 152, 12, 66); }
    g.fillStyle = '#d8d4c8'; g.fillRect(0, 122, cw, 8);
  });
  const wallM = std({ map: wall, roughness: 0.7 }), plain = std({ color: 0xf3f1ea, roughness: 0.8 });
  club.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(11, 8, 26), [wallM, wallM, plain, plain, plain, plain]).translateY(4)));
  club.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 28), std({ color: 0x2a5d9f, roughness: 0.5 })).translateY(8.2)));
  const signT = canvasTex(512, 96, (g, cw, ch) => {
    g.fillStyle = '#ffd200'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#d6201f'; g.fillRect(0, 0, cw, ch / 2);
    g.font = '900 40px Arial'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText('SUNSHINE BEACH', cw / 2, 42); g.fillStyle = '#d6201f'; g.fillText('SURF CLUB', cw / 2, 88);
  });
  for (const s of [-1, 1]) { const sg = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), std({ map: signT, roughness: 0.5 })); sg.position.set(s * 5.56, 6.7, 0); sg.rotation.y = s * Math.PI / 2; club.add(sg); }
  const SC = track.surfClub; club.position.set(SC.x, gh(track, SC.x, SC.z) - 0.3, SC.z);
  scene.add(club);

  // beach umbrellas + towels between the beach track and the water, and red/yellow patrol flags
  const umbCols = [['#e8532a', '#fff'], ['#1b9aaa', '#fff'], ['#ffd23f', '#e8532a'], ['#3fae49', '#fff']];
  const umbM = umbCols.map(([a, b]) => std({ map: stripeTex(a, b, 8, true), roughness: 0.6, side: THREE.DoubleSide }));
  const poleM = std({ color: 0xeeeeee, roughness: 0.4 });
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 14; tries++) {
    const z = rr(-130, 40), x = eastShore(z) - rr(5, 12);
    const n = track.nearest(x, z);
    if (n.d < track.w[n.i] + 4) continue;
    const y = gh(track, x, z);
    const u = new THREE.Group(); u.position.set(x, y, z); u.rotation.set(rr(-0.15, 0.15), rr(0, 6.3), rr(-0.15, 0.15));
    u.add(shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.55, 16, 1, true), umbM[placed % 4]).translateY(2.3)));
    u.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), poleM).translateY(1.2));
    const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8).rotateX(-Math.PI / 2), umbM[(placed + 1) % 4]);
    towel.position.set(1.1, 0.03, 0.4); u.add(towel);
    scene.add(u); placed++;
  }
  const flagT = canvasTex(64, 64, (g) => { g.fillStyle = '#d6201f'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#ffd200'; g.fillRect(0, 32, 64, 32); });
  const flags = [];
  for (const z of [-22, 24]) {
    const x = eastShore(z) - 3, f = new THREE.Group(); f.position.set(x, gh(track, x, z), z);
    f.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3, 6), poleM).translateY(1.5));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.7).translate(0.5, 0, 0), std({ map: flagT, side: THREE.DoubleSide, roughness: 0.8 }));
    cloth.position.y = 2.6; f.add(cloth); flags.push(cloth); scene.add(f);
  }

  return {
    update(dt, t) {
      chevT.offset.y -= dt * 1.6;
      flags.forEach((c, k) => { c.rotation.y = 0.6 + Math.sin(t * 2.3 + k) * 0.35; });
    },
  };
}

// a random spot beside the track (not beside the clouds or under the sea)
function nearTrack(track, dMin, dMax) {
  for (;;) {
    const i = Math.floor(rand() * track.N), s = track.surf[i];
    if (FLOATING[s] || s === 'under') continue;
    const lat = (rand() < 0.5 ? -1 : 1) * (track.w[i] + rr(dMin, dMax)), p = track.p[i], r = track.r[i];
    return [p.x + r.x * lat, p.y + r.y * lat];
  }
}

// ---------- palm trees: textured trunks + canvas fronds, instanced ----------
function palmVariant(height, lean, fronds) {
  const pts = [];
  for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push(new THREE.Vector3(lean * t * t * height * 0.3, t * height, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 18, 0.24, 10, false);
  const p = trunk.attributes.position, uv = trunk.attributes.uv, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {                          // taper towards the top + bark runs around the trunk
    const t = Math.min(1, Math.max(0, p.getY(k) / height));
    curve.getPoint(t, c); v.fromBufferAttribute(p, k).sub(c).multiplyScalar(1.25 - 0.55 * t).add(c);
    p.setXYZ(k, v.x, v.y, v.z);
    const along = uv.getX(k), around = uv.getY(k);
    uv.setXY(k, around, along * height / 1.4);
  }
  trunk.computeVertexNormals();
  // one frond: a strip that arches out and droops, folded into a shallow V
  const fr = [], fuv = [], find = [], SEG = 8, L = 4.6, Wd = 2.1;
  for (let s = 0; s <= SEG; s++) {
    const t = s / SEG, y = 0.9 * t - 1.9 * t * t, z = L * t;
    for (const [k, x] of [[0, -Wd / 2], [0.5, 0], [1, Wd / 2]]) { fr.push(x, y + (x === 0 ? 0.12 : 0), z); fuv.push(k, 1 - t); }
    if (s) { const a = (s - 1) * 3; find.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(fr, 3)); base.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  base.setIndex(find); base.computeVertexNormals();
  const top = curve.getPoint(1), list = [];
  for (let k = 0; k < fronds; k++) {
    const g = base.clone();
    g.rotateX(-rr(0.05, 0.55)); g.rotateY(k / fronds * Math.PI * 2 + rr(-0.2, 0.2));
    g.scale(rr(0.8, 1.1), 1, rr(0.8, 1.1)); g.translate(top.x, top.y, top.z);
    list.push(g);
  }
  return { trunk, fronds: mergeGeometries(list) };
}
function buildPalms(scene, track, A, Q) {
  const [bm, bn] = A.bark;
  const barkM = new THREE.MeshStandardMaterial({ map: bm, normalMap: bn, roughness: 0.9 });
  const frondM = new THREE.MeshStandardMaterial({ map: frondTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const variants = [palmVariant(9, 1.2, 16), palmVariant(11, -0.8, 17), palmVariant(7.5, 2.0, 15)];
  const spots = [];
  // a row along both sides of the esplanade
  for (let i = 0; i < track.N; i += 9) if (track.surf[i] === 'road' && i > track.N * 0.4) for (const s of [-1, 1]) if (rand() < 0.6) spots.push(track.place(new THREE.Object3D(), i, s * (track.w[i] + rr(4, 6.5)), 0).position.clone());
  // clusters in the dunes and behind the beach
  for (let tries = 0; spots.length < Q.palms && tries < 4000; tries++) {
    const [x, z] = nearTrack(track, 7, 45), n = track.nearest(x, z);
    if (n.d < track.w[n.i] + 7 || seaDist(x, z) > -9) continue;
    spots.push(new THREE.Vector3(x, 0, z));
  }
  const per = variants.map(() => []);
  spots.slice(0, Q.palms).forEach((p, k) => per[k % 3].push(p));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  variants.forEach((v, vi) => {
    const tm = new THREE.InstancedMesh(v.trunk, barkM, per[vi].length), fm = new THREE.InstancedMesh(v.fronds, frondM, per[vi].length);
    per[vi].forEach((p, k) => {
      p.y = gh(track, p.x, p.z) - 0.1;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rr(0, 6.28)); const s = rr(0.8, 1.2); sc.set(s, s, s);
      m.compose(p, q, sc); tm.setMatrixAt(k, m); fm.setMatrixAt(k, m);
      fm.setColorAt(k, col.setHSL(rr(0.2, 0.3), rr(0.35, 0.6), rr(0.75, 1.0)));
    });
    tm.castShadow = fm.castShadow = !!Q.shadow; tm.receiveShadow = true;
    scene.add(tm, fm);
  });
}

// ---------- ferns + shrubs (Poly Haven scanned models), instanced ----------
function buildPlants(scene, track, A, Q) {
  const meshesOf = gltf => { const out = []; gltf.scene.traverse(o => o.isMesh && out.push(o)); return out.sort((a, b) => a.geometry.index.count - b.geometry.index.count); };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const scatter = (meshes, count, smin, smax, castShadow) => {
    const per = meshes.map(() => []);
    for (let tries = 0, n = 0; n < count && tries < count * 30; tries++) {
      const [x, z] = nearTrack(track, 3.5, 30), nb = track.nearest(x, z);
      if (nb.d < track.w[nb.i] + 3.5 || seaDist(x, z) > -10) continue;
      per[n % meshes.length].push([x, z, gh(track, x, z)]); n++;
    }
    meshes.forEach((mesh, k) => {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, per[k].length);
      per[k].forEach(([x, z, y], j) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rr(0, 6.28)); const s = rr(smin, smax);
        m.compose(p.set(x, y - 0.05, z), q, sc.set(s, s, s)); im.setMatrixAt(j, m);
      });
      im.castShadow = castShadow; im.receiveShadow = true;
      scene.add(im);
    });
  };
  scatter(meshesOf(A.fern), Q.ferns, 3.5, 6, false);
  scatter(meshesOf(A.shrub).slice(0, 2), Q.shrubs, 1.3, 2.2, Q.shadow >= 2048);
}

// ---------- Noosa set pieces: cloud puffs, roundabout island, koala signs, rooftop houses, Lions Rock boulders ----------
function buildNoosaProps(scene, track) {
  const std = o => new THREE.MeshStandardMaterial(o), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const spot = (i, lat, y) => { const p = track.p[i], r = track.r[i]; return v.set(p.x + r.x * lat, y, p.y + r.y * lat); };
  const instanced = (geo, mat, list, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = shadow; im.receiveShadow = true; scene.add(im); return im;
  };
  // fluffy cloud puffs along the edges and underneath the cloud road
  const puffs = [];
  const puff = (pos, s, flat = 0.55) => puffs.push(new THREE.Matrix4().compose(pos, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rr(0, 6.3)), sc.set(s, s * flat, s)));
  for (let i = 0; i < track.N; i++) {
    if (track.surf[i] !== 'cloud') continue;
    if (i % 3 === 0) for (const s of [-1, 1]) puff(spot(i, s * (track.w[i] + rr(0, 1.2)), track.th[i] - rr(0.2, 0.6)), rr(1.4, 2.6));
    if (i % 5 === 0) puff(spot(i, rr(-track.w[i], track.w[i]), track.th[i] - rr(1.6, 3.2)), rr(3, 5), 0.5);
  }
  instanced(new THREE.IcosahedronGeometry(1, 2), std({ color: 0xffffff, roughness: 1, emissive: 0xa8bbd2, emissiveIntensity: 0.2 }), puffs, false);

  // Noosa Junction roundabout island: grass mound, flower bed and a sign
  const I = track.island;
  const isl = new THREE.Group(); isl.position.set(I.x, track.th[track.nearestScan(I.x, I.z)] - 0.05, I.z);
  isl.add(new THREE.Mesh(new THREE.CylinderGeometry(I.r - 0.3, I.r + 0.3, 0.5, 32), std({ color: 0x4f8f3a, roughness: 0.9 })).translateY(0.2));
  isl.add(new THREE.Mesh(new THREE.TorusGeometry(I.r - 0.3, 0.25, 6, 32).rotateX(Math.PI / 2), std({ color: 0xdedbd2, roughness: 0.7 })).translateY(0.3));
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.6, 20), std({ color: 0xe8532a, roughness: 0.8 })); fl.position.y = 0.6; isl.add(fl);
  const nameT = canvasTex(512, 128, (g, w, h) => { g.fillStyle = '#1d5f3a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = '#fff'; g.font = '800 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NOOSA JUNCTION', w / 2, h / 2 + 2); });
  for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), std({ map: nameT, side: THREE.DoubleSide })); b.position.y = 2.2; b.rotation.y = r; isl.add(b); }
  isl.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2), std({ color: 0x888888 })).translateY(1));
  isl.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  scene.add(isl);

  // yellow koala-crossing signs along the bush trail
  const koalaT = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffd200'; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 6, h / 2); g.lineTo(w / 2, h - 6); g.lineTo(6, h / 2); g.closePath(); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#111'; g.stroke();
    g.fillStyle = '#111';                                          // koala: big head, round ears, nose
    for (const x of [92, 164]) { g.beginPath(); g.arc(x, 96, 24, 0, 7); g.fill(); }
    g.beginPath(); g.arc(128, 126, 40, 0, 7); g.fill();
    g.fillStyle = '#ffd200'; g.beginPath(); g.ellipse(128, 134, 10, 15, 0, 0, 7); g.fill();
    g.fillStyle = '#111'; g.font = '800 26px Arial'; g.textAlign = 'center'; g.fillText('KOALAS', 128, 196);
  });
  const koalaM = std({ map: koalaT, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), poleM = std({ color: 0x8a8a8a, metalness: 0.5, roughness: 0.5 });
  let lastSign = -99;
  for (let i = 0; i < track.N; i++) {
    if (track.surf[i] !== 'dirt' || i - lastSign < 22) continue;
    lastSign = i;
    const side = (i % 2 ? 1 : -1), g = track.place(new THREE.Group(), i, side * (track.w[i] + 3), 0);
    g.position.y = gh(track, g.position.x, g.position.z); g.rotateY(Math.PI);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2), poleM).translateY(1.1));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), koalaM).translateY(2.2).translateZ(0.06));
    scene.add(g);
  }

  // Sunshine Beach houses under the rooftop jump (and a few beside the hill road)
  const wallCols = [0xf4efe4, 0xdfe9ef, 0xf6e3c8, 0xe6efe0, 0xf0d9d4], roofCols = [0x8c3b2e, 0x3d5a73, 0x55606b];
  const house = (x, z, rot) => {
    const y = gh(track, x, z), g = new THREE.Group(); g.position.set(x, y - 0.2, z); g.rotation.y = rot;
    const W = rr(5, 7), D = rr(6, 8), H = rr(3, 4.2);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), std({ color: wallCols[Math.floor(rand() * 5)], roughness: 0.8 })).translateY(H / 2));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(W, D) / 2 + 0.4, 2, 4, 1).rotateY(Math.PI / 4), std({ color: roofCols[Math.floor(rand() * 3)], roughness: 0.6 }));
    roof.scale.set(W / Math.hypot(W, D) * 1.41, 1, D / Math.hypot(W, D) * 1.41); roof.position.y = H + 1; g.add(roof);
    g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    scene.add(g);
  };
  for (let i = 0; i < track.N; i++) {
    const s = track.surf[i];
    if (s === 'gap' && track.th[i] < 13 && i % 7 === 0) for (const lat of [-6, 1, 8]) { const p = spot(i, lat + rr(-1, 1), 0); house(p.x, p.z, Math.atan2(-track.t[i].x, -track.t[i].y) + rr(-0.2, 0.2)); }
    if (s === 'road' && track.th[i] > 6 && track.th[i] < 13 && i % 12 === 0) for (const side of [-1, 1]) { const p = spot(i, side * (track.w[i] + rr(10, 16)), 0); house(p.x, p.z, rr(0, 6.3)); }
  }

  // sandstone boulders around Lions Rock
  const rocks = [];
  for (let i = 0; i < track.N; i++) if (track.surf[i] === 'rock' && i % 2 === 0) for (const s of [-1, 1]) {
    const p = spot(i, s * (track.w[i] + rr(1, 9)), 0).clone(); p.y = gh(track, p.x, p.z) - 0.4; const k = rr(0.8, 2.6);
    rocks.push(new THREE.Matrix4().compose(p, q.setFromEuler(new THREE.Euler(rr(0, 3), rr(0, 3), rr(0, 3))), sc.set(k, k * 0.7, k)));
  }
  instanced(new THREE.DodecahedronGeometry(1, 0), std({ color: 0xa8875f, roughness: 0.95, flatShading: true }), rocks);
}
