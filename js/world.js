// Noosa (real map, half scale): track shape, terrain, sea, clouds, streets, houses, trees, barriers and props.
// Map data (c) OpenStreetMap contributors, ODbL.
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

// ---------- the land: real Noosa from OpenStreetMap (half scale; origin = Sunshine Beach surf club start) ----------
// x = east, z = south. assets/noosa-map.json holds a 5 m grid of distance-to-sea and land cover, plus roads + buildings.
let MAP = null;
export function setMap(m) {
  const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const { NX, NZ } = m, sea = new Int8Array(dec(m.sea).buffer), cover = dec(m.cover);
  // "hilliness": the national park (forest + rock) gets big hills, blurred so they don't stop dead at the forest edge
  let hill = new Float32Array(NX * NZ);
  for (let k = 0; k < NX * NZ; k++) hill[k] = cover[k] === m.codes.forest || cover[k] === m.codes.rock ? 1 : 0;
  const blur = (a, r) => {
    const b = new Float32Array(a.length), c = new Float32Array(a.length);
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < NX) { s += a[z * NX + xx]; n++; } } b[z * NX + x] = s / n; }
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const zz = z + d; if (zz >= 0 && zz < NZ) { s += b[zz * NX + x]; n++; } } c[z * NX + x] = s / n; }
    return c;
  };
  hill = blur(blur(hill, 6), 6);
  MAP = { ...m, sea, cover, hill };
}
export const mapInfo = () => MAP;
function bil(arr, x, z) {
  const { X0, Z0, C, NX, NZ } = MAP;
  const fx = Math.min(NX - 1.001, Math.max(0, (x - X0) / C - 0.5)), fz = Math.min(NZ - 1.001, Math.max(0, (z - Z0) / C - 0.5));
  const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k, a = k * NX + i;
  return (arr[a] * (1 - u) + arr[a + 1] * u) * (1 - v) + (arr[a + NX] * (1 - u) + arr[a + NX + 1] * u) * v;
}
export const seaDist = (x, z) => bil(MAP.sea, x, z);                       // + = out to sea (metres)
const shoreAt = z => { for (let x = -80; x < 300; x++) if (seaDist(x, z) > -4) return x; return 60; };   // where the beach meets the water
export function coverAt(x, z) {
  const { X0, Z0, C, NX, NZ } = MAP, i = Math.floor((x - X0) / C), k = Math.floor((z - Z0) / C);
  return i < 0 || k < 0 || i >= NX || k >= NZ ? 0 : MAP.cover[k * NX + i];
}
function natural(x, z) {
  const d = seaDist(x, z);
  let h = d > 0 ? -d * 0.06 - Math.max(0, d - 40) * 0.1 : Math.min(0.45, -d * 0.03);
  h += ss(-25, -60, d) * (1.5 + 2.5 * (fbm(x * 0.011, z * 0.011) + 0.5));             // dunes behind the beach
  const inland = ss(-40, -160, d);
  h += inland * (3 + 7 * (fbm(x * 0.004 + 7, z * 0.004) + 0.5));                      // rolling suburbs
  h += inland * bil(MAP.hill, x, z) * (6 + 20 * (fbm(x * 0.006 + 3, z * 0.006 + 9) + 0.5));   // national park hills (under the clouds)
  h += 20 * ss(180, 30, Math.hypot(x + 1160, z + 700));                               // Noosa Hill (Noosa Drive goes over it)
  return h;
}
// track surfaces that don't flatten the ground around them
const FLOATING = { cloud: 1, gap: 1 };

