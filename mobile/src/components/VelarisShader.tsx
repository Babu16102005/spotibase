import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

const vertexShaderGLSL = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderGLSL = `
precision highp float;
varying vec2 vUv;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_scale;
uniform float u_detail;
uniform float u_glow;
uniform float u_coreSize;
uniform float u_swirl;
uniform float u_fold;
uniform float u_blackPoint;
uniform float u_brightness;
uniform float u_colorMode;
uniform float u_grain;
uniform float u_grainIntensity;
uniform float u_opacity;
uniform float u_amplitude;
uniform float u_blend;
uniform vec2  u_mouse;
uniform float u_mouseStrength;
uniform int   u_enableMouse;
uniform vec3  u_color1;
uniform vec3  u_color2;
uniform vec3  u_color3;
uniform int   u_pattern;
uniform vec3  u_colors[4];
uniform vec3  u_bg;

#define TAU 6.28318530718

// ── Gradient Hash & 3D Perlin for Soft Aurora ────────────────────────────
vec3 gradientHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 234.6)),
    dot(p, vec3(269.5, 183.3, 198.3)),
    dot(p, vec3(169.5, 283.3, 156.9))
  );
  vec3 h = fract(sin(p) * 43758.5453123);
  float phi = acos(clamp(2.0 * h.x - 1.0, -1.0, 1.0));
  float theta = TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float quinticSmooth(float t) {
  float t2 = t * t;
  float t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x = px * frequency;
  float y = py * frequency;

  float fx = floor(x); float fy = floor(y); float fz = floor(pz);
  float cx = ceil(x);  float cy = ceil(y);  float cz = ceil(pz);

  vec3 g000 = gradientHash(vec3(fx, fy, fz));
  vec3 g100 = gradientHash(vec3(cx, fy, fz));
  vec3 g010 = gradientHash(vec3(fx, cy, fz));
  vec3 g110 = gradientHash(vec3(cx, cy, fz));
  vec3 g001 = gradientHash(vec3(fx, fy, cz));
  vec3 g101 = gradientHash(vec3(cx, fy, cz));
  vec3 g011 = gradientHash(vec3(fx, cy, cz));
  vec3 g111 = gradientHash(vec3(cx, cy, cz));

  float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz));
  float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
  float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz));
  float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
  float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz));
  float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
  float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz));
  float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));

  float sx = quinticSmooth(x - fx);
  float sy = quinticSmooth(y - fy);
  float sz = quinticSmooth(pz - fz);

  float lx00 = mix(d000, d100, sx);
  float lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx);
  float lx11 = mix(d011, d111, sx);

  float ly0 = mix(lx00, lx10, sy);
  float ly1 = mix(lx01, lx11, sy);

  return amplitude * mix(ly0, ly1, sz);
}

float auroraGlow(float t, vec2 shift, vec2 fragCoord, vec2 resolution, float noiseFreq, float noiseAmp, float scale, float octaveDecay, float bandHeight, float bandSpread) {
  vec2 uv = fragCoord.xy / resolution.y;
  uv += shift;

  float noiseVal = 0.0;
  float freq = noiseFreq;
  float amp = noiseAmp;
  vec2 samplePos = uv * scale;

  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= octaveDecay;
    freq *= 2.0;
  }

  float yBand = uv.y * 10.0 - bandHeight * 10.0;
  return 0.3 * max(exp(bandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

// ── Simplex noise (used by cosmic/geometric patterns) ─────────────────────
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 ii = floor(v + dot(v, C.yy));
  vec2 x0 = v - ii + dot(ii, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  ii = mod(ii, 289.0);
  vec3 pp = permute(permute(ii.y + vec3(0.0,i1.y,1.0)) + ii.x + vec3(0.0,i1.x,1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 xx = 2.0*fract(pp*C.www)-1.0;
  vec3 h = abs(xx)-0.5;
  vec3 ox = floor(xx+0.5);
  vec3 a0 = xx-ox;
  m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
  vec3 gg;
  gg.x  = a0.x *x0.x  + h.x *x0.y;
  gg.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.0*dot(m,gg);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  if (u_pattern == 0) {
    // ── FLUID: Exact MoltenMetal algorithm — reactbits.dev ────────────────
    float time = u_time * u_speed;
    vec2 p = u_scale * ((gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y) - 0.5;

    vec2 drift = vec2(0.0);
    if (u_enableMouse != 0) {
      drift = (u_mouse - 0.5) * u_mouseStrength * 2.0;
    }
    p += drift;

    vec2 i = p;
    float c = 0.0;
    float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
    float d = length(p);
    float rot = d + time + p.x * u_swirl;

    float cosRot = cos(rot);
    mat2 warp = mat2(
      cos(rot - sin(time / 5.0)), sin(rot),
      -sin(cosRot - time),      cosRot
    ) * u_fold;

    float glowCore = u_glow * u_coreSize;

    for (int n = 0; n < 8; n++) {
      if (float(n) >= u_detail) break;
      p *= warp;
      float t = r - time / (float(n) + 3.0);
      i -= p + vec2(cos(t - i.x - r) + sin(t + i.y),
                    sin(t - i.y)       + cos(t + i.x) + r);
      c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
    }

    c /= 6.0;

    float intensity = max(c - u_blackPoint, 0.0) * u_brightness;
    float g = clamp(intensity, 0.0, 1.0);

    float mid = 0.5;
    if (u_colorMode > 1.5) {
      mid = 0.65;
    } else if (u_colorMode > 0.5) {
      mid = 0.35;
    }

    vec3 col = mix(u_color1, u_color2, smoothstep(0.0, mid, g));
    col = mix(col, u_color3, smoothstep(mid, 1.0, g));

    float a = g;
    if (u_grain > 0.5) {
      float gr = hash(gl_FragCoord.xy + u_time);
      a += (gr - 0.5) * u_grainIntensity;
    }
    a = clamp(a, 0.0, 1.0) * u_opacity;
    gl_FragColor = vec4(col * a, a);
    return;
  }

  if (u_pattern == 1) {
    // ── AURORA: Exact Soft Aurora algorithm — reactbits.dev ────────────────
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float t = u_speed * 0.4 * u_time;

    vec2 shift = vec2(0.0);
    if (u_enableMouse != 0) {
      shift = (u_mouse - 0.5) * u_mouseStrength;
    }

    float glow1 = auroraGlow(t, shift, gl_FragCoord.xy, u_resolution, 2.5, 1.0, 1.5, 0.1, 0.5, 1.0);
    float glow2 = auroraGlow(t + 0.0, shift, gl_FragCoord.xy, u_resolution, 2.5, 1.0, 1.5, 0.1, 0.5, 1.0);

    vec3 col = vec3(0.0);
    col += 0.99 * glow1 * cosineGradient(uv.x + u_time * u_speed * 0.2, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * u_color1;
    col += 0.99 * glow2 * cosineGradient(uv.x + u_time * u_speed * 0.1, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * u_color2;

    col *= u_brightness;
    float alpha = clamp(length(col) * u_opacity, 0.0, 1.0);

    if (u_grain > 0.5) {
      float gr = hash(gl_FragCoord.xy + u_time);
      col += (gr - 0.5) * u_grainIntensity;
    }

    gl_FragColor = vec4(col, alpha);
    return;
  }

  vec2 uv = vUv;
  vec3 col = u_bg;
  float t = u_time * u_speed;
  vec2 p = uv - 0.5;
  float ratio = u_resolution.x / u_resolution.y;
  p.x *= ratio;

  if (u_pattern == 2) {
    // 2: Cosmic Spiral Plasma Swirl & Vortex
    float r = length(p);
    float angle = atan(p.y, p.x) + r * 4.0 - t * 1.5;
    vec2 swirlP = vec2(r * cos(angle), r * sin(angle));
    float n1 = snoise(swirlP * 2.5 + vec2(t * 0.8, -t * 0.6));
    float n2 = sin(angle * 4.0 + r * 10.0 + t * 3.0);
    float n3 = snoise(p * 3.0 - vec2(t * 0.7));

    col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.9);
    col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.8);
    col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.7);
    col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.6);
  } else if (u_pattern == 3) {
    // 3: Geometric Diamond Mesh & Lattice Wave
    vec2 gridP = p * 6.0;
    vec2 cell = fract(gridP) - 0.5;
    float distToEdge = min(abs(cell.x), abs(cell.y));
    float n1 = sin(gridP.x * 2.0 + gridP.y * 2.0 + t * 3.0);
    float n2 = smoothstep(0.05, 0.45, distToEdge) * sin(gridP.x - gridP.y - t * 2.0);
    float n3 = snoise(floor(gridP) * 0.8 + vec2(t * 0.5));

    col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.9);
    col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.8);
    col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.7);
    col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.6);
  }

  float dist = length(p) * 1.5;
  float vignette = 1.0 - smoothstep(0.3, 1.2, dist);
  col = mix(col * 0.2, col, vignette);

  float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + u_time);
  col += (grain - 0.5) * u_grain * 0.12;

  gl_FragColor = vec4(col, 1.0);
}
`;

