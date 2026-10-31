import * as THREE from 'three';
import { loadAssets, buildWorld, seaDist } from './world.js?v=8';
import { buildKart, Kart, EYE, DRIFT } from './kart.js?v=8';
import { Gyro } from './vr.js?v=8';
import { Sound } from './audio.js?v=8';
import { Hud } from './hud.js?v=8';
import { Particles } from './effects.js?v=8';
import { MicroBit } from './microbit.js?v=8';

const $ = id => document.getElementById(id);
const VERSION = 8;                                          // bump this AND every ?v= in imports + index.html together
const KEY = 'postcard-racers-settings', BEST = 'postcard-racers-best-noosa-v8';
const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const S = Object.assign({ quality: mobile ? 'medium' : 'high', cam: 'cockpit', top: 28, tilt: true, muted: false, ipd: 63, fov: 80, fps: false, lock: 50, mbFlip: false }, (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
})());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const QUALITY = {
  low: { pr: 1, shadow: 0, palms: 70, ferns: 70, shrubs: 12, seg: 0.6 },
  medium: { pr: 1.5, shadow: 1024, palms: 120, ferns: 150, shrubs: 26, seg: 0.8 },
  high: { pr: 2, shadow: 2048, palms: 170, ferns: 260, shrubs: 45, seg: 1 },
};
const Q = QUALITY[S.quality] || QUALITY.medium;
const LAPS = 1;                                              // one big lap of Noosa
const AUTO = new URLSearchParams(location.search).has('auto');
let logoTaps = 0, logoWas = false;                            // counts logo touches on the menu, to test how reliable it is
const SPARK = +new URLSearchParams(location.search).get('spark') || 0;      // testing: ?spark=1..3 shows drift sparks

// ---------- renderer, cameras ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const maxPR = Math.min(devicePixelRatio, Q.pr);
let pr = maxPR;
renderer.setPixelRatio(pr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = !!Q.shadow;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;                       // rendered once per frame, not once per eye
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const rig = new THREE.Object3D(), head = new THREE.Object3D();
scene.add(rig); rig.add(head);
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 4000);
const eyeL = new THREE.PerspectiveCamera(S.fov, 1, 0.05, 4000), eyeR = eyeL.clone();
head.add(cam, eyeL, eyeR);
const hud = new Hud(); rig.add(hud.mesh);

const gyro = new Gyro();
const sound = new Sound(S.muted);
const mb = new MicroBit();
mb.onChange = s => { $('mbStatus').textContent = s; toast(s, 3000); };
let world = null, kart = null, model = null, dust = null, sparks = null, mode = 'menu';   // 'menu' | 'play' | 'vr'
let yawOffset = 0, needCenter = true, lookYaw = 0, lookPitch = 0, drag = null, touchGas = false, frame = 0, clock = 0;
const keys = {}, pads = { left: false, right: false, gas: false, brake: false, drift: false };
const qG = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), eu = new THREE.Euler(), Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), fwd = new THREE.Vector3();
const yawOf = q => eu.setFromQuaternion(q, 'YXZ').y;
const race = { state: 'count', t: 3, time: 0, lap: 1, lapStart: 0, cp: 0, prevFrac: 0, best: +localStorage.getItem(BEST) || null, lastLap: null, msg: '', msgT: 0, sub: '' };

// ---------- load + build ----------
$('status').textContent = 'Loading… 0%';
loadAssets(renderer, f => { $('status').textContent = 'Loading… ' + Math.round(f * 100) + '%'; }).then(A => {
  $('status').textContent = 'Building Noosa…';
  setTimeout(() => {
    world = buildWorld(scene, renderer, A, Q);
    model = buildKart();
    scene.add(model.root);
    kart = new Kart(world.track, model);
    kart.top = S.top;
    applyCam();
    dust = new Particles(scene);
    sparks = new Particles(scene, 220, true);
    resetRace();
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    $('status').textContent = secure ? '' : 'Heads up: phone motion sensors only work over https (e.g. GitHub Pages).';
    $('best').textContent = race.best ? 'Best lap: ' + race.best.toFixed(2) + ' s' : '';
    document.querySelectorAll('#menu button').forEach(b => b.disabled = false);
    renderer.setAnimationLoop(loop);
    if (location.hash === '#play' || location.hash === '#vr') start(location.hash === '#vr');   // shortcut for testing
    if (location.hash === '#bench') startBench();
  }, 30);
}).catch(err => { $('status').textContent = 'Loading failed: ' + err.message; console.error(err); });