// ---------- the track ----------
// [x, z, height (null = follow the ground), surface, half width]. Racing order; the start/finish line is the first point.
// Tom's My Maps route at half scale.
const CTRL = [
  [0, 0, 0.6, 'sand', 10], [9, -54, 0.6, 'sand', 10],
  [36, -108, -1.5, 'under', 10], [90, -156, -5, 'under', 10], [123, -234, -6, 'under', 10], [141, -348, -6, 'under', 10], [111, -432, -2, 'under', 10],   // underwater along the coast
  [93, -480, 2, 'rock', 8], [123, -525, 13, 'rock', 8], [135, -570, 24, 'rock', 8],                                          // boost up Lions Rock + the stairs
  [138, -582, 25, 'gap', 8], [143, -600, 26, 'gap', 8],                                                                      // launch straight over the gap...
  [147, -616, 28, 'cloud', 18], [158, -658, 32, 'cloud', 17], [171, -705, 36, 'cloud', 16], [135, -765, 44, 'cloud', 16],   // ...up into the clouds
  [60, -800, 52, 'cloud', 16], [-30, -815, 58, 'cloud', 16], [-120, -860, 62, 'cloud', 16], [-190, -930, 64, 'cloud', 16],
  [-280, -960, 64, 'cloud', 16], [-370, -1010, 62, 'cloud', 16], [-450, -1080, 60, 'cloud', 16], [-530, -1130, 55, 'cloud', 16],
  [-610, -1190, 40, 'cloud', 15], [-680, -1250, 18, 'cloud', 14],                                                          // slide down to Noosa Heads
  [-746, -1277, null, 'road', 10], [-777, -1260, null, 'road', 10], [-787, -1224, null, 'road', 10], [-792, -1189, null, 'road', 10], [-824, -1158, null, 'road', 10], [-851, -1136, null, 'road', 10], [-886, -1125, null, 'road', 10], [-918, -1115, null, 'road', 10], [-935, -1081, null, 'road', 10],   // Park Road
  [-958, -1054, null, 'road', 8, 'hastings'], [-989, -1018, null, 'road', 8, 'hastings'], [-1010, -990, null, 'road', 8, 'hastings'], [-1056, -993, null, 'road', 8, 'hastings'], [-1082, -992, null, 'road', 8, 'hastings'],   // Hastings Street
  [-1079, -958, null, 'road', 10, 'deus'], [-1075, -925, null, 'road', 10], [-1083, -890, null, 'road', 10], [-1105, -853, null, 'road', 10], [-1149, -818, null, 'road', 10], [-1166, -785, null, 'road', 10], [-1164, -718, null, 'road', 10], [-1162, -686, null, 'road', 10], [-1158, -654, null, 'road', 10], [-1156, -604, null, 'road', 10], [-1155, -563, null, 'road', 10], [-1161, -528, null, 'road', 10],   // Noosa Drive, over the hill
  [-1172, -498, null, 'road', 10, 'junction'], [-1154, -468, null, 'road', 10, 'junction'], [-1127, -438, null, 'road', 10, 'junction'], [-1098, -404, null, 'road', 10, 'junction'], [-1075, -379, null, 'road', 10, 'junction'],   // Noosa Junction: turn left
  [-1035, -361, null, 'road', 11], [-1004, -341, null, 'road', 11], [-979, -321, null, 'road', 11], [-953, -316, null, 'road', 11], [-911, -305, null, 'road', 11], [-836, -309, null, 'road', 11], [-764, -314, null, 'road', 11],   // Sunshine Beach Road
  [-729, -312, null, 'road', 22],                                                                                            // roundabout
  [-615, -258, null, 'road', 11], [-528, -204, null, 'dirt', 10], [-480, -225, null, 'dirt', 10],                          // bush trail
  [-393, -228, null, 'creek', 10], [-336, -216, null, 'dirt', 10], [-264, -201, null, 'dirt', 10],
  [-222, -206, null, 'road', 10], [-185, -160, 16, 'road', 10], [-162, -122, 18, 'road', 10],                              // up the hill
  [-150, -100, 15, 'road', 10], [-135, -72, 12, 'road', 10],                                                                 // ...and down it
  [-120, -42, 8, 'road', 10], [-100, -2, 5, 'road', 10], [-81, 30, 3, 'road', 10], [-57, 40, 1.4, 'sand', 10], [-10, 70, 0.6, 'sand', 10],   // down to the beach + finish
];

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z, y]) => new THREE.Vector3(x, y ?? Math.max(1, natural(x, z) + 0.3), z)), true, 'centripetal');
    this.length = curve.getLength();
    const N = this.N = Math.round(this.length / 1.5);
    const pts = curve.getSpacedPoints(N);
    this.ds = this.length / N;
    this.p = []; this.t = []; this.r = []; this.surf = []; this.curv = []; this.dist = []; this.th = []; this.w = []; this.zone = [];
    for (let i = 0; i < N; i++) { this.p.push(new THREE.Vector2(pts[i].x, pts[i].z)); this.th.push(pts[i].y); }
    // surface + width from the nearest control point (width smoothed so the roundabout opens out gradually)
    const raw = [];
    for (let i = 0; i < N; i++) {
      let best = 1e18, c = CTRL[0];
      for (const k of CTRL) { const d = (k[0] - this.p[i].x) ** 2 + (k[1] - this.p[i].y) ** 2; if (d < best) { best = d; c = k; } }
      this.surf.push(c[3]); raw.push(c[4]); this.zone.push(c[5] || '');
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
      f(135, -570, 8, 3, 8, 0, 'launch'),                     // blue launch off Lions Rock
      f(-870, -1152, 9, 1.5, 3.5, -4), f(-966, -1040, 9, 1.5, 3.5, 4),                  // Noosa Heads
    ];
    this.boosts = [
      f(99, -492, 6, 0, 3, -3), f(117, -515, 6, 0, 3, 3), f(129, -548, 5, 0, 3, 0),     // up the rock + stairs
      f(-786, -1251, 7, 0, 2.5, 3), f(-936, -1080, 7, 0, 2.5, -3), f(-1170, -560, 7, 0, 2.5, 0),   // Noosa Heads
      f(-760, -326, 7, 0, 2.5, 15), f(-700, -300, 7, 0, 2.5, 15),                         // roundabout: outside line
      f(-560, -228, 7, 0, 2.5, 0),
    ];
    // launch ramps kick you up (vy) and forward (vf) this fast, in m/s, so every speed class makes the jump
    Object.assign(this.ramps[0], { vy: 16, vf: 34 });
    this.island = { x: -729, z: -312, r: 10 };               // roundabout island (grass, slows you down)
    this.surfClub = { x: -40, z: -18 };
    this._n = { i: 0, lat: 0, d: 0 };
    this._g = { h: 0, surf: 'road', i: 0, lat: 0, boost: false, ramp: false };
  }
  // where the barrier is, sideways from the centre line (none over the gaps you jump)
  wall(i) { const s = this.surf[i]; return s === 'gap' ? 1e9 : this.w[i] + (s === 'cloud' ? 0.6 : 1.2); }
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
    const t = this.t[bi], N = this.N, along = (x - p.x) * t.x + (z - p.y) * t.y;
    out.th = this.th[bi] + along * (this.th[(bi + 1) % N] - this.th[(bi - 1 + N) % N]) / (2 * this.ds);   // height blended between samples
    return out;
  }
  // natural ground, flattened to the track's height near it
  groundH(x, z, n) {
    if (n.i < 0 || FLOATING[this.surf[n.i]]) return natural(x, z);
    const base = n.th - 0.05, w = this.w[n.i];
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
    let h = s === 'cloud' && on ? n.th : this.groundH(x, z, n);
    out.ramp = false; out.launch = 0;
    for (const R of this.ramps) {
      const [ra, rl] = this.local(R, x, z);
      if (ra > 0 && ra < R.len && Math.abs(rl) < R.halfW) { out.ramp = true; out.launch = R.vy || 0; out.launchV = R.vf || 0; h = n.th + R.h * ra / R.len; }
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
  const [map, sand, wetsand, asphalt, bark, grass, waterNormals, sky, fern, shrub] = await Promise.all([
    track(fetch('assets/noosa-map.json?v=8').then(r => r.json())),
    set('sand'), set('wetsand'), set('asphalt'),
    Promise.all([tex('bark_diff.jpg', true), tex('bark_nor.jpg')]),
    tex('grass_diff.jpg', true), tex('waternormals.jpg'),
    track(new RGBELoader().loadAsync('assets/tex/sky.hdr')),
    track(gl.loadAsync('assets/models/fern_02/fern_02.gltf')),
    track(gl.loadAsync('assets/models/shrub_02/shrub_02.gltf')),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  setMap(map);
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
  scene.fog = new THREE.Fog(fog, 160, 750);             // also hides far-off chunks so the phone draws less
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
  buildCity(scene, track, A, Q);
  buildGums(scene, track, Q);
  buildBarriers(scene, track);
  buildStreets(scene, track, Q);
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

function buildTerrain(track, A, Q) {
  const M = mapInfo(), W = M.NX * M.C, D = M.NZ * M.C, CX = M.X0 + W / 2, CZ = M.Z0 + D / 2, res = Q.seg >= 1 ? 6 : Q.seg >= 0.8 ? 8 : 11;
  const sx = Math.round(W / res), sz = Math.round(D / res), CO = M.codes;
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
    // real land cover: national park = dark bush floor, suburbs + parks = grass, beaches = sand, rock = sandstone
    const c = coverAt(x, z);
    if (c === CO.beach || dShore > -10) grass *= 0.0; else if (c === CO.rock) grass *= 0.15; else if (c === CO.forest) grass = Math.max(grass, 0.95 * ss(-12, -30, dShore)); else if (dShore < -35) grass = Math.max(grass, ss(-35, -60, dShore));
    mix[v * 2] = grass;
    mix[v * 2 + 1] = ss(-9, 0.5, dShore);                       // wet sand near and under the water
    const b = 0.88 + 0.18 * fbm(x * 0.03, z * 0.03, 3);        // big soft light/dark patches so tiling doesn't show
    const t = c === CO.forest ? [0.36, 0.52, 0.26] : c === CO.rock ? [0.85, 0.72, 0.58] : grass > 0.5 ? [0.66, 0.86, 0.5] : [1, 1, 0.97];   // strong greens: the grass texture washes out to beige in bright sun
    col[v * 3] = b * t[0]; col[v * 3 + 1] = b * t[1]; col[v * 3 + 2] = b * t[2];
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
  const M = mapInfo(), W = M.NX * M.C, D = M.NZ * M.C;
  const geo = new THREE.PlaneGeometry(W, D, Math.round(W / 12), Math.round(D / 12)); geo.rotateX(-Math.PI / 2); geo.translate(M.X0 + W / 2, 0, M.Z0 + D / 2);
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
    g.fillStyle = '#d3def0'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 40; k++) { const x = rand() * w, y = rand() * h, r = 8 + rand() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  });
  { const g = cloudT.image.getContext('2d'); g.fillStyle = '#ffcf40'; g.fillRect(60, 8, 8, 52); cloudT.needsUpdate = true; }   // gold dashed centre line
  cloudT.wrapS = cloudT.wrapT = THREE.RepeatWrapping;
  const cloud = std({ map: cloudT, color: 0xc4cfde, roughness: 1, transparent: true, opacity: 0.38, depthWrite: false });   // mostly see-through: the national park shows below
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
  for (const s of [-1, 1]) gantry.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), pillarM).translateX(s * (track.w[0] + 1.6)).translateY(3.2)));
  const banner = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 64; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); g.fillRect(i * 16, h - 32 + j * 16, 16, 16); }
    g.fillStyle = '#e8532a'; g.font = '900 62px Trebuchet MS, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POSTCARD RACERS  •  NOOSA', w / 2, h / 2 + 2);
  });
  gantry.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * track.w[0] + 3.9, 1.5, 0.35), [pillarM, pillarM, pillarM, pillarM, std({ map: banner, roughness: 0.5 }), std({ map: banner, roughness: 0.5 })]).translateY(5.9)));
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
  rm.rotation.order = 'YXZ'; rm.rotation.x = Math.atan2(track.th[(R.i + Math.round(R.len / track.ds)) % track.N] - track.th[R.i], R.len);   // follow the slope
  if (R.kind === 'log') rm.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2 * w + 1, 10).rotateZ(Math.PI / 2), logM)).translateY(H - 0.1).translateZ(-L));
  scene.add(rm);
  }

  // red/white marker posts along the edges of the beach section
  const postT = stripeTex('#d42a1e', '#f4f4f4', 4);
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.2, 8).translate(0, 0.6, 0);
  const postSpots = [];
  for (let i = 0; i < 0; i += 5)
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
    const z = rr(-140, 60), x = shoreAt(z) - rr(5, 14);
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
    const x = shoreAt(z) - 3, f = new THREE.Group(); f.position.set(x, gh(track, x, z), z);
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
    if (i % 3 === 0) for (const s of [-1, 1]) puff(spot(i, s * (track.w[i] + rr(0.5, 2.5)), track.th[i] - rr(0.3, 1)), rr(2, 3.6));
    if (i % 7 === 0) for (const s of [-1, 1]) puff(spot(i, s * (track.w[i] + rr(8, 30)), track.th[i] - rr(9, 16)), rr(6, 12), 0.6);   // below the road, so you look out over them
  }
  instanced(new THREE.IcosahedronGeometry(1, 2), std({ color: 0xffffff, roughness: 1, emissive: 0xa8bbd2, emissiveIntensity: 0.2, transparent: true, opacity: 0.6, depthWrite: false }), puffs, false);

  // Noosa Junction roundabout island: grass mound, flower bed and a sign
  const I = track.island;
  const isl = new THREE.Group(); isl.position.set(I.x, track.th[track.nearestScan(I.x, I.z)] - 0.05, I.z);
  isl.add(new THREE.Mesh(new THREE.CylinderGeometry(I.r - 0.3, I.r + 0.3, 0.5, 32), std({ color: 0x4f8f3a, roughness: 0.9 })).translateY(0.2));
  isl.add(new THREE.Mesh(new THREE.TorusGeometry(I.r - 0.3, 0.25, 6, 32).rotateX(Math.PI / 2), std({ color: 0xdedbd2, roughness: 0.7 })).translateY(0.3));
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.6, 20), std({ color: 0xe8532a, roughness: 0.8 })); fl.position.y = 0.6; isl.add(fl);
  const nameT = canvasTex(512, 128, (g, w, h) => { g.fillStyle = '#1d5f3a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = '#fff'; g.font = '800 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SUNSHINE BEACH', w / 2, h / 2 + 2); });
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
  }

  // sandstone boulders around Lions Rock
  const rocks = [];
  for (let i = 0; i < track.N; i++) if (track.surf[i] === 'rock' && i % 2 === 0) for (const s of [-1, 1]) {
    const p = spot(i, s * (track.w[i] + rr(1, 9)), 0).clone(); p.y = gh(track, p.x, p.z) - 0.4; const k = rr(0.8, 2.6);
    rocks.push(new THREE.Matrix4().compose(p, q.setFromEuler(new THREE.Euler(rr(0, 3), rr(0, 3), rr(0, 3))), sc.set(k, k * 0.7, k)));
  }
  instanced(new THREE.DodecahedronGeometry(1, 0), std({ color: 0xa8875f, roughness: 0.95, flatShading: true }), rocks);
}

