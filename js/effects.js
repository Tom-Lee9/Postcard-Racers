// Soft particles: sand dust behind the wheels and splashes in the shallows.
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 260, glow = false) {          // glow = additive and bright (drift sparks)
    this.max = max; this.next = 0;
    this.pos = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.size = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1); this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uGlow: { value: glow ? 1 : 0 } },
      transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
        uniform float uScale; varying float vA; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vA = aAlpha; vC = aColor;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC; uniform float uGlow;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0, a = (1.0 - r) * vA;
          if (a <= 0.01) discard;
          // sparks: white-hot centre fading to the tier colour
          vec3 c = mix(vC, mix(vC * 1.6, vec3(1.0), 0.6 * (1.0 - r) * (1.0 - r) * (1.0 - r)), uGlow);
          gl_FragColor = vec4(c, mix(a, a * 1.8, uGlow));
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.geo = g;
  }
  emit(p, v, color, size, life, grow = 1.5) {
    const i = this.next; this.next = (i + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.geo.attributes.aColor.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, damp = Math.exp(-2.5 * dt);
      this.vel[k + 1] -= 3 * dt;
      this.vel[k] *= damp; this.vel[k + 1] *= damp; this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, t) * 0.55;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aAlpha.needsUpdate = a.aSize.needsUpdate = true;
  }
}
