'use client';
import React, { useEffect, useRef } from 'react';
import { Platform, View, StyleSheet } from 'react-native';

let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch {}
}

export interface StrandsProps {
  colors?: string[];
  count?: number;
  speed?: number;
  amplitude?: number;
  waviness?: number;
  thickness?: number;
  glow?: number;
  taper?: number;
  spread?: number;
  hueShift?: number;
  intensity?: number;
  saturation?: number;
  opacity?: number;
  scale?: number;
  glass?: boolean;
  refraction?: number;
  dispersion?: number;
  glassSize?: number;
  className?: string;
  style?: any;
  size?: number | string;
}

const MAX_STRANDS = 12;
const MAX_COLORS = 8;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity;

  fragColor = vec4(col * uOpacity, alpha);
}
`;

const GLASS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uRefraction;
uniform float uDispersion;

out vec4 fragColor;

vec2 toUv(vec2 p) {
  return p * (uResolution.y / uResolution) + 0.5;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float d = length(p);
  float r = uRadius;

  float edge = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(r - edge, r + edge, d);
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // sphere height: 0 at the rim, 1 at the center
  float z = sqrt(max(r * r - d * d, 0.0)) / r;
  float nd = d / r; // 0 at the center, 1 at the rim

  // refraction is confined to a narrow band near the rim; the rest stays undistorted
  vec2 dir = d > 0.0 ? p / d : vec2(0.0);
  float lens = smoothstep(0.85, 1.0, nd) * pow(nd, 6.0);
  vec2 offset = -dir * lens * uRefraction * 0.15;
  vec2 disp = -dir * lens * uDispersion * 0.012;

  vec3 light;
  light.r = texture(uScene, toUv(p + offset - disp)).r;
  light.g = texture(uScene, toUv(p + offset)).g;
  light.b = texture(uScene, toUv(p + offset + disp)).b;

  // neutral fresnel rim (no color tint so the glass stays clear)
  float fres = pow(1.0 - z, 3.0);
  vec3 rim = vec3(1.0) * fres * 0.18;

  // specular highlight from the upper-left
  vec2 lightDir = normalize(vec2(-0.55, 0.6));
  float spec = pow(max(dot(p / max(r, 1e-4), lightDir), 0.0), 6.0);
  spec *= smoothstep(r, r * 0.55, d);

  vec3 emissive = light + rim + vec3(spec) * 0.4;
  float emissiveA = clamp(max(max(emissive.r, emissive.g), emissive.b), 0.0, 1.0);

  // almost clear glass body: only a faint neutral darkening, mostly near the rim
  float bodyA = 0.05 + fres * 0.05;

  // composite emissive light over the clear body (premultiplied)
  float outA = emissiveA + bodyA * (1.0 - emissiveA);
  vec3 outRGB = emissive;

  outRGB *= mask;
  outA *= mask;

  fragColor = vec4(outRGB, outA);
}
`;