// ---------- race ----------
function resetRace() {
  kart.reset(-8);                                              // on the grid, just behind the line
  Object.assign(race, { state: 'count', t: 3.5, time: 0, lap: 1, lapStart: 0, cp: 0, prevFrac: 0.99, lastLap: null, msg: '', sub: '' });
  lastBeep = 4;
}
let lastBeep = 4;
function say(msg, secs, sub = '', color = '#fff') { race.msg = msg; race.msgT = secs; race.sub = sub; race.msgColor = color; }
function updateRace(dt) {
  if (race.state === 'count') {
    race.t -= dt;
    const n = Math.ceil(race.t);
    if (n !== lastBeep && n <= 3 && n >= 1) { sound.beep(440); lastBeep = n; }
    if (race.t <= 3) race.msg = String(Math.max(1, n)), race.msgColor = '#ffd23f', race.msgT = 1, race.sub = '';
    if (race.t <= 0) { race.state = 'racing'; mb.send('go'); say('GO!', 1, '', '#3fdc6a'); sound.beep(880, 0.4); }
    return;
  }
  if (race.state === 'racing') {
    race.time += dt;
    const frac = kart.idx / world.track.N;
    if (race.cp === 0 && frac > 0.3 && frac < 0.5) race.cp = 1;
    if (race.cp === 1 && frac > 0.6 && frac < 0.8) race.cp = 2;
    if (race.cp === 2 && race.prevFrac > 0.9 && frac < 0.1) {
      const lt = race.time - race.lapStart;
      race.lastLap = lt; race.lapStart = race.time; race.cp = 0; race.lap++;
      const pb = !race.best || lt < race.best;
      if (AUTO) console.log('[race] lap ' + race.lap + ' ' + lt.toFixed(2) + ' s, track ' + Math.round(world.track.length) + ' m');
      if (pb) { race.best = lt; try { localStorage.setItem(BEST, lt.toFixed(3)); } catch (e) {} }
      mb.send(race.lap > LAPS ? 'fin' : 'l' + race.lap);
      if (race.lap > LAPS) { race.state = 'done'; say('FINISH!', 1e9, 'Total ' + race.time.toFixed(2) + ' s' + (pb ? ' · new best lap!' : ''), '#ffd23f'); sound.beep(988, 0.6); }
      else { say(race.lap === LAPS ? 'FINAL LAP' : 'LAP ' + race.lap, 2, lt.toFixed(2) + ' s' + (pb ? ' · best!' : ''), pb ? '#3fdc6a' : '#fff'); sound.beep(660, 0.25); }
    }
    race.prevFrac = frac;
  }
  if (race.msgT > 0) { race.msgT -= dt; if (race.msgT <= 0) race.msg = ''; }
}

