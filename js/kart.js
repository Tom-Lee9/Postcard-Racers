// The kart: model (body, wheels, driver) and arcade driving physics.
import * as THREE from 'three';
import { TRACK_Y } from './world.js';

const paint = c => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
const std = o => new THREE.MeshStandardMaterial(o);
export const EYE = new THREE.Vector3(0, 1.08, 0.16);       // driver's eyes, kart space (forward = -z)

function extrudeSide(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);                                   // shape x (forward) -> kart -z, extrusion -> kart x
  return g;
}

function makeWheel(r, w, rimM, tyreM) {
  const g = new THREE.Group(), ri = r * 0.62, c = 0.06;
  const prof = [[ri, -w / 2], [r - c, -w / 2], [r - c * 0.3, -w / 2 + c * 0.3], [r, -w / 2 + c], [r, w / 2 - c], [r - c * 0.3, w / 2 - c * 0.3], [r - c, w / 2], [ri, w / 2]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const tyre = new THREE.LatheGeometry(prof, 32); tyre.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(tyre, tyreM));
  const rim = new THREE.CylinderGeometry(ri, ri, w * 0.86, 24); rim.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(rim, rimM));
  const chrome = std({ color: 0xdddddd, metalness: 1, roughness: 0.18 });
  const hub = new THREE.CylinderGeometry(ri * 0.32, ri * 0.32, w * 0.94, 12); hub.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(hub, chrome));
  for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, ri * 1.85, 0.05), chrome);
    sp.position.x = s * w * 0.44; sp.rotation.x = k * Math.PI * 2 / 5; g.add(sp);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function buildKart(color = 0xe8322a, color2 = 0xf4f4f4, number = '7') {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const pM = paint(color), p2 = paint(color2);
  const carbon = std({ color: 0x1a1a1c, roughness: 0.45, metalness: 0.3 });
  const black = std({ color: 0x111111, roughness: 0.6 });
  const chrome = std({ color: 0xe0e0e0, metalness: 1, roughness: 0.15 });

  // main body: side profile with a dip for the seat
  const s = new THREE.Shape();
  s.moveTo(-1.0, 0.16); s.lineTo(-1.0, 0.48); s.quadraticCurveTo(-0.96, 0.6, -0.72, 0.6); s.lineTo(-0.44, 0.56);
  s.quadraticCurveTo(-0.34, 0.31, -0.18, 0.31); s.lineTo(0.2, 0.31); s.quadraticCurveTo(0.36, 0.47, 0.55, 0.43);
  s.quadraticCurveTo(0.95, 0.35, 1.12, 0.22); s.quadraticCurveTo(1.17, 0.13, 1.04, 0.12); s.lineTo(-1.0, 0.16);
  body.add(new THREE.Mesh(extrudeSide(s, 0.74, 0.07), pM));
  // side pods
  const pod = new THREE.Shape();
  pod.moveTo(-0.68, 0.12); pod.lineTo(-0.68, 0.32); pod.quadraticCurveTo(-0.1, 0.4, 0.38, 0.28); pod.quadraticCurveTo(0.44, 0.14, 0.3, 0.12); pod.lineTo(-0.68, 0.12);
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(extrudeSide(pod, 0.12, 0.04), p2); m.position.x = sx * 0.55; body.add(m); }
  // number roundels on the pods
  const numT = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = '900 84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(number, 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  for (const sx of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), std({ map: numT, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
    d.position.set(sx * 0.66, 0.24, 0.05); d.rotation.y = sx * Math.PI / 2; body.add(d);
  }
  // floor, bumpers, engine, exhausts, spoiler, seat
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); body.add(m); return m; };
  add(new THREE.BoxGeometry(1.1, 0.05, 2.1), carbon, 0, 0.1, 0);
  add(new THREE.BoxGeometry(1.55, 0.08, 0.16), black, 0, 0.17, -1.22);
  add(new THREE.BoxGeometry(1.75, 0.08, 0.14), black, 0, 0.2, 1.12);
  add(new THREE.BoxGeometry(0.5, 0.3, 0.42), carbon, 0, 0.45, 0.82);
  const exhausts = [];
  for (const sx of [-0.14, 0.14]) { const e = add(new THREE.CylinderGeometry(0.05, 0.065, 0.45, 12).rotateX(Math.PI / 2), chrome, sx, 0.52, 1.12); exhausts.push(e); }
  add(new THREE.BoxGeometry(1.4, 0.04, 0.32), p2, 0, 0.96, 0.98);
  for (const sx of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.03, 0.24, 0.38), pM, sx, 0.94, 0.98);
  for (const sx of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.04, 0.36, 0.06), carbon, sx, 0.76, 0.94);
  const seatM = std({ color: 0x222226, roughness: 0.85 });
  add(new THREE.BoxGeometry(0.5, 0.08, 0.45), seatM, 0, 0.37, 0.12);
  add(new THREE.BoxGeometry(0.52, 0.5, 0.08), seatM, 0, 0.6, 0.38).rotation.x = -0.2;

  // steering wheel (tilted towards the driver; inner group spins)
  const sw = new THREE.Group(); sw.position.set(0, 0.7, -0.27); sw.rotation.x = -0.6;
  const swSpin = new THREE.Group(); sw.add(swSpin);
  swSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 10, 32), black));
  swSpin.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.03), carbon));
  swSpin.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.03), carbon).translateY(-0.08));
  swSpin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 16).rotateX(Math.PI / 2), pM));
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.42).rotateX(1.0), carbon, 0, 0.56, -0.42);
  body.add(sw);

  // driver: hidden in cockpit view except for the arms
  const suit = std({ color: 0x1b4f9c, roughness: 0.7 }), glove = std({ color: 0x222222, roughness: 0.7 });
  const driver = new THREE.Group(), arms = new THREE.Group();
  driver.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.28, 6, 12), suit).translateY(0.72).translateZ(0.2));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), pM); helmet.position.set(0, 1.06, 0.16); driver.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 12, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.28), std({ color: 0x111820, metalness: 0.9, roughness: 0.08 }));
  visor.position.copy(helmet.position); driver.add(visor);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    a.set(sx * 0.24, 0.86, 0.18); b.set(sx * 0.15, 0.73, -0.22);
    const len = a.distanceTo(b), arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, len, 4, 8), suit);
    arm.position.copy(a).add(b).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    arms.add(arm);
    arms.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), glove).translateX(b.x).translateY(b.y).translateZ(b.z));
  }
  body.add(driver, arms);

  // wheels
  const tread = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 16; const g = c.getContext('2d');
    g.fillStyle = '#888'; g.fillRect(0, 0, 256, 16); g.fillStyle = '#222'; for (let x = 0; x < 256; x += 8) g.fillRect(x, 0, 4, 16); return new THREE.CanvasTexture(c); })();
  const tyreM = std({ color: 0x1c1c1c, roughness: 0.85, bumpMap: tread, bumpScale: 2 });
  const rimM = std({ color: color2 === 0xf4f4f4 ? 0xf2c230 : color2, metalness: 0.7, roughness: 0.25 });
  const wheels = [], steer = [];
  for (const [x, z, r, w, front] of [[-0.8, -0.8, 0.27, 0.24, 1], [0.8, -0.8, 0.27, 0.24, 1], [-0.84, 0.72, 0.32, 0.32, 0], [0.84, 0.72, 0.32, 0.32, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, r, z);
    const wh = makeWheel(r, w, rimM, tyreM); wh.userData.r = r;
    pivot.add(wh); root.add(pivot);
    wheels.push(wh); if (front) steer.push(pivot);
  }

  // boost flames out of the exhausts
  const flameM = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const coreM = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flames = new THREE.Group();
  for (const e of exhausts) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 10).rotateX(Math.PI / 2).translate(0, 0, 0.3), flameM);
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.35, 8).rotateX(Math.PI / 2).translate(0, 0, 0.17), coreM);
    f.position.set(e.position.x, e.position.y, e.position.z + 0.22); c.position.copy(f.position);
    flames.add(f, c);
  }
  flames.visible = false;
  body.add(flames);

  body.traverse(o => { if (o.isMesh && o.material !== flameM && o.material !== coreM) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, body, wheels, steer, swSpin, driver, arms, flames };
}

