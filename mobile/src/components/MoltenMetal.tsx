import React, { useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

export type MoltenMetalColorMode = 'molten' | 'ember' | 'frost';

export interface MoltenMetalProps {
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
  grain?: boolean;
  grainIntensity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  opacity?: number;
  className?: string;
  style?: any;
  height?: string | number;
  children?: React.ReactNode;
}

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
uniform vec2  u_mouse;
uniform float u_mouseStrength;
uniform int   u_enableMouse;
uniform vec3  u_color1;
uniform vec3  u_color2;
uniform vec3  u_color3;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
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
}
`;

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
};

const colorModeToFloat = (mode: MoltenMetalColorMode = 'molten'): number =>
  mode === 'ember' ? 1 : mode === 'frost' ? 2 : 0;

const generateMoltenHTML = (config: any): string => `
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
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true }) ||
             canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
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
      mouse: gl.getUniformLocation(program, 'u_mouse'),
      mouseStrength: gl.getUniformLocation(program, 'u_mouseStrength'),
      enableMouse: gl.getUniformLocation(program, 'u_enableMouse'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3')
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
      gl.uniform1f(locs.grain, config.grain ? 1.0 : 0.0);
      gl.uniform1f(locs.grainIntensity, config.grainIntensity);
      gl.uniform1f(locs.opacity, config.opacity);
      gl.uniform2f(locs.mouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.mouseStrength, config.mouseStrength);
      gl.uniform1i(locs.enableMouse, config.enableMouse ? 1 : 0);
      gl.uniform3f(locs.color1, config.color1[0], config.color1[1], config.color1[2]);
      gl.uniform3f(locs.color2, config.color2[0], config.color2[1], config.color2[2]);
      gl.uniform3f(locs.color3, config.color3[0], config.color3[1], config.color3[2]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  })();
</script>
</body>
</html>
`;

export const MoltenMetal: React.FC<MoltenMetalProps> = ({
  color1 = '#5227FF',
  color2 = '#FF9FFC',
  color3 = '#FFFFFF',
  speed = 0.35,
  scale = 4,
  detail = 3,
  glow = 1.6,
  coreSize = 0.1,
  swirl = 1,
  fold = -0.2,
  blackPoint = 0.05,
  brightness = 1.3,
  colorMode = 'molten',
  grain = true,
  grainIntensity = 0.05,
  mouseInteraction = true,
  mouseStrength = 0.3,
  opacity = 1.0,
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
      canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true }) ||
      canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
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
      mouse: gl.getUniformLocation(program, 'u_mouse'),
      mouseStrength: gl.getUniformLocation(program, 'u_mouseStrength'),
      enableMouse: gl.getUniformLocation(program, 'u_enableMouse'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3'),
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

    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    const rgb3 = hexToRgb(color3);

    const t0 = performance.now();
    let raf: number;

    const render = (t: number) => {
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

      gl.uniform2f(locs.res, canvas.width, canvas.height);
      gl.uniform1f(locs.time, (t - t0) * 0.001);
      gl.uniform1f(locs.speed, speed);
      gl.uniform1f(locs.scale, scale);
      gl.uniform1f(locs.detail, detail);
      gl.uniform1f(locs.glow, glow);
      gl.uniform1f(locs.coreSize, Math.max(coreSize, 0.001));
      gl.uniform1f(locs.swirl, swirl);
      gl.uniform1f(locs.fold, fold);
      gl.uniform1f(locs.blackPoint, blackPoint);
      gl.uniform1f(locs.brightness, brightness);
      gl.uniform1f(locs.colorMode, colorModeToFloat(colorMode));
      gl.uniform1f(locs.grain, grain ? 1.0 : 0.0);
      gl.uniform1f(locs.grainIntensity, grainIntensity);
      gl.uniform1f(locs.opacity, opacity);
      gl.uniform2f(locs.mouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(locs.mouseStrength, mouseStrength);
      gl.uniform1i(locs.enableMouse, mouseInteraction ? 1 : 0);
      gl.uniform3f(locs.color1, ...rgb1);
      gl.uniform3f(locs.color2, ...rgb2);
      gl.uniform3f(locs.color3, ...rgb3);

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
    color1,
    color2,
    color3,
    speed,
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
    mouseInteraction,
    mouseStrength,
    opacity,
  ]);

  const nativeHtml = useMemo(() => {
    if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') return '';
    const config = {
      speed,
      scale,
      detail,
      glow,
      coreSize: Math.max(coreSize, 0.001),
      swirl,
      fold,
      blackPoint,
      brightness,
      colorMode: colorModeToFloat(colorMode),
      grain,
      grainIntensity,
      opacity,
      mouseStrength,
      enableMouse: mouseInteraction,
      color1: hexToRgb(color1),
      color2: hexToRgb(color2),
      color3: hexToRgb(color3),
    };
    return generateMoltenHTML(config);
  }, [
    color1,
    color2,
    color3,
    speed,
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
    mouseInteraction,
    mouseStrength,
    opacity,
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

export default MoltenMetal;
