import * as THREE from 'three'
import { Effect, EffectAttribute } from 'postprocessing'

// The drone camera's optics: a little barrel distortion, unsharp-mask sharpening and fine sensor noise.
const frag = /* glsl */ `
uniform float uBarrel;
uniform float uSharpen;
uniform float uGrain;
uniform float uTime;

vec2 gwBarrel(vec2 uv) {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  return 0.5 + d * (1.0 - uBarrel * 0.5 + uBarrel * r2 * 2.0) / (1.0 + uBarrel * 0.5);
}

float gwHash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // reads the frame itself, so it runs first in the chain and the later effects work on its output
  vec2 u = uBarrel > 0.0 ? gwBarrel(uv) : uv;
  vec3 c = texture2D(inputBuffer, u).rgb;
  if (uSharpen > 0.0) {
    vec3 n = texture2D(inputBuffer, u + vec2(texelSize.x, 0.0)).rgb + texture2D(inputBuffer, u - vec2(texelSize.x, 0.0)).rgb
           + texture2D(inputBuffer, u + vec2(0.0, texelSize.y)).rgb + texture2D(inputBuffer, u - vec2(0.0, texelSize.y)).rgb;
    c += (c - n * 0.25) * uSharpen;
  }
  float g = gwHash(uv * resolution + fract(uTime * 61.0) * 113.0) - 0.5;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += g * uGrain * (0.6 + 0.4 * (1.0 - lum));
  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`

export class LensEffect extends Effect {
  constructor() {
    super('GroundworkLens', frag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uBarrel', new THREE.Uniform(0.035)],
        ['uSharpen', new THREE.Uniform(0.45)],
        ['uGrain', new THREE.Uniform(0.035)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    })
  }
  set(barrel: number, sharpen: number, grain: number, time: number) {
    this.uniforms.get('uBarrel')!.value = barrel
    this.uniforms.get('uSharpen')!.value = sharpen
    this.uniforms.get('uGrain')!.value = grain
    this.uniforms.get('uTime')!.value = time
  }
}

export const lens = { barrel: 0 }

// Where a point that projects to ndc lands after the barrel, so labels stay on their machines.
export function distortNdc(v: { x: number; y: number }) {
  const k = lens.barrel
  if (k <= 0) return
  let x = v.x * 0.5, y = v.y * 0.5
  // invert uv' = 0.5 + d * f(r2) by a few fixed-point steps
  const tx = x, ty = y
  for (let i = 0; i < 3; i++) {
    const r2 = x * x + y * y
    const f = (1 - k * 0.5 + k * r2 * 2) / (1 + k * 0.5)
    x = tx / f
    y = ty / f
  }
  v.x = x * 2
  v.y = y * 2
}