export const Strands: React.FC<StrandsProps> = ({
  colors = ['#FF4242', '#7C3AED', '#06B6D4', '#EAB308'],
  count = 3,
  speed = 0.5,
  amplitude = 1,
  waviness = 1,
  thickness = 0.7,
  glow = 2.6,
  taper = 3,
  spread = 1,
  hueShift = 0,
  intensity = 0.6,
  saturation = 1.5,
  opacity = 1,
  scale = 1.5,
  glass = false,
  refraction = 1,
  dispersion = 1,
  glassSize = 1,
  className = '',
  style,
  size,
}) => {
  const numSize =
    typeof size === 'number'
      ? size
      : typeof size === 'string'
      ? Number.parseInt(size.replace('px', ''), 10) || 58
      : 58;

  const propsRef = useRef<any>({});
  propsRef.current = {
    colors,
    count,
    speed,
    amplitude,
    waviness,
    thickness,
    glow,
    taper,
    spread,
    hueShift,
    intensity,
    saturation,
    opacity,
    scale,
    glass,
    refraction,
    dispersion,
    glassSize,
  };

  const ctnDom = useRef<any>(null);

  // Web Implementation using OGL
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const ctn = ctnDom.current;
    if (!ctn || typeof window === 'undefined') return;

    let Renderer: any, Program: any, Mesh: any, Color: any, Triangle: any, RenderTarget: any;
    try {
      const ogl = require('ogl');
      Renderer = ogl.Renderer;
      Program = ogl.Program;
      Mesh = ogl.Mesh;
      Color = ogl.Color;
      Triangle = ogl.Triangle;
      RenderTarget = ogl.RenderTarget;
    } catch {
      return;
    }

    const buildPalette = (cols: string[]) => {
      const filled = cols && cols.length ? cols : ['#ffffff'];
      const padded: number[][] = [];
      for (let i = 0; i < MAX_COLORS; i++) {
        const hex = filled[i] ?? filled[filled.length - 1];
        const c = new Color(hex);
        padded.push([c.r, c.g, c.b]);
      }
      return padded;
    };

    let renderer: any;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    if (!gl) return;

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (gl.canvas) {
      gl.canvas.style.backgroundColor = 'transparent';
      gl.canvas.style.display = 'block';
      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';
    }

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv;
    }

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [ctn.offsetWidth || numSize, ctn.offsetHeight || numSize] },
        uColors: { value: buildPalette(propsRef.current.colors) },
        uColorCount: { value: Math.min(propsRef.current.colors.length, MAX_COLORS) },
        uStrandCount: { value: Math.min(propsRef.current.count, MAX_STRANDS) },
        uSpeed: { value: speed },
        uAmplitude: { value: amplitude },
        uWaviness: { value: waviness },
        uThickness: { value: thickness },
        uGlow: { value: glow },
        uTaper: { value: taper },
        uSpread: { value: spread },
        uHueShift: { value: hueShift },
        uIntensity: { value: intensity },
        uOpacity: { value: opacity },
        uScale: { value: scale },
        uSaturation: { value: saturation },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    const renderTarget = new RenderTarget(gl, {
      width: ctn.offsetWidth || numSize,
      height: ctn.offsetHeight || numSize,
    });

    const glassProgram = new Program(gl, {
      vertex: VERT,
      fragment: GLASS_FRAG,
      uniforms: {
        uScene: { value: renderTarget.texture },
        uResolution: { value: [ctn.offsetWidth || numSize, ctn.offsetHeight || numSize] },
        uRadius: { value: 0.46 * glassSize },
        uRefraction: { value: refraction },
        uDispersion: { value: dispersion },
      },
    });
    const glassMesh = new Mesh(gl, { geometry, program: glassProgram });

    if (gl.canvas) {
      ctn.appendChild(gl.canvas);
    }

    function resize() {
      if (!ctn) return;
      const width = ctn.offsetWidth || numSize;
      const height = ctn.offsetHeight || numSize;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
      renderTarget.setSize(width, height);
      glassProgram.uniforms.uResolution.value = [width, height];
    }
    window.addEventListener('resize', resize);
    resize();

    let animateId = 0;
    const update = (t: number) => {
      animateId = requestAnimationFrame(update);
      const current = propsRef.current;
      program.uniforms.uTime.value = t * 0.001;
      program.uniforms.uColors.value = buildPalette(current.colors);
      program.uniforms.uColorCount.value = Math.min(current.colors.length, MAX_COLORS);
      program.uniforms.uStrandCount.value = Math.min(Math.max(Math.round(current.count), 1), MAX_STRANDS);
      program.uniforms.uSpeed.value = current.speed;
      program.uniforms.uAmplitude.value = current.amplitude;
      program.uniforms.uWaviness.value = current.waviness;
      program.uniforms.uThickness.value = current.thickness;
      program.uniforms.uGlow.value = current.glow;
      program.uniforms.uTaper.value = current.taper;
      program.uniforms.uSpread.value = current.spread;
      program.uniforms.uHueShift.value = current.hueShift;
      program.uniforms.uIntensity.value = current.intensity;
      program.uniforms.uOpacity.value = current.opacity;
      program.uniforms.uScale.value = current.scale;
      program.uniforms.uSaturation.value = current.saturation;

      if (current.glass) {
        renderer.render({ scene: mesh, target: renderTarget });
        glassProgram.uniforms.uScene.value = renderTarget.texture;
        glassProgram.uniforms.uRefraction.value = current.refraction;
        glassProgram.uniforms.uDispersion.value = current.dispersion;
        glassProgram.uniforms.uRadius.value = 0.46 * current.glassSize;
        renderer.render({ scene: glassMesh });
      } else {
        renderer.render({ scene: mesh });
      }
    };
    animateId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener('resize', resize);
      if (ctn && gl.canvas && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [numSize]);

  // Native: render self-contained WebGL via WebView
  if (Platform.OS !== 'web' && WebView) {
    const jsonConfig = JSON.stringify({
      colors,
      count,
      speed,
      amplitude,
      waviness,
      thickness,
      glow,
      taper,
      spread,
      hueShift,
      intensity,
      saturation,
      opacity,
      scale,
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    canvas { display: block; width: 100%; height: 100%; background: transparent; }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    (function() {
      var cfg = ${jsonConfig};
      var canvas = document.getElementById('c');
      var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
      if (!gl) return;

      var vertSrc = \`${VERT}\`;
      var fragSrc = \`${FRAG}\`;

      function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      }

      var prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      var quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

      var posLoc = gl.getAttribLocation(prog, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      var uTime = gl.getUniformLocation(prog, 'uTime');
      var uRes = gl.getUniformLocation(prog, 'uResolution');
      var uColors = gl.getUniformLocation(prog, 'uColors');
      var uColorCount = gl.getUniformLocation(prog, 'uColorCount');
      var uStrandCount = gl.getUniformLocation(prog, 'uStrandCount');
      var uSpeed = gl.getUniformLocation(prog, 'uSpeed');
      var uAmplitude = gl.getUniformLocation(prog, 'uAmplitude');
      var uWaviness = gl.getUniformLocation(prog, 'uWaviness');
      var uThickness = gl.getUniformLocation(prog, 'uThickness');
      var uGlow = gl.getUniformLocation(prog, 'uGlow');
      var uTaper = gl.getUniformLocation(prog, 'uTaper');
      var uSpread = gl.getUniformLocation(prog, 'uSpread');
      var uHueShift = gl.getUniformLocation(prog, 'uHueShift');
      var uIntensity = gl.getUniformLocation(prog, 'uIntensity');
      var uOpacity = gl.getUniformLocation(prog, 'uOpacity');
      var uScale = gl.getUniformLocation(prog, 'uScale');
      var uSaturation = gl.getUniformLocation(prog, 'uSaturation');

      function hexToRgb(h) {
        var c = h.replace('#', '');
        if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
        var n = parseInt(c, 16);
        return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      }

      function buildPalette(cols) {
        var flat = [];
        var src = cols && cols.length ? cols : ['#ffffff'];
        for (var i = 0; i < 8; i++) {
          var hex = src[i] || src[src.length - 1];
          var rgb = hexToRgb(hex);
          flat.push(rgb[0], rgb[1], rgb[2]);
        }
        return new Float32Array(flat);
      }

      function resize() {
        var w = window.innerWidth;
        var h = window.innerHeight;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
      }
      window.addEventListener('resize', resize);
      resize();

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      var p = buildPalette(cfg.colors);
      gl.uniform3fv(uColors, p);
      gl.uniform1i(uColorCount, Math.min(cfg.colors.length, 8));
      gl.uniform1i(uStrandCount, Math.min(cfg.count, 12));
      gl.uniform1f(uSpeed, cfg.speed);
      gl.uniform1f(uAmplitude, cfg.amplitude);
      gl.uniform1f(uWaviness, cfg.waviness);
      gl.uniform1f(uThickness, cfg.thickness);
      gl.uniform1f(uGlow, cfg.glow);
      gl.uniform1f(uTaper, cfg.taper);
      gl.uniform1f(uSpread, cfg.spread);
      gl.uniform1f(uHueShift, cfg.hueShift);
      gl.uniform1f(uIntensity, cfg.intensity);
      gl.uniform1f(uOpacity, cfg.opacity);
      gl.uniform1f(uScale, cfg.scale);
      gl.uniform1f(uSaturation, cfg.saturation);

      function loop(t) {
        gl.uniform1f(uTime, t * 0.001);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    })();
  </script>
</body>
</html>`;

    return (
      <View
        style={[
          styles.container,
          { width: numSize, height: numSize, borderRadius: numSize / 2, overflow: 'hidden' },
          style,
        ]}
      >
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={{ width: numSize, height: numSize, backgroundColor: 'transparent' }}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
        />
      </View>
    );
  }

  // Web render
  return (
    <div
      ref={ctnDom}
      className={`strands-container ${className}`}
      style={
        {
          width: typeof size === 'number' ? `${size}px` : size || '100%',
          height: typeof size === 'number' ? `${size}px` : size || '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          position: 'relative',
          ...(style || {}),
        } as React.CSSProperties
      }
    />
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default Strands;