// ---------- menu / settings ----------
function toast(msg, ms = 5000) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms); }
async function start(vr) {
  const perm = gyro.request();                                  // must happen inside the tap (iOS)
  sound.start();
  try { navigator.wakeLock?.request('screen')?.catch(() => {}); } catch (e) {}
  if (vr) { const el = document.documentElement; try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {}); } catch (e) {} }
  mode = vr ? 'vr' : 'play';
  document.body.className = mode;
  $('menu').hidden = $('settings').hidden = true;
  $('hud').hidden = false;
  needCenter = true; lookYaw = lookPitch = 0;
  const q = new URLSearchParams(location.search);              // testing: ?cam=chase&at=300
  if (q.get('cam')) S.cam = q.get('cam');
  if (q.get('mb')) { mb.angle = +q.get('mb'); mb.t = Infinity; }   // testing: pretend the micro:bit is turned
  applyCam();
  resetRace();
  if (q.get('at')) { kart.reset(+q.get('at')); race.state = 'racing'; snapRig = true; }
  onResize();
  toast(mb.active ? 'micro:bit: A = go, B = brake, touch the logo to drift. Flick it up off jumps for a trick.'
    : vr ? 'Joy-Cons: ZR/R = go, ZL/L = brake, stick = steer. No controller: hold the screen to go, tilt your head to steer.'
    : mobile ? 'Use the buttons to drive. Hold DRIFT and steer to drift.' : 'W/S or arrows to drive, A/D to steer, hold Space to drift. C = camera, R = back on track.');
  const ok = await perm;
  if (!ok && vr && mobile) toast('Motion access not granted, so head tracking is off. See README for how to reset it.', 7000);
}
function toMenu() {
  mode = 'menu'; document.body.className = '';
  $('hud').hidden = true; $('menu').hidden = false;
  $('best').textContent = race.best ? 'Best lap: ' + race.best.toFixed(2) + ' s' : '';
  try { document.fullscreenElement && document.exitFullscreen(); } catch (e) {}
  onResize();
}
function applyCam() {
  hud.setMode(S.cam);
  if (!model) return;
  model.driver.visible = model.arms.visible = S.cam !== 'cockpit';
  if (kart) kart.cockpit = S.cam === 'cockpit';
}
function setMuted(m) { S.muted = m; save(); sound.setMuted(m); $('mute').textContent = m ? '🔇' : '🔊'; $('setMute').checked = m; }
function toggleCam() { S.cam = S.cam === 'cockpit' ? 'chase' : 'cockpit'; save(); applyCam(); $('setCam').value = S.cam; snapRig = true; }

$('play').onclick = () => start(false);
$('vr').onclick = () => start(true);
$('exit').onclick = toMenu;
$('mute').onclick = () => setMuted(!S.muted);
$('openSettings').onclick = () => { $('menu').hidden = true; $('settings').hidden = false; };
$('bench').onclick = startBench;
$('back').onclick = () => { $('settings').hidden = true; $('menu').hidden = false; };
$('setQuality').value = S.quality;
$('setQuality').onchange = e => { S.quality = e.target.value; save(); location.reload(); };
$('setCam').value = S.cam;
$('setCam').onchange = e => { S.cam = e.target.value; save(); applyCam(); };
$('setSpeedClass').value = String(S.top);
$('setSpeedClass').onchange = e => { S.top = +e.target.value; save(); if (kart) kart.top = S.top; };
$('mbConnect').hidden = $('mbRow').hidden = !mb.supported;
$('mbConnect').onclick = () => { $('mbStatus').textContent = 'Connecting…'; mb.connect(); };
$('setFlip').checked = S.mbFlip;
$('setFlip').onchange = e => { S.mbFlip = e.target.checked; save(); };
$('setTilt').checked = S.tilt;
$('setTilt').onchange = e => { S.tilt = e.target.checked; save(); };
$('setMute').checked = S.muted;
$('setMute').onchange = e => setMuted(e.target.checked);
$('setFps').checked = S.fps;
$('setFps').onchange = e => { S.fps = e.target.checked; save(); $('fps').hidden = !S.fps; };
$('fps').hidden = !S.fps;
for (const [id, k, unit] of [['setIpd', 'ipd', ' mm'], ['setFov', 'fov', '°'], ['setLock', 'lock', '°']]) {
  const el = $(id), out = $(id + 'Val');
  el.value = S[k]; out.textContent = S[k] + unit;
  el.oninput = () => { S[k] = +el.value; out.textContent = el.value + unit; save(); };
}
$('mute').textContent = S.muted ? '🔇' : '🔊';
$('ver').textContent = 'Version ' + VERSION;
applyCam();