// ---------- real Noosa from OpenStreetMap: streets, buildings, houses along the streets ----------
// Everything is merged into ~300 m chunks so the phone only draws the chunks in front of you.
function chunked(scene, mat, parts) {
  const byChunk = new Map();
  for (const { geo, x, z } of parts) { const k = Math.floor(x / 300) + ',' + Math.floor(z / 300); if (!byChunk.has(k)) byChunk.set(k, []); byChunk.get(k).push(geo); }
  for (const list of byChunk.values()) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; scene.add(m); }
}
function paint(geo, c) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.index) return geo.toNonIndexed();
  return geo;
}
function buildCity(scene, track, A, Q) {
  const M = mapInfo(), nb = { i: 0, lat: 0, d: 0 };
  const nearTrackEdge = (x, z, extra) => { const n = track.nearest(x, z, false, nb); return n.i >= 0 && !FLOATING[track.surf[n.i]] && n.d < track.w[n.i] + extra; };
  // --- streets: asphalt ribbons laid on the ground, broken where they meet the race track ---
  const roadParts = [];
  for (const r of M.roads) {
    const hw = r.w * 0.7, pts = [];
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      const x0 = r.p[k], z0 = r.p[k + 1], x1 = r.p[k + 2], z1 = r.p[k + 3], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 5));
      for (let s = k ? 1 : 0; s <= n; s++) pts.push([x0 + (x1 - x0) * s / n, z0 + (z1 - z0) * s / n]);
    }
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const pos = [], uv = [], ind = []; let v = 0;
        run.forEach(([x, z], k) => {
          const [xa, za] = run[Math.max(0, k - 1)], [xb, zb] = run[Math.min(run.length - 1, k + 1)];
          let dx = xb - xa, dz = zb - za; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          if (k) v += Math.hypot(x - run[k - 1][0], z - run[k - 1][1]) / 8;
          for (const s of [-1, 1]) { const px = x - dz * hw * s, pz = z + dx * hw * s; pos.push(px, gh(track, px, pz) + 0.07, pz); uv.push(s < 0 ? 0 : 1, v); }
          if (k) { const q = (k - 1) * 2; ind.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
        roadParts.push({ geo: g, x: run[0][0], z: run[0][1] });
      }
      run = [];
    };
    for (const p of pts) { if (nearTrackEdge(p[0], p[1], 2.5) || seaDist(p[0], p[1]) > -1) flush(); else run.push(p); }
    flush();
  }
  const [am, an] = A.asphalt;
  const streetM = new THREE.MeshStandardMaterial({ map: am, normalMap: an, color: 0xb8b8b8, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  if (roadParts.length) chunked(scene, streetM, roadParts.map(p => ({ ...p })));

  // --- buildings from the map (mostly Hastings Street + Noosa Junction shops) ---
  const col = new THREE.Color(), parts = [];
  const shopCols = [0xf4e3c1, 0xe8f1f2, 0xf6d3c4, 0xd9ead3, 0xfdf3e7, 0xcfe3ef], houseCols = [0xf4efe4, 0xdfe9ef, 0xf6e3c8, 0xe6efe0, 0xf0d9d4, 0xece4d8];
  for (const b of M.buildings) {
    const pts = []; for (let k = 0; k + 1 < b.p.length; k += 2) pts.push(new THREE.Vector2(b.p[k], -b.p[k + 1]));
    if (pts.length < 3) continue;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = -pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (nearTrackEdge(cx, cz, 4)) continue;
    const base = Math.min(...pts.map(p => gh(track, p.x, -p.y))) - 0.4, h = Math.max(3, b.h);
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h + 0.4, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, base, 0);
    const shop = /commercial|retail|apartments|hotel/.test(b.k);
    parts.push({ geo: paint(geo, col.setHex((shop ? shopCols : houseCols)[Math.floor(rand() * 6)])), x: cx, z: cz });
  }
  // --- houses along the suburban streets (most Noosa houses aren't drawn on the map, but the streets are) ---
  const taken = new Set(), key = (x, z) => Math.floor(x / 9) + ',' + Math.floor(z / 9);
  for (const b of M.buildings) for (let k = 0; k + 1 < b.p.length; k += 2) taken.add(key(b.p[k], b.p[k + 1]));
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), roof = new THREE.ConeGeometry(0.71, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const roofCols = [0x8c3b2e, 0x3d5a73, 0x55606b, 0x9a9590, 0x6f3d2c];
  const C = M.codes, ok = c => c === 0 || c === C.residential || c === C.commercial;
  const maxD = Q.seg >= 0.8 ? 320 : 200, mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  let houses = 0;
  for (const r of M.roads) {
    if (r.w > 4.6 || r.w < 3) continue;                                  // residential + unclassified streets only
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      const x0 = r.p[k], z0 = r.p[k + 1], x1 = r.p[k + 2], z1 = r.p[k + 3], L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 6) continue;
      const dx = (x1 - x0) / L, dz = (z1 - z0) / L, rot = Math.atan2(dx, dz);
      for (let s = 4; s < L - 3; s += 11) for (const side of [-1, 1]) {
        const x = x0 + dx * s - dz * side * 8.5, z = z0 + dz * s + dx * side * 8.5;
        const n = track.nearest(x, z, false, nb);
        if (n.i < 0 && track.nearest(x, z, true, nb).d > maxD) continue;
        if (!ok(coverAt(x, z)) || seaDist(x, z) > -14 || nearTrackEdge(x, z, 7) || taken.has(key(x, z))) continue;
        taken.add(key(x, z));
        const W = rr(5.5, 7.5), D = rr(6.5, 8.5), H = rr(2.8, 3.8), y = gh(track, x, z) - 0.3;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
        mt.compose(v.set(x, y, z), q, sc.set(W, H + 0.3, D));
        parts.push({ geo: paint(box.clone().applyMatrix4(mt), col.setHex(houseCols[Math.floor(rand() * 6)])), x, z });
        mt.compose(v.set(x, y + H + 0.3, z), q, sc.set(W * 1.12, rr(1.4, 2.2), D * 1.12));
        parts.push({ geo: paint(roof.clone().applyMatrix4(mt), col.setHex(roofCols[Math.floor(rand() * 5)])), x, z });
        houses++;
      }
    }
  }
  chunked(scene, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), parts);
  return houses;
}

