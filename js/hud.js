// In-world HUD: a panel on the dashboard (cockpit) or floating above the kart (chase). Works in VR because it's 3D.
import * as THREE from 'three';

const fmt = s => { if (s == null) return '--:--.-'; const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };

export class Hud {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = 1024; this.c.height = 512;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, toneMapped: false }));
    this.mesh.renderOrder = 10;
    this.last = '';
  }
  setMode(cam) {
    if (cam === 'cockpit') { this.mesh.position.set(0, -0.25, -0.95); this.mesh.rotation.set(-0.25, 0, 0); this.mesh.scale.setScalar(0.42); }
    else { this.mesh.position.set(0, 0.55, -3.4); this.mesh.rotation.set(-0.08, 0, 0); this.mesh.scale.setScalar(1.5); }
  }
  draw(d) {
    const key = [d.lap, d.laps, Math.floor(d.time * 10), Math.round(d.kmh), d.best, d.msg, d.last].join('|');
    if (key === this.last) return;
    this.last = key;
    const g = this.g, W = 1024;
    g.clearRect(0, 0, W, 512);
    const box = (x, y, w, h) => { g.fillStyle = 'rgba(10,20,30,0.55)'; g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); };
    g.textBaseline = 'middle';
    box(20, 330, 300, 160); box(352, 330, 320, 160); box(704, 330, 300, 160);
    g.fillStyle = '#ffd23f'; g.font = '700 34px Arial'; g.textAlign = 'center';
    g.fillText('LAP', 170, 368); g.fillText('TIME', 512, 368); g.fillText('KM/H', 854, 368);
    g.fillStyle = '#fff'; g.font = '900 76px Arial';
    g.fillText(Math.min(d.lap, d.laps) + '/' + d.laps, 170, 440);
    g.fillText(fmt(d.time), 512, 440);
    g.fillText(Math.round(d.kmh), 854, 440);
    g.font = '600 28px Arial'; g.fillStyle = '#cfe';
    g.fillText('best lap ' + fmt(d.best), 512, 312);
    if (d.msg) {
      g.font = '900 150px Arial'; g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.fillStyle = d.msgColor || '#fff';
      g.strokeText(d.msg, 512, 150); g.fillText(d.msg, 512, 150);
      if (d.sub) { g.font = '700 46px Arial'; g.lineWidth = 8; g.strokeText(d.sub, 512, 255); g.fillStyle = '#fff'; g.fillText(d.sub, 512, 255); }
    }
    this.tex.needsUpdate = true;
  }
}