// ---------- physics ----------
const SURF = {                  // top-speed multiplier, grip (how fast sideways sliding stops), rolling drag
  road: [1.0, 9, 1.5], sand: [0.94, 6, 2.0], off: [0.6, 4, 5], water: [0.35, 3, 9],
};
const fwd = new THREE.Vector3(), right = new THREE.Vector3();

export class Kart {
  constructor(track, model) {
    this.track = track; this.m = model;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.vy = 0; this.air = false; this.boost = 0; this.steer = 0;
    this.top = 28; this.idx = 0; this.lastGood = 0; this.respawnT = 0;
    this.pitch = 0; this.roll = 0; this.groundRate = 0;
    this.state = { surf: 'road', speed: 0, slip: 0, boosting: false, landed: 0, respawned: false };
  }
  reset(i) {
    const t = this.track, N = t.N; i = (i + N) % N;
    const p = t.p[i], d = t.t[i];
    this.pos.set(p.x, TRACK_Y, p.y); this.yaw = Math.atan2(-d.x, -d.y);
    this.vel.set(0, 0, 0); this.vy = 0; this.air = false; this.boost = 0; this.idx = this.lastGood = i;
    this.groundRate = 0;
    this.sync(0);
  }
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, inp, locked) {
    const t = this.track, st = this.state;
    st.landed = 0; st.respawned = false;
    const g = t.ground(this.pos.x, this.pos.z);
    this.idx = g.i; st.surf = g.surf;
    if (g.surf !== 'off' && g.surf !== 'water') this.lastGood = g.i;
    if (g.boost) this.boost = 1.3;
    this.boost = Math.max(0, this.boost - dt);
    const [mul, grip, drag] = SURF[g.surf];
    const top = this.top * mul * (this.boost > 0 ? 1.45 : 1);

    this.forward(fwd); right.set(-fwd.z, 0, fwd.x);
    let vf = this.vel.dot(fwd), vr = this.vel.dot(right);
    const thr = locked ? 0 : inp.throttle, brk = locked ? 0 : inp.brake;
    this.steer += (inp.steer - this.steer) * Math.min(1, dt * 10);
    if (!this.air) {
      const accel = this.top * 0.55 + (this.boost > 0 ? 25 : 0);
      if (this.boost > 0) vf += accel * dt * Math.max(0, 1 - vf / top);
      else if (thr > 0) vf += thr * accel * Math.max(0, 1 - Math.max(0, vf) / top) * dt;
      if (brk > 0) vf = vf > 0.5 ? vf - 30 * brk * dt : Math.max(vf - 9 * brk * dt, -7);
      if (thr === 0 && brk === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
      if (vf > top) vf += (top - vf) * Math.min(1, dt * 2.5);  // too fast for this surface: bleed off speed
      vr *= Math.exp(-grip * dt);
      const yawRate = -this.steer * 2.1 * Math.max(-1, Math.min(1, vf / 6)) * (1 - 0.35 * Math.min(1, Math.abs(vf) / this.top));
      this.yaw += yawRate * dt;
    } else {
      this.yaw += -this.steer * 0.4 * dt;                      // a little air steering
    }
    if (locked) { vf = 0; vr = 0; }
    this.vel.copy(fwd).multiplyScalar(vf).addScaledVector(right, vr);
    this.pos.addScaledVector(this.vel, dt);

    // up and down: follow the ground, fly off ramps and drops
    const h = t.ground(this.pos.x, this.pos.z).h;
    if (this.air) {
      this.vy -= 22 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= h) { st.landed = Math.min(1, -this.vy / 8); this.pos.y = h; this.air = false; this.vy = 0; }
    } else if (h < this.pos.y - 0.3 && this.groundRate > 1) {
      this.air = true; this.vy = this.groundRate;
    } else {
      this.groundRate = Math.max(-5, Math.min(12, (h - this.pos.y) / Math.max(dt, 1e-3)));
      this.pos.y = h;
    }

    // fell in the sea or wandered off: back to the track
    if (h < -0.9 || Math.abs(this.pos.x) > 480 || Math.abs(this.pos.z) > 780) this.respawnT += dt; else this.respawnT = 0;
    if (this.respawnT > 0.8) { this.reset(this.lastGood); st.respawned = true; }

    st.speed = vf; st.slip = Math.abs(vr); st.boosting = this.boost > 0; st.top = this.top;
    this.sync(dt, thr);
  }

  // move the model to match the physics
  sync(dt, thr = 0) {
    const m = this.m, t = this.track;
    m.root.position.copy(this.pos); m.root.rotation.y = this.yaw;
    // tilt the body to the ground slope, lean in corners, squat when accelerating
    let tp = 0, tr = 0;
    if (!this.air && dt) {
      this.forward(fwd); right.set(-fwd.z, 0, fwd.x);
      const hf = t.ground(this.pos.x + fwd.x * 0.9, this.pos.z + fwd.z * 0.9).h, hb = t.ground(this.pos.x - fwd.x * 0.9, this.pos.z - fwd.z * 0.9).h;
      const hr = t.ground(this.pos.x + right.x * 0.7, this.pos.z + right.z * 0.7).h, hl = t.ground(this.pos.x - right.x * 0.7, this.pos.z - right.z * 0.7).h;
      tp = Math.atan2(hf - hb, 1.8) - thr * 0.025; tr = Math.atan2(hl - hr, 1.4);
    } else if (this.air) tp = this.pitch - dt * 0.25;
    const spd = this.state.speed || 0;
    tr += this.steer * Math.min(1, Math.abs(spd) / this.top) * 0.07;
    const k = dt ? Math.min(1, dt * 12) : 1;
    this.pitch += (tp - this.pitch) * k; this.roll += (tr - this.roll) * k;
    m.body.rotation.set(this.pitch, 0, this.roll, 'YXZ');
    m.body.position.y = 0.012 * Math.sin(performance.now() * 0.03) * Math.min(1, Math.abs(spd) / 10) * (this.state.surf === 'road' ? 0.4 : 1.5);
    // wheels spin + front wheels steer + steering wheel turns
    for (const w of m.wheels) w.rotation.x -= spd / w.userData.r * dt;
    for (const s of m.steer) s.rotation.y = -this.steer * 0.42;
    m.swSpin.rotation.z = -this.steer * 1.6;
    m.flames.visible = this.boost > 0;
    if (m.flames.visible) m.flames.children.forEach((f, i) => f.scale.set(1, 1, 0.75 + Math.random() * 0.6));
  }
}