// ---------- eucalyptus trees: pale trunk + grey-green clumps, instanced ----------
function buildGums(scene, track, Q) {
  const M = mapInfo(), C = M.codes, list = [];
  const trunk = paint(new THREE.CylinderGeometry(0.22, 0.38, 7, 6).translate(0, 3.5, 0), new THREE.Color(0xd8d2c4));
  const clumps = [[0, 7.6, 0, 2.6], [1.4, 6.6, 0.8, 2], [-1.2, 8.4, -0.6, 1.9]].map(([x, y, z, r]) => paint(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.75, 1).translate(x, y, z), new THREE.Color(0x6f8a5a)));
  const geo = mergeGeometries([trunk, ...clumps]);
  const count = Q.seg >= 1 ? 1400 : Q.seg >= 0.8 ? 900 : 450;
  for (let tries = 0; list.length < count && tries < count * 25; tries++) {
    const i = Math.floor(rand() * track.N), s = track.surf[i];
    if (s === 'under') continue;
    const far = s === 'cloud' ? rr(0, 260) : rr(4, 150);              // under the cloud road: the national park below
    const lat = (rand() < 0.5 ? -1 : 1) * (track.w[i] + far), p = track.p[i], r = track.r[i];
    const x = p.x + r.x * lat, z = p.y + r.y * lat, c = coverAt(x, z);
    const n = track.nearest(x, z, false, { i: 0, lat: 0, d: 0 });
    if (n.i >= 0 && !FLOATING[track.surf[n.i]] && n.d < track.w[n.i] + 5) continue;
    if (seaDist(x, z) > -12 || c === C.road || c === C.water || c === C.beach) continue;
    if (c !== C.forest && rand() < 0.7) continue;                      // forest = dense; suburbs = the odd gum tree
    list.push([x, gh(track, x, z) - 0.2, z]);
  }
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
  list.forEach(([x, y, z], k) => {
    const s = rr(0.8, 1.6);
    m.compose(v.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rr(0, 6.3)), sc.set(s, s * rr(0.9, 1.25), s));
    im.setMatrixAt(k, m); im.setColorAt(k, col.setHSL(rr(0.2, 0.28), rr(0.15, 0.35), rr(0.75, 1.05)));
  });
  im.castShadow = !!Q.shadow; im.receiveShadow = true;
  scene.add(im);
}

