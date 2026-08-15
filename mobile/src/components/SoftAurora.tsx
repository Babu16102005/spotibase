import React, { useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

export interface SoftAuroraProps {
  speed?: number;
  scale?: number;
  brightness?: number;
  color1?: string;
  color2?: string;
  noiseFrequency?: number;
  noiseAmplitude?: number;
  bandHeight?: number;
  bandSpread?: number;
  octaveDecay?: number;
  layerOffset?: number;
  colorSpeed?: number;
  enableMouseInteraction?: boolean;
  mouseInfluence?: number;
  style?: any;
  height?: string | number;
  children?: React.ReactNode;
}

export type AuroraProps = SoftAuroraProps;

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

uniform float uTime;
uniform vec3  uResolution;
uniform float uSpeed;
uniform float uScale;
uniform float uBrightness;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uBandHeight;
uniform float uBandSpread;
uniform float uOctaveDecay;
uniform float uLayerOffset;
uniform float uColorSpeed;
uniform vec2  uMouse;
uniform float uMouseInfluence;
uniform bool  uEnableMouse;

#define TAU 6.28318530718

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

float auroraGlow(float t, vec2 shift) {
  vec2 uv = gl_FragCoord.xy / uResolution.y;
  uv += shift;

  float noiseVal = 0.0;
  float freq = uNoiseFreq;
  float amp = uNoiseAmp;
  vec2 samplePos = uv * uScale;

  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= uOctaveDecay;
    freq *= 2.0;
  }

  float yBand = uv.y * 10.0 - uBandHeight * 10.0;
  return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float t = uSpeed * 0.4 * uTime;

  vec2 shift = vec2(0.0);
  if (uEnableMouse) {
    shift = (uMouse - 0.5) * uMouseInfluence;
  }

  vec3 col = vec3(0.0);
  col += 0.99 * auroraGlow(t, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * uColor1;
  col += 0.99 * auroraGlow(t + uLayerOffset, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * uColor2;

  col *= uBrightness;
  float alpha = clamp(length(col), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

const hexToVec3 = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

const generateSoftAuroraHTML = (config: any): string => `
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

    var vertSrc = ${JSON.stringify(vertexShaderGLSL)};
    var fragSrc = ${JSON.stringify(fragmentShaderGLSL)};

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
      uTime: gl.getUniformLocation(program, 'uTime'),
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uSpeed: gl.getUniformLocation(program, 'uSpeed'),
      uScale: gl.getUniformLocation(program, 'uScale'),
      uBrightness: gl.getUniformLocation(program, 'uBrightness'),
      uColor1: gl.getUniformLocation(program, 'uColor1'),
      uColor2: gl.getUniformLocation(program, 'uColor2'),
      uNoiseFreq: gl.getUniformLocation(program, 'uNoiseFreq'),
      uNoiseAmp: gl.getUniformLocation(program, 'uNoiseAmp'),
      uBandHeight: gl.getUniformLocation(program, 'uBandHeight'),
      uBandSpread: gl.getUniformLocation(program, 'uBandSpread'),
      uOctaveDecay: gl.getUniformLocation(program, 'uOctaveDecay'),
      uLayerOffset: gl.getUniformLocation(program, 'uLayerOffset'),
      uColorSpeed: gl.getUniformLocation(program, 'uColorSpeed'),
      uMouse: gl.getUniformLocation(program, 'uMouse'),
      uMouseInfluence: gl.getUniformLocation(program, 'uMouseInfluence'),
      uEnableMouse: gl.getUniformLocation(program, 'uEnableMouse')
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

      gl.uniform1f(locs.uTime, (t - t0) * 0.001);
      gl.uniform3f(locs.uResolution, canvas.width, canvas.height, canvas.width / canvas.height);
      gl.uniform1f(locs.uSpeed, config.speed);
      gl.uniform1f(locs.uScale, config.scale);
      gl.uniform1f(locs.uBrightness, config.brightness);
      gl.uniform3f(locs.uColor1, config.color1[0], config.color1[1], config.color1[2]);
      gl.uniform3f(locs.uColor2, config.color2[0], config.color2[1], config.color2[2]);
      gl.uniform1f(locs.uNoiseFreq, config.noiseFrequency);
      gl.uniform1f(locs.uNoiseAmp, config.noiseAmplitude);
      gl.uniform1f(locs.uBandHeight, config.bandHeight);
      gl.uniform1f(locs.uBandSpread, config.bandSpread);
      gl.uniform1f(locs.uOctaveDecay, config.octaveDecay);
      gl.uniform1f(locs.uLayerOffset, config.layerOffset);
      gl.uniform1f(locs.uColorSpeed, config.colorSpeed);
      gl.uniform2f(locs.uMouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.uMouseInfluence, config.mouseInfluence);
      gl.uniform1i(locs.uEnableMouse, config.enableMouseInteraction ? 1 : 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  })();
</script>
</body>
</html>
`;

export const SoftAurora: React.FC<SoftAuroraProps> = ({
  speed = 0.6,
  scale = 1.5,
  brightness = 1.0,
  color1 = '#f7f7f7',
  color2 = '#e100ff',
  noiseFrequency = 2.5,
  noiseAmplitude = 1.0,
  bandHeight = 0.5,
  bandSpread = 1.0,
  octaveDecay = 0.1,
  layerOffset = 0,
  colorSpeed = 1.0,
  enableMouseInteraction = true,
  mouseInfluence = 0.25,
  style,
  height,
  children,
}) => {
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<any>(null);

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
      uTime: gl.getUniformLocation(program, 'uTime'),
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uSpeed: gl.getUniformLocation(program, 'uSpeed'),
      uScale: gl.getUniformLocation(program, 'uScale'),
      uBrightness: gl.getUniformLocation(program, 'uBrightness'),
      uColor1: gl.getUniformLocation(program, 'uColor1'),
      uColor2: gl.getUniformLocation(program, 'uColor2'),
      uNoiseFreq: gl.getUniformLocation(program, 'uNoiseFreq'),
      uNoiseAmp: gl.getUniformLocation(program, 'uNoiseAmp'),
      uBandHeight: gl.getUniformLocation(program, 'uBandHeight'),
      uBandSpread: gl.getUniformLocation(program, 'uBandSpread'),
      uOctaveDecay: gl.getUniformLocation(program, 'uOctaveDecay'),
      uLayerOffset: gl.getUniformLocation(program, 'uLayerOffset'),
      uColorSpeed: gl.getUniformLocation(program, 'uColorSpeed'),
      uMouse: gl.getUniformLocation(program, 'uMouse'),
      uMouseInfluence: gl.getUniformLocation(program, 'uMouseInfluence'),
      uEnableMouse: gl.getUniformLocation(program, 'uEnableMouse'),
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

    const rgb1 = hexToVec3(color1);
    const rgb2 = hexToVec3(color2);

    const t0 = performance.now();
    let raf: number;

    const render = (t: number) => {
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

      gl.uniform1f(locs.uTime, (t - t0) * 0.001);
      gl.uniform3f(locs.uResolution, canvas.width, canvas.height, canvas.width / canvas.height);
      gl.uniform1f(locs.uSpeed, speed);
      gl.uniform1f(locs.uScale, scale);
      gl.uniform1f(locs.uBrightness, brightness);
      gl.uniform3f(locs.uColor1, ...rgb1);
      gl.uniform3f(locs.uColor2, ...rgb2);
      gl.uniform1f(locs.uNoiseFreq, noiseFrequency);
      gl.uniform1f(locs.uNoiseAmp, noiseAmplitude);
      gl.uniform1f(locs.uBandHeight, bandHeight);
      gl.uniform1f(locs.uBandSpread, bandSpread);
      gl.uniform1f(locs.uOctaveDecay, octaveDecay);
      gl.uniform1f(locs.uLayerOffset, layerOffset);
      gl.uniform1f(locs.uColorSpeed, colorSpeed);
      gl.uniform2f(locs.uMouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.uMouseInfluence, mouseInfluence);
      gl.uniform1i(locs.uEnableMouse, enableMouseInteraction ? 1 : 0);

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
    speed,
    scale,
    brightness,
    color1,
    color2,
    noiseFrequency,
    noiseAmplitude,
    bandHeight,
    bandSpread,
    octaveDecay,
    layerOffset,
    colorSpeed,
    enableMouseInteraction,
    mouseInfluence,
  ]);

  const nativeHtml = useMemo(() => {
    if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') return '';
    const config = {
      speed,
      scale,
      brightness,
      color1: hexToVec3(color1),
      color2: hexToVec3(color2),
      noiseFrequency,
      noiseAmplitude,
      bandHeight,
      bandSpread,
      octaveDecay,
      layerOffset,
      colorSpeed,
      enableMouseInteraction,
      mouseInfluence,
    };
    return generateSoftAuroraHTML(config);
  }, [
    speed,
    scale,
    brightness,
    color1,
    color2,
    noiseFrequency,
    noiseAmplitude,
    bandHeight,
    bandSpread,
    octaveDecay,
    layerOffset,
    colorSpeed,
    enableMouseInteraction,
    mouseInfluence,
  ]);

  const containerStyle = [
    styles.webContainer,
    height ? { height } : null,
    style,
  ];

  if (Platform.OS !== 'web') {
    if (process.env.NODE_ENV === 'test') {
      return (
        <View style={[styles.fallbackContainer, height ? { height } : null, style]}>
          {children}
        </View>
      );
    }

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

export const Aurora = SoftAurora;
export default SoftAurora;