// ---------- input ----------
const cv = renderer.domElement;
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  if (mode === 'menu') return;
  if (e.touches.length >= 2) { needCenter = true; touchGas = false; return; }   // two-finger tap: re-centre
  if (mode === 'vr') touchGas = true;
  else { const t = e.touches[0]; drag = { x: t.clientX, y: t.clientY }; }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!drag) return;
  const t = e.touches[0]; lookYaw -= (t.clientX - drag.x) * 0.005; lookPitch -= (t.clientY - drag.y) * 0.005; drag = { x: t.clientX, y: t.clientY };
}, { passive: false });
cv.addEventListener('touchend', e => { if (!e.touches.length) { touchGas = false; drag = null; } });
cv.addEventListener('mousedown', e => { if (mode !== 'menu') drag = { x: e.clientX, y: e.clientY }; });
addEventListener('mousemove', e => { if (drag) { lookYaw -= (e.clientX - drag.x) * 0.005; lookPitch -= (e.clientY - drag.y) * 0.005; drag = { x: e.clientX, y: e.clientY }; } });
addEventListener('mouseup', () => { drag = null; });
for (const k of Object.keys(pads)) {
  const b = $(k);
  for (const [ev, v] of [['touchstart', true], ['touchend', false], ['touchcancel', false], ['mousedown', true], ['mouseup', false], ['mouseleave', false]])
    b.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); pads[k] = v; }, { passive: false });
}
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' && mode !== 'menu') toMenu();
  if (e.code === 'KeyM') setMuted(!S.muted);
  if (mode !== 'menu' && e.code === 'KeyC') toggleCam();
  if (mode !== 'menu' && e.code === 'KeyR') kart.reset(kart.lastGood);
  if (mode !== 'menu' && e.code === 'Enter' && race.state === 'done') resetRace();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// Joy-Cons / any gamepad. Joy-Cons can show up as two separate pads, so read every pad.
const prevBtn = {};
function readInput() {
  const r = { throttle: 0, brake: 0, steer: 0, padSteer: false, drift: false, trick: false };
  for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!p) continue;
    const b = i => (p.buttons[i] ? (p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0)) : 0);
    r.throttle = Math.max(r.throttle, b(7), b(5), b(0));
    r.brake = Math.max(r.brake, b(6), b(4), b(1));
    if (b(2) > 0.5) r.drift = true;                             // X/Y side button: drift (tell Claude if it's the wrong one)
    for (let a = 0; a + 1 < p.axes.length; a += 2) { const x = p.axes[a]; if (Math.abs(x) > 0.15 && Math.abs(x) > Math.abs(r.steer)) { r.steer = x; r.padSteer = true; } }
    const edge = i => { const id = p.index + ':' + i, now = b(i) > 0.5, was = prevBtn[id]; prevBtn[id] = now; return now && !was; };
    if (edge(9)) needCenter = true;                              // + : re-centre the view
    if (edge(3)) toggleCam();                                    // X/Y : switch camera
    if (edge(8) && race.state === 'done') resetRace();           // - : race again
  }
  if (AUTO || bench) {                                          // testing: ?auto=1 drives itself (and the speed test) (later: CPU racers)
    const t = world.track, p = t.p[(kart.idx + 14) % t.N];
    let d = Math.atan2(-(p.x - kart.pos.x), -(p.y - kart.pos.z)) - kart.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -d * 2.5)) };
  }
  if (keys.KeyW || keys.ArrowUp || pads.gas || touchGas) r.throttle = 1;
  if (keys.KeyS || keys.ArrowDown || pads.brake) r.brake = 1;
  if (keys.Space || keys.ShiftLeft || keys.ShiftRight || pads.drift) r.drift = true;
  if (mb.active) {
    if (mb.buttons & 1) r.throttle = 1;
    if (mb.buttons & 2) r.brake = 1;
    if (mb.buttons & 4) r.drift = true;
    if (mb.trick) { r.trick = true; mb.trick = false; }
    const a = (S.mbFlip ? -1 : 1) * mb.angle, dz = 3;
    r.steer = Math.abs(a) < dz ? 0 : Math.max(-1, Math.min(1, (a - Math.sign(a) * dz) / (S.lock - dz)));
  } else if (!r.padSteer) {
    let s = 0;
    if (keys.KeyA || keys.ArrowLeft || pads.left) s -= 1;
    if (keys.KeyD || keys.ArrowRight || pads.right) s += 1;
    if (s === 0 && mode === 'vr' && S.tilt && gyro.active) {    // tilt your head like a steering wheel
      const roll = eu.setFromQuaternion(head.quaternion, 'YXZ').z;
      s = Math.abs(roll) < 0.06 ? 0 : -Math.max(-1, Math.min(1, (roll - Math.sign(roll) * 0.06) / 0.3));
    }
    r.steer = s;
  } else r.steer = Math.sign(r.steer) * ((Math.abs(r.steer) - 0.15) / 0.85) ** 1.4;
  return r;
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  if (dust) dust.mat.uniforms.uScale.value = innerHeight * pr * 0.6;
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 300));