// ---------- barriers along both edges, like Mario Kart (the kart bounces off them) ----------
function buildBarriers(scene, track) {
  const vstrip = (idx, lat, h, vScale) => {
    const pos = [], uv = [], ind = []; let u = 0;
    idx.forEach((i, k) => {
      if (k) u += track.p[i].distanceTo(track.p[idx[k - 1]]) / vScale;
      const p = track.p[i], r = track.r[i], L = lat(i), x = p.x + r.x * L, z = p.y + r.y * L, y = track.th[i];
      pos.push(x, y - 0.3, z, x, y + h, z); uv.push(u, 0, u, 1);
      if (k) { const a = (k - 1) * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
    return g;
  };
  const tex = (a, b) => { const t = stripeTex(a, b, 2); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1, 1); return t; };
  const woodT = canvasTex(256, 64, (g, w, h) => { for (let y = 0; y < h; y += 16) { const s = 120 + rand() * 40; g.fillStyle = `rgb(${s},${s * 0.66 | 0},${s * 0.4 | 0})`; g.fillRect(0, y, w, 14); g.fillStyle = '#3b2616'; g.fillRect(0, y + 14, w, 2); } });
  woodT.wrapS = THREE.RepeatWrapping;
  const concreteT = canvasTex(64, 32, (g, w, h) => { g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, w, h); g.fillStyle = '#d42a1e'; g.fillRect(0, 0, w / 2, 5); g.fillStyle = '#f4f4f4'; g.fillRect(w / 2, 0, w / 2, 5); g.fillStyle = '#9d9a92'; g.fillRect(0, h - 3, w, 3); });
  concreteT.wrapS = THREE.RepeatWrapping;
  const kinds = {
    road: [0.7, new THREE.MeshStandardMaterial({ map: concreteT, roughness: 0.8, side: THREE.DoubleSide })],
    rock: [1.0, new THREE.MeshStandardMaterial({ color: 0xa8875f, roughness: 0.95, side: THREE.DoubleSide })],
    sand: [0.8, new THREE.MeshStandardMaterial({ map: tex('#1b6fb2', '#f4f4f4'), roughness: 0.5, side: THREE.DoubleSide })],
    dirt: [0.9, new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.9, side: THREE.DoubleSide })],
    under: [1.4, new THREE.MeshStandardMaterial({ color: 0x4f6d63, roughness: 0.9, side: THREE.DoubleSide })],
    cloud: [1.0, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xa8bbd2, emissiveIntensity: 0.2, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })],
  };
  kinds.creek = kinds.dirt;
  for (const [k, [h, mat]] of Object.entries(kinds)) {
    const geos = [];
    for (const run of track.runs(i => track.surf[i] === k || (k === 'dirt' && track.surf[i] === 'creek')))
      for (const s of [-1, 1]) geos.push(vstrip(run, i => s * (track.wall(i) - 0.1), h, k === 'road' ? 2 : 3));
    if (k === 'creek' || !geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = k !== 'cloud'; m.receiveShadow = true; scene.add(m);
  }
}