export type MoltenMetalColorMode = 'molten' | 'ember' | 'frost';

export interface VelarisShaderProps {
  bg?: string;
  colors?: string[];
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  scale?: number;
  detail?: number;
  glow?: number;
  coreSize?: number;
  swirl?: number;
  fold?: number;
  blackPoint?: number;
  brightness?: number;
  colorMode?: MoltenMetalColorMode;
  grain?: boolean | number;
  grainIntensity?: number;
  amplitude?: number;
  blend?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  opacity?: number;
  pattern?: number | 'fluid' | 'aurora' | 'cosmic' | 'geometric' | 'radial';
  height?: string | number;
  style?: any;
  className?: string;
  children?: React.ReactNode;
}

export type VelarisProps = VelarisShaderProps;

const DEFAULT_MOLTEN_COLORS = ['#5227FF', '#FF9FFC', '#FFFFFF', '#07080D'];
const DEFAULT_AURORA_COLORS = ['#f7f7f7', '#e100ff', '#3A29FF', '#07080D'];
const DEFAULT_COLORS = ['#063B00', '#266210', '#90B800', '#E1E100'];

const parsePatternIndex = (pat?: number | 'fluid' | 'aurora' | 'cosmic' | 'geometric' | 'radial'): number => {
  if (typeof pat === 'number') return Math.max(0, Math.min(3, pat));
  if (pat === 'aurora' || pat === 'radial') return 1;
  if (pat === 'cosmic') return 2;
  if (pat === 'geometric') return 3;
  return 0; // fluid
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

const colorModeToFloat = (mode: MoltenMetalColorMode = 'molten'): number =>
  mode === 'ember' ? 1 : mode === 'frost' ? 2 : 0;

const generateShaderHTML = (vertSrc: string, fragSrc: string, config: any): string => `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: transparent !important;
    background: transparent !important;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
  }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  (function() {
    var canvas = document.getElementById('c');
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false }) ||
             canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    var vertSrc = ${JSON.stringify(vertSrc)};
    var fragSrc = ${JSON.stringify(fragSrc)};

    function createShader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    var vertShader = createShader(gl.VERTEX_SHADER, vertSrc);
    var fragShader = createShader(gl.FRAGMENT_SHADER, fragSrc);
    var program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    var pos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    var locs = {
      res: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      speed: gl.getUniformLocation(program, 'u_speed'),
      scale: gl.getUniformLocation(program, 'u_scale'),
      detail: gl.getUniformLocation(program, 'u_detail'),
      glow: gl.getUniformLocation(program, 'u_glow'),
      coreSize: gl.getUniformLocation(program, 'u_coreSize'),
      swirl: gl.getUniformLocation(program, 'u_swirl'),
      fold: gl.getUniformLocation(program, 'u_fold'),
      blackPoint: gl.getUniformLocation(program, 'u_blackPoint'),
      brightness: gl.getUniformLocation(program, 'u_brightness'),
      colorMode: gl.getUniformLocation(program, 'u_colorMode'),
      grain: gl.getUniformLocation(program, 'u_grain'),
      grainIntensity: gl.getUniformLocation(program, 'u_grainIntensity'),
      opacity: gl.getUniformLocation(program, 'u_opacity'),
      amplitude: gl.getUniformLocation(program, 'u_amplitude'),
      blend: gl.getUniformLocation(program, 'u_blend'),
      mouse: gl.getUniformLocation(program, 'u_mouse'),
      mouseStrength: gl.getUniformLocation(program, 'u_mouseStrength'),
      enableMouse: gl.getUniformLocation(program, 'u_enableMouse'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3'),
      pattern: gl.getUniformLocation(program, 'u_pattern'),
      colors: gl.getUniformLocation(program, 'u_colors'),
      bg: gl.getUniformLocation(program, 'u_bg')
    };

    var config = ${JSON.stringify(config)};

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = (canvas.clientWidth || window.innerWidth || 300) * dpr;
      var h = (canvas.clientHeight || window.innerHeight || 200) * dpr;
      if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    window.addEventListener('resize', resize);
    resize();
    setTimeout(resize, 100);

    var targetMouse = [0.5, 0.5];
    var currentMouse = [0.5, 0.5];

    window.addEventListener('touchmove', function(e) {
      if (e.touches && e.touches[0]) {
        var rect = canvas.getBoundingClientRect();
        targetMouse[0] = (e.touches[0].clientX - rect.left) / rect.width;
        targetMouse[1] = 1.0 - (e.touches[0].clientY - rect.top) / rect.height;
      }
    }, { passive: true });

    window.addEventListener('touchend', function() {
      targetMouse = [0.5, 0.5];
    });

    var t0 = performance.now();
    function render(t) {
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

      gl.uniform2f(locs.res, canvas.width, canvas.height);
      gl.uniform1f(locs.time, (t - t0) * 0.001);
      gl.uniform1f(locs.speed, config.speed);
      gl.uniform1f(locs.scale, config.scale);
      gl.uniform1f(locs.detail, config.detail);
      gl.uniform1f(locs.glow, config.glow);
      gl.uniform1f(locs.coreSize, config.coreSize);
      gl.uniform1f(locs.swirl, config.swirl);
      gl.uniform1f(locs.fold, config.fold);
      gl.uniform1f(locs.blackPoint, config.blackPoint);
      gl.uniform1f(locs.brightness, config.brightness);
      gl.uniform1f(locs.colorMode, config.colorMode);
      gl.uniform1f(locs.grain, config.grain);
      gl.uniform1f(locs.grainIntensity, config.grainIntensity);
      gl.uniform1f(locs.opacity, config.opacity);
      gl.uniform1f(locs.amplitude, config.amplitude);
      gl.uniform1f(locs.blend, config.blend);
      gl.uniform2f(locs.mouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.mouseStrength, config.mouseStrength);
      gl.uniform1i(locs.enableMouse, config.enableMouse ? 1 : 0);
      gl.uniform3f(locs.color1, config.color1[0], config.color1[1], config.color1[2]);
      gl.uniform3f(locs.color2, config.color2[0], config.color2[1], config.color2[2]);
      gl.uniform3f(locs.color3, config.color3[0], config.color3[1], config.color3[2]);
      gl.uniform1i(locs.pattern, config.pattern);
      gl.uniform3f(locs.bg, config.bg[0], config.bg[1], config.bg[2]);
      gl.uniform3fv(locs.colors, new Float32Array(config.colors));

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  })();
</script>
</body>
</html>
`;

export const VelarisShader: React.FC<VelarisShaderProps> = ({
  bg = '#000000',
  colors,
  color1,
  color2,
  color3,
  speed,
  scale = 1.5,
  detail = 3,
  glow = 1.6,
  coreSize = 0.1,
  swirl = 1,
  fold = -0.2,
  blackPoint = 0.05,
  brightness = 1.0,
  colorMode = 'molten',
  grain = 0.3,
  grainIntensity = 0.05,
  amplitude = 1.0,
  blend = 0.5,
  mouseInteraction = true,
  mouseStrength = 0.25,
  opacity = 1.0,
  pattern = 0,
  height,
  style,
  children,
}) => {
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<any>(null);

  const patternIdx = parsePatternIndex(pattern);
  const effectiveSpeed =
    speed !== undefined
      ? speed
      : patternIdx === 0
      ? 0.35
      : patternIdx === 1
      ? 0.6
      : 2.0;

  const effectiveColors =
    colors ||
    (patternIdx === 0
      ? DEFAULT_MOLTEN_COLORS
      : patternIdx === 1
      ? DEFAULT_AURORA_COLORS
      : DEFAULT_COLORS);

  const resolvedColor1 = color1 || effectiveColors[0] || (patternIdx === 1 ? '#f7f7f7' : '#5227FF');
  const resolvedColor2 = color2 || effectiveColors[1] || (patternIdx === 1 ? '#e100ff' : '#FF9FFC');
  const resolvedColor3 = color3 || effectiveColors[2] || (patternIdx === 1 ? '#3A29FF' : '#FFFFFF');

  // WebGL Web Execution (Canvas)
  useEffect(() => {
    if (Platform.OS !== 'web' || process.env.NODE_ENV === 'test') return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl =
      canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false }) ||
      canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const vertShader = createShader(gl.VERTEX_SHADER, vertexShaderGLSL);
    const fragShader = createShader(gl.FRAGMENT_SHADER, fragmentShaderGLSL);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const pos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const locs = {
      res: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      speed: gl.getUniformLocation(program, 'u_speed'),
      scale: gl.getUniformLocation(program, 'u_scale'),
      detail: gl.getUniformLocation(program, 'u_detail'),
      glow: gl.getUniformLocation(program, 'u_glow'),
      coreSize: gl.getUniformLocation(program, 'u_coreSize'),
      swirl: gl.getUniformLocation(program, 'u_swirl'),
      fold: gl.getUniformLocation(program, 'u_fold'),
      blackPoint: gl.getUniformLocation(program, 'u_blackPoint'),
      brightness: gl.getUniformLocation(program, 'u_brightness'),
      colorMode: gl.getUniformLocation(program, 'u_colorMode'),
      grain: gl.getUniformLocation(program, 'u_grain'),
      grainIntensity: gl.getUniformLocation(program, 'u_grainIntensity'),
      opacity: gl.getUniformLocation(program, 'u_opacity'),
      amplitude: gl.getUniformLocation(program, 'u_amplitude'),
      blend: gl.getUniformLocation(program, 'u_blend'),
      mouse: gl.getUniformLocation(program, 'u_mouse'),
      mouseStrength: gl.getUniformLocation(program, 'u_mouseStrength'),
      enableMouse: gl.getUniformLocation(program, 'u_enableMouse'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3'),
      pattern: gl.getUniformLocation(program, 'u_pattern'),
      colors: gl.getUniformLocation(program, 'u_colors'),
      bg: gl.getUniformLocation(program, 'u_bg'),
    };

    const resize = () => {
      if (!container || !canvas) return;
      const parent = container.parentElement || container;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width =
        (container.clientWidth || container.offsetWidth || parent.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 300)) * dpr;
      const heightVal =
        (container.clientHeight || container.offsetHeight || parent.clientHeight || 180) * dpr;
      if (width > 0 && heightVal > 0) {
        canvas.width = width;
        canvas.height = heightVal;
        gl.viewport(0, 0, width, heightVal);
      }
    };

    resize();
    const timeoutId = setTimeout(resize, 100);

    let ro: any;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(container);
      if (container.parentElement) {
        ro.observe(container.parentElement);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', resize);
    }

    const targetMouse = [0.5, 0.5];
    const currentMouse = [0.5, 0.5];

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        targetMouse[0] = (e.clientX - rect.left) / rect.width;
        targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          targetMouse[0] = (touch.clientX - rect.left) / rect.width;
          targetMouse[1] = 1.0 - (touch.clientY - rect.top) / rect.height;
        }
      }
    };

    const handleMouseLeave = () => {
      targetMouse[0] = 0.5;
      targetMouse[1] = 0.5;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvas.addEventListener('touchend', handleMouseLeave);

    const rgb1 = hexToRgb(resolvedColor1);
    const rgb2 = hexToRgb(resolvedColor2);
    const rgb3 = hexToRgb(resolvedColor3);
    const flatColors = new Float32Array(effectiveColors.slice(0, 4).flatMap(hexToRgb));

    const t0 = performance.now();
    let raf: number;

    const render = (t: number) => {
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

      gl.uniform2f(locs.res, canvas.width, canvas.height);
      gl.uniform1f(locs.time, (t - t0) * 0.001);
      gl.uniform1f(locs.speed, effectiveSpeed);
      gl.uniform1f(locs.scale, scale);
      gl.uniform1f(locs.detail, detail);
      gl.uniform1f(locs.glow, glow);
      gl.uniform1f(locs.coreSize, Math.max(coreSize, 0.001));
      gl.uniform1f(locs.swirl, swirl);
      gl.uniform1f(locs.fold, fold);
      gl.uniform1f(locs.blackPoint, blackPoint);
      gl.uniform1f(locs.brightness, brightness);
      gl.uniform1f(locs.colorMode, colorModeToFloat(colorMode));
      gl.uniform1f(locs.grain, typeof grain === 'boolean' ? (grain ? 1.0 : 0.0) : grain);
      gl.uniform1f(locs.grainIntensity, grainIntensity);
      gl.uniform1f(locs.opacity, opacity);
      gl.uniform1f(locs.amplitude, amplitude);
      gl.uniform1f(locs.blend, blend);
      gl.uniform2f(locs.mouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.mouseStrength, mouseStrength);
      gl.uniform1i(locs.enableMouse, mouseInteraction ? 1 : 0);
      gl.uniform3f(locs.color1, ...rgb1);
      gl.uniform3f(locs.color2, ...rgb2);
      gl.uniform3f(locs.color3, ...rgb3);
      gl.uniform1i(locs.pattern, patternIdx);
      gl.uniform3f(locs.bg, ...hexToRgb(bg));
      gl.uniform3fv(locs.colors, flatColors);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);

    return () => {
      clearTimeout(timeoutId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resize);
      }
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleMouseLeave);
      try {
        gl.deleteProgram(program);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        gl.deleteBuffer(buffer);
      } catch (e) {}
    };
  }, [
    bg,
    effectiveColors,
    resolvedColor1,
    resolvedColor2,
    resolvedColor3,
    effectiveSpeed,
    scale,
    detail,
    glow,
    coreSize,
    swirl,
    fold,
    blackPoint,
    brightness,
    colorMode,
    grain,
    grainIntensity,
    amplitude,
    blend,
    mouseInteraction,
    mouseStrength,
    opacity,
    patternIdx,
  ]);

  // Mobile Native HTML payload for WebGL rendering
  const nativeHtml = useMemo(() => {
    if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') return '';
    const config = {
      speed: effectiveSpeed,
      scale,
      detail,
      glow,
      coreSize: Math.max(coreSize, 0.001),
      swirl,
      fold,
      blackPoint,
      brightness,
      colorMode: colorModeToFloat(colorMode),
      grain: typeof grain === 'boolean' ? (grain ? 1.0 : 0.0) : grain,
      grainIntensity,
      opacity,
      amplitude,
      blend,
      mouseStrength,
      enableMouse: mouseInteraction,
      color1: hexToRgb(resolvedColor1),
      color2: hexToRgb(resolvedColor2),
      color3: hexToRgb(resolvedColor3),
      pattern: patternIdx,
      bg: hexToRgb(bg),
      colors: effectiveColors.slice(0, 4).flatMap(hexToRgb),
    };
    return generateShaderHTML(vertexShaderGLSL, fragmentShaderGLSL, config);
  }, [
    bg,
    effectiveColors,
    resolvedColor1,
    resolvedColor2,
    resolvedColor3,
    effectiveSpeed,
    scale,
    detail,
    glow,
    coreSize,
    swirl,
    fold,
    blackPoint,
    brightness,
    colorMode,
    grain,
    grainIntensity,
    amplitude,
    blend,
    mouseInteraction,
    mouseStrength,
    opacity,
    patternIdx,
  ]);

  const containerStyle = [
    styles.webContainer,
    height ? { height } : null,
    style,
  ];

  // Mobile Native Rendering: Run the EXACT WebGL shader via hardware-accelerated transparent WebView
  if (Platform.OS !== 'web') {
    if (process.env.NODE_ENV === 'test') {
      return (
        <View style={[styles.fallbackContainer, height ? { height } : null, style]}>
          {children}
        </View>
      );
    }

    // Lazy load WebView on native to avoid any web bundling issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebView } = require('react-native-webview');

    return (
      <View style={containerStyle}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <WebView
            originWhitelist={['*']}
            source={{ html: nativeHtml }}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
            containerStyle={{ backgroundColor: 'transparent' }}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            androidLayerType="hardware"
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowsInlineMediaPlayback={true}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        </View>
        <View style={styles.childrenWrapper}>{children}</View>
      </View>
    );
  }

  // Web Browser Rendering: Run direct WebGL Canvas
  return (
    <View ref={containerRef} style={containerStyle}>
      {/* @ts-ignore */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 1.0,
        }}
      />
      <View style={styles.childrenWrapper}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  webContainer: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
  },
  fallbackContainer: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
  },
  childrenWrapper: {
    position: 'relative',
    zIndex: 10,
    width: '100%',
  },
});

export const Velaris = VelarisShader;
export default VelarisShader;
