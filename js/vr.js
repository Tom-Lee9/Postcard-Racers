// Phone orientation -> camera rotation (the maths three.js's old DeviceOrientationControls used).
import * as THREE from 'three';

const Z = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const qScreen = new THREE.Quaternion();
const qCam = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // look out the back of the phone, not up

export class Gyro {
  constructor() {
    this.data = null;
    addEventListener('deviceorientation', e => { if (e.alpha !== null) this.data = e; });
  }
  // iOS 13+ needs permission, asked from inside a tap. Call this synchronously in the click handler.
  request() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      return D.requestPermission().then(r => r === 'granted').catch(() => false);
    }
    return Promise.resolve(!!D);
  }
  get active() { return this.data !== null; }
  read(out) {
    const e = this.data;
    if (!e) return false;
    const d = THREE.MathUtils.degToRad;
    const screen = (window.screen.orientation && window.screen.orientation.angle) ?? window.orientation ?? 0;
    euler.set(d(e.beta), d(e.alpha), -d(e.gamma), 'YXZ');
    out.setFromEuler(euler).multiply(qCam).multiply(qScreen.setFromAxisAngle(Z, -d(screen)));
    return true;
  }
}