// ---------- Hastings Street + Noosa Junction shops, named spots, fig trees, street lights ----------
function buildStreets(scene, track, Q) {
  const std = o => new THREE.MeshStandardMaterial(o), col = new THREE.Color(), parts = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const heading = i => Math.atan2(-track.t[i].x, -track.t[i].y);
  const at = (i, lat) => { const p = track.p[i], r = track.r[i]; return [p.x + r.x * lat, p.y + r.y * lat]; };
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const addBox = (x, y, z, rot, W, H, D, c) => { m4.compose(v.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot), sc.set(W, H, D)); parts.push({ geo: paint(box.clone().applyMatrix4(m4), col.setHex(c)), x, z }); };
  const walls = [0xf6efe2, 0xe9f2f4, 0xf7dccb, 0xdcebd5, 0xfdf6ea, 0xf2e6c9, 0xe4e0f0], awn = [0x1b9aaa, 0xd6402f, 0x23395d, 0xf2b134, 0x2f8f5b, 0xffffff];
  // shopfronts both sides: 2-3 storeys, coloured awnings over the footpath
  const shopSpots = [];
  for (let i = 0; i < track.N; i += 6) {
    const z = track.zone[i]; if (z !== 'hastings' && z !== 'junction') continue;
    for (const s of [-1, 1]) {
      const D = rr(8, 11), H = z === 'hastings' ? rr(6.5, 10) : rr(4.5, 7.5), lat = s * (track.wall(i) + 3 + D / 2), [x, zz] = at(i, lat);
      const y = gh(track, x, zz) - 0.3, rot = heading(i);
      addBox(x, y, zz, rot, 8.6, H, D, walls[Math.floor(rand() * walls.length)]);
      const [ax, az] = at(i, s * (track.wall(i) + 1.6));
      addBox(ax, y + 3.1, az, rot, 8.4, 0.25, 2.8, awn[Math.floor(rand() * awn.length)]);   // awning
      shopSpots.push([i, s]);
    }
  }
  chunked(scene, std({ vertexColors: true, roughness: 0.75 }), parts);

  // named spots Tom asked for, as shop signs facing the road
  const sign = (text, bg, fg, i, s, w = 7) => {
    const t = canvasTex(512, 96, (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = fg; g.font = '900 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch / 2 + 2); });
    const [x, z] = at(i, s * (track.wall(i) + 2.95)), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), std({ map: t, roughness: 0.6 }));
    mesh.position.set(x, gh(track, x, z) + 4.4, z); mesh.rotation.y = heading(i) + (s > 0 ? Math.PI / 2 : -Math.PI / 2);
    scene.add(mesh);
  };
  const zoneIdx = z => { const l = []; for (let i = 0; i < track.N; i++) if (track.zone[i] === z) l.push(i); return l; };
  const seaSide = i => { const [a, b] = [at(i, -12), at(i, 12)]; return seaDist(...a) > seaDist(...b) ? -1 : 1; };
  const H = zoneIdx('hastings'), J = zoneIdx('junction'), Dx = zoneIdx('deus');
  if (H.length) {
    const i0 = H[Math.floor(H.length * 0.15)], i1 = H[Math.floor(H.length * 0.85)];
    sign('NOOSA HEADS SLSC', '#ffd200', '#d6201f', i0, seaSide(i0), 8);
    sign("LAGUNA JACK'S", '#f4efe2', '#1d5f7a', i1, seaSide(i1));
  }
  if (Dx.length) { const i = Dx[Math.floor(Dx.length / 2)]; sign('DEUS EX MACHINA', '#111111', '#ffffff', i, -seaSide(i), 8); }
  // banner across the road at Noosa Junction
  if (J.length) {
    const i = J[2] ?? J[0], g = track.place(new THREE.Group(), i), w = track.wall(i);
    const t = canvasTex(1024, 128, (c, cw, ch) => { c.fillStyle = '#1d5f3a'; c.fillRect(0, 0, cw, ch); c.fillStyle = '#ffd23f'; c.font = '900 80px Trebuchet MS, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NOOSA JUNCTION', cw / 2, ch / 2 + 3); });
    const pole = std({ color: 0x2b2b2b, metalness: 0.5, roughness: 0.5 });
    for (const s of [-1, 1]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7), pole).translateX(s * (w + 0.4)).translateY(3.5));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2 * w + 1, 1.4, 0.2), [pole, pole, pole, pole, std({ map: t }), std({ map: t })]).translateY(6.2));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  // big shady fig trees along Hastings Street
  const figs = [];
  for (const i of H) if (i % 7 === 0) { const s = (i / 7) % 2 ? 1 : -1, [x, z] = at(i, s * (track.wall(i) + 1.2)); figs.push([x, gh(track, x, z), z]); }
  if (figs.length) {
    const trunk = paint(new THREE.CylinderGeometry(0.35, 0.6, 4, 7).translate(0, 2, 0), new THREE.Color(0x6e5a48));
    const crown = [[0, 5.2, 0, 3.4], [2.2, 4.6, 0.8, 2.4], [-2, 4.8, -0.6, 2.5], [0.4, 6.2, -1.6, 2.2]].map(([x, y, z, r]) => paint(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.7, 1).translate(x, y, z), new THREE.Color(0x3f6b34)));
    const im = new THREE.InstancedMesh(mergeGeometries([trunk, ...crown]), std({ vertexColors: true, roughness: 0.9, flatShading: true }), figs.length);
    figs.forEach(([x, y, z], k) => { const s = rr(0.9, 1.2); m4.compose(v.set(x, y - 0.2, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rr(0, 6.3)), sc.set(s, s, s)); im.setMatrixAt(k, m4); });
    im.castShadow = !!Q.shadow; scene.add(im);
  }

  // street lights along the roads
  const lamps = [];
  for (let i = 0; i < track.N; i += 22) {
    if (track.surf[i] !== 'road' || track.w[i] > 14) continue;
    for (const s of [-1, 1]) { const [x, z] = at(i, s * (track.wall(i) + 0.7)); lamps.push([x, gh(track, x, z), z, heading(i) + (s > 0 ? Math.PI / 2 : -Math.PI / 2)]); }
  }
  const lampGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 6).translate(0, 3.25, 0), new THREE.Color(0x5b6168)),
    paint(new THREE.BoxGeometry(0.1, 0.1, 1.8).translate(0, 6.45, 0.85), new THREE.Color(0x5b6168)),
    paint(new THREE.BoxGeometry(0.35, 0.18, 0.7).translate(0, 6.35, 1.7), new THREE.Color(0xfff4c8)),
  ]);
  const li = new THREE.InstancedMesh(lampGeo, std({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), lamps.length);
  lamps.forEach(([x, y, z, r], k) => { m4.compose(v.set(x, y - 0.1, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r), sc.set(1, 1, 1)); li.setMatrixAt(k, m4); });
  li.castShadow = false; scene.add(li);
}