// ---------- per-frame ----------
let snapRig = true, rigYaw = 0;
function updateRig(dt) {
  if (S.cam === 'cockpit' || mode === 'menu') {
    const ky = kart.yaw + kart.visYaw;                          // drifting swings the nose (and your view) into the corner
    const e = tmp.copy(EYE).applyAxisAngle(Y, ky).add(kart.pos);
    if (mode === 'menu') {                                       // slow orbit around the kart on the menu
      const a = clock * 0.15;
      rig.position.set(kart.pos.x + Math.sin(a) * 7, kart.pos.y + 2.2, kart.pos.z + Math.cos(a) * 7);
      rig.rotation.y = a; head.quaternion.setFromEuler(eu.set(-0.18, 0, 0, 'YXZ'));
      snapRig = true;
      return;
    }
    rig.position.x = e.x; rig.position.z = e.z;
    rig.position.y = snapRig ? e.y : rig.position.y + (e.y - rig.position.y) * Math.min(1, dt * 14);
    rig.rotation.y = rigYaw = ky;
  } else {
    kart.forward(fwd);
    tmp.copy(kart.pos).addScaledVector(fwd, -5.4); tmp.y += 2.3;
    const k = snapRig ? 1 : 1 - Math.exp(-6 * dt);
    rig.position.lerp(tmp, k);
    let d = kart.yaw - rigYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    rigYaw += d * (snapRig ? 1 : 1 - Math.exp(-5 * dt));
    rig.rotation.y = rigYaw;
  }
  snapRig = false;
  // head: phone orientation in VR (relative to the kart), drag-to-look otherwise
  if (mode === 'vr' && gyro.read(qG)) {
    if (needCenter) { yawOffset = -yawOf(qG); needCenter = false; }
    head.quaternion.copy(qYaw.setFromAxisAngle(Y, yawOffset)).multiply(qG);
  } else {
    if (!drag) { lookYaw *= Math.exp(-3 * dt); lookPitch *= Math.exp(-3 * dt); }
    head.quaternion.setFromEuler(eu.set(lookPitch + (S.cam === 'chase' ? -0.2 : -0.08), lookYaw, 0, 'YXZ'));
  }
}
const sandC = new THREE.Color(0.86, 0.76, 0.58), foamC = new THREE.Color(0.95, 0.98, 1);
const wheelL = new THREE.Vector3(-0.84, 0.1, 0.8), wheelR = new THREE.Vector3(0.84, 0.1, 0.8);
const frontL = new THREE.Vector3(-0.9, 0.1, -0.8), frontR = new THREE.Vector3(0.9, 0.1, -0.8), sparkC = new THREE.Color();
function updateEffects(dt) {
  const st = kart.state, spd = Math.abs(st.speed);
  const rate = st.surf === 'off' ? 1 : st.surf === 'sand' ? 0.45 : st.surf === 'water' || st.surf === 'creek' ? 1 : st.surf === 'dirt' ? 0.5 : st.slip > 3 ? 0.4 : 0;
  if (!kart.air && spd > 4 && Math.random() < rate) {
    kart.forward(fwd);
    for (const w of [wheelL, wheelR]) {
      const p = model.root.localToWorld(tmp.copy(w));
      tmp2.copy(fwd).multiplyScalar(-spd * 0.15).add({ x: (Math.random() - 0.5) * 2, y: 1 + Math.random() * 1.5, z: (Math.random() - 0.5) * 2 });
      const water = st.surf === 'water' || st.surf === 'creek';
      dust.emit(p, tmp2, water ? foamC : sandC, water ? 0.5 : 0.6, water ? 0.7 : 1.2, water ? 1 : 1.6);
    }
  }
  if (st.landed > 0.3) for (let k = 0; k < 14; k++) dust.emit(tmp.copy(kart.pos).add({ x: (Math.random() - 0.5) * 2, y: 0.2, z: (Math.random() - 0.5) * 2 }), tmp2.set((Math.random() - 0.5) * 6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 6), sandC, 0.8, 1.2, 2);
  // drift sparks: blue, orange, purple. Off the back wheels, plus the front wheels in cockpit view so you can see them.
  const tier = SPARK || st.tier, pre = !SPARK && st.pre;
  if ((tier > 0 || pre) && !kart.air) {
    // before blue is ready: a few tiny blue sparks; each tier after that: more and bigger
    const c = sparkC.setHex(DRIFT.colors[Math.max(0, tier - 1)]), n = pre ? 1 : tier + 1, size = pre ? 0.08 : 0.14 + 0.1 * tier;
    const spots = S.cam === 'cockpit' ? [wheelL, wheelR, frontL, frontR] : [wheelL, wheelR];
    for (const w of spots) for (let k = 0; k < n; k++) {
      const p = model.root.localToWorld(tmp.copy(w));
      tmp2.set((Math.random() - 0.5) * 4 + Math.sign(w.x) * 2.5, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4).applyAxisAngle(Y, kart.yaw);
      sparks.emit(p, tmp2, c, size, pre ? 0.15 : 0.2 + 0.08 * tier, -0.3);
    }
  }
  if (st.tierUp) {                                               // new colour reached: a big flash of sparks
    const c = sparkC.setHex(DRIFT.colors[st.tierUp - 1]);
    for (const w of [wheelL, wheelR]) for (let k = 0; k < 18; k++) {
      sparks.emit(model.root.localToWorld(tmp.copy(w)), tmp2.set((Math.random() - 0.5) * 9, 1 + Math.random() * 5, (Math.random() - 0.5) * 9), c, 0.22, 0.35, 0.2);
    }
  }
  if (st.mt) {                                                   // boost burst when you let go
    const c = sparkC.setHex(st.mt > 0 ? DRIFT.colors[st.mt - 1] : 0xffe14a);
    for (let k = 0; k < 24; k++) sparks.emit(model.root.localToWorld(tmp.set((Math.random() - 0.5) * 0.4, 0.5, 1.3)), tmp2.set((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5), c, 0.2, 0.4, 0.3);
  }
  dust.update(dt);
  sparks.update(dt);
}
// ---------- speed test (Settings → Run speed test): finds out what's holding the frame rate back ----------
// Each step runs 4 s (the first second is ignored). If even a blank screen is stuck at 30, the browser is capping it.
const BENCH = [['normal', 'normal'], ['halfres', 'half resolution'], ['noshadow', 'no shadows'], ['nologic', 'no game code'], ['blank', 'blank screen']];
let bench = null;
function startBench() { start(false); bench = { i: 0, t: 0, n: 0, acc: 0, js: 0, gpu: 0, out: [] }; setPR(maxPR);
  race.state = 'racing'; race.msg = ''; toast('Speed test running… about 20 seconds. Hands off!', 20000); }
function benchStep(dt, jsMs, drawMs) {
  const b = bench, step = BENCH[b.i][0];
  b.t += dt;
  if (b.t > 1) { b.n++; b.acc += dt; if (step === 'normal') { b.js += jsMs; b.gpu += drawMs; } }
  if (b.t < 4) return;
  b.out.push(BENCH[b.i][1] + ' ' + Math.round(b.n / b.acc));
  if (step === 'normal') b.out.push('(code ' + (b.js / b.n).toFixed(1) + ' ms, drawing ' + (b.gpu / b.n).toFixed(1) + ' ms)');
  b.i++; b.t = b.n = b.acc = 0;
  setPR(BENCH[b.i]?.[0] === 'halfres' ? maxPR * 0.5 : maxPR);
  if (b.i < BENCH.length) return;
  const msg = 'Speed test: ' + b.out.join(' · ') + ' fps · screen ' + innerWidth + 'x' + innerHeight + ' @' + maxPR.toFixed(1) + 'x';
  console.log(msg); bench = null; toMenu(); $('benchResult').textContent = msg;
  $('menu').hidden = true; $('settings').hidden = false;
}

function render() {
  const w = innerWidth, h = innerHeight;
  if (bench && BENCH[bench.i][0] === 'blank') { renderer.setViewport(0, 0, w, h); renderer.clear(); return; }
  renderer.shadowMap.needsUpdate = !(bench && BENCH[bench.i][0] === 'noshadow');
  if (mode === 'vr') {
    const half = w / 2, ipd = S.ipd / 1000;
    renderer.setScissorTest(true);
    for (const [c, side, x] of [[eyeL, -1, 0], [eyeR, 1, half]]) {
      c.position.set(side * ipd / 2, 0, 0);
      c.fov = S.fov; c.aspect = half / h; c.updateProjectionMatrix();
      renderer.setViewport(x, 0, half, h); renderer.setScissor(x, 0, half, h);
      renderer.render(scene, c);
    }
    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, w, h);
    renderer.render(scene, cam);
  }
}
// dynamic resolution: drop pixel ratio if the phone can't hold ~45 fps, raise it back when there's headroom.
// But only keep a drop if it actually helped: if the phone is held back by something else (Low Power Mode caps
// at 30 fps, heat, Bluetooth), lowering the resolution just makes it blurry, so undo it and stop trying for a while.
const minPR = Math.min(maxPR, 1);
let acc = 0, cnt = 0, last = performance.now(), tried = null, holdT = 0;
function setPR(v) { pr = v; renderer.setPixelRatio(pr); onResize(); }
function perf(dt) {
  if (bench) return;
  acc += dt; cnt++;
  if (acc < 2) return;
  const fps = cnt / acc;
  holdT = Math.max(0, holdT - acc);
  if (tried) {                                                   // judge the last drop
    if (fps < tried.fps * 1.08) { setPR(tried.pr); holdT = 30; }  // didn't help: put it back, don't drop again for 30 s
    tried = null;
  } else if (fps < 45 && pr > minPR && holdT === 0) { tried = { pr, fps }; setPR(Math.max(minPR, pr * 0.85)); }
  else if (fps > 57 && pr < maxPR) setPR(Math.min(maxPR, pr * 1.08));
  if (S.fps) $('fps').textContent = Math.round(fps) + ' fps · ' + pr.toFixed(2) + 'x' + (holdT ? ' (held)' : '');
  acc = cnt = 0;
}
function loop() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now; frame++; clock += dt;
  const logoNow = !!(mb.buttons & 4); if (logoNow && !logoWas) logoTaps++; logoWas = logoNow;
  const t0 = performance.now();
  if (bench && (BENCH[bench.i][0] === 'nologic' || BENCH[bench.i][0] === 'blank')) { render(); benchStep(dt, 0, 0); return; }
  const inp = mode === 'menu' ? { throttle: 0, brake: 0, steer: 0 } : readInput();
  if (mode !== 'menu') updateRace(dt);
  kart.update(dt, inp, mode === 'menu' || race.state === 'count');
  const ks = kart.state;
  if (ks.tierUp) sound.chirp(ks.tierUp);
  if (ks.mt) sound.whoosh(ks.mt > 0 ? ks.mt : 1);
  if (ks.trick) sound.chirp(4);
  if (kart.state.respawned) snapRig = true;
  updateRig(dt);
  updateEffects(dt);
  world.update(dt, clock, kart.pos);
  hud.mesh.visible = mode !== 'menu';
  if (mode === 'menu' && mb.active && frame % 6 === 0) {        // live check of the wheel: angle and every button
    const on = (bit, name) => (mb.buttons & bit ? '🟢' : '⚪') + ' ' + name;
    $('mbStatus').textContent = 'micro:bit connected · turned ' + Math.round(mb.angle) + '° · ' + on(1, 'A') + '  ' + on(2, 'B') + '  ' + on(4, 'logo') + ' · logo touches: ' + logoTaps;
  }
  hud.draw({ lap: race.lap, laps: LAPS, time: race.time, kmh: Math.abs(kart.state.speed) * 3.6, best: race.best, last: race.lastLap, msg: race.msg, sub: race.sub, msgColor: race.msgColor, tier: ks.tier, drifting: ks.drifting });
  sound.update({ speed: kart.state.speed, top: kart.top, throttle: inp.throttle, boosting: kart.state.boosting, loose: kart.state.surf === 'off' || kart.state.surf === 'water', slip: kart.state.slip, drifting: ks.drifting, shore: Math.abs(seaDist(kart.pos.x, kart.pos.z)) });
  const t1 = performance.now();
  render();
  const t2 = performance.now();
  if (bench) benchStep(dt, t1 - t0, t2 - t1);
  perf(dt);
}
