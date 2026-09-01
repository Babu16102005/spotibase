"use client";
import * as React from "react";
import { Platform, View } from "react-native";

// WebView for native to render exact CSS conic-gradient orb
let WebView: any = null;
if (Platform.OS !== "web") {
  try { WebView = require("react-native-webview").WebView; } catch {}
}

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

export interface SiriOrbProps {
  animationDuration?: number;
  className?: string;
  colors?: { bg?: string; c1?: string; c2?: string; c3?: string };
  size?: string;
  /** For native WebView fallback */
  style?: any;
}

export const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "72px",
  className,
  colors,
  animationDuration = 20,
  style,
}) => {
  const defaultColors = {
    bg: "oklch(95% 0.02 264.695)",
    c1: "oklch(75% 0.15 350)",
    c2: "oklch(80% 0.12 200)",
    c3: "oklch(78% 0.14 280)",
  };
  const finalColors = { ...defaultColors, ...colors };
  const sizeValue = Number.parseInt(size.replace("px", ""), 10);
  const blurAmount = sizeValue < SIZE_THRESHOLD_SMALL ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL) : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);
  const contrastAmount = sizeValue < SIZE_THRESHOLD_SMALL ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL) : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);
  const dotSize = sizeValue < SIZE_THRESHOLD_SMALL ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL) : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);
  const shadowSpread = sizeValue < SIZE_THRESHOLD_SMALL ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL) : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);
  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };
  const maskRadius = getMaskRadius(sizeValue);
  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return Math.max(contrastAmount * CONTRAST_MULTIPLIER_FINAL, CONTRAST_MIN_FINAL);
    return contrastAmount;
  };
  const finalContrast = getFinalContrast(sizeValue);

  // Native: render via WebView with same HTML/CSS for pixel-perfect conic-gradient
  if (Platform.OS !== "web" && WebView) {
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
      html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
      .siri-orb{display:grid;grid-template-areas:"stack";overflow:hidden;border-radius:50%;width:${size};height:${size};position:relative}
      .siri-orb::before,.siri-orb::after{content:"";display:block;grid-area:stack;width:100%;height:100%;border-radius:50%}
      .siri-orb::before{background:conic-gradient(from calc(var(--angle) * 2) at 25% 70%,${finalColors.c3},transparent 20% 80%,${finalColors.c3}),conic-gradient(from calc(var(--angle) * 2) at 45% 75%,${finalColors.c2},transparent 30% 60%,${finalColors.c2}),conic-gradient(from calc(var(--angle) * -3) at 80% 20%,${finalColors.c1},transparent 40% 60%,${finalColors.c1}),conic-gradient(from calc(var(--angle) * 2) at 15% 5%,${finalColors.c2},transparent 10% 90%,${finalColors.c2}),conic-gradient(from calc(var(--angle) * 1) at 20% 80%,${finalColors.c1},transparent 10% 90%,${finalColors.c1}),conic-gradient(from calc(var(--angle) * -2) at 85% 10%,${finalColors.c3},transparent 20% 80%,${finalColors.c3});box-shadow:inset ${finalColors.bg} 0 0 ${shadowSpread}px calc(${shadowSpread}px * 0.2);filter:blur(${blurAmount}px) contrast(${finalContrast});animation:rotate ${animationDuration}s linear infinite}
      .siri-orb::after{background-image:radial-gradient(circle at center,${finalColors.bg} ${dotSize}px,transparent ${dotSize}px);background-size:calc(${dotSize}px * 2) calc(${dotSize}px * 2);backdrop-filter:blur(calc(${blurAmount}px * 2)) contrast(calc(${finalContrast} * 2));mix-blend-mode:overlay}
      ${maskRadius === "0%" ? ".siri-orb::after{mask-image:none}" : `.siri-orb::after{mask-image:radial-gradient(black ${maskRadius},transparent 75%)}`}
      @keyframes rotate{to{--angle:360deg}}
    </style></head><body><div class="siri-orb"></div></body></html>`;
    const numSize = sizeValue;
    return (
      <View style={[{ width: numSize, height: numSize, overflow: "hidden", borderRadius: numSize / 2 }, style]}>
        <WebView
          originWhitelist={["*"]}
          source={{ html }}
          style={{ width: numSize, height: numSize, backgroundColor: "transparent" }}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
        />
      </View>
    );
  }

  // Web: exact original DOM + CSS
  return (
    <div
      className={cn("siri-orb", className)}
      style={
        {
          width: size,
          height: size,
          // @ts-ignore CSS vars
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": finalContrast,
          "--dot-size": `${dotSize}px`,
          "--shadow-spread": `${shadowSpread}px`,
          "--mask-radius": maskRadius,
          ...(style || {}),
        } as React.CSSProperties
      }
    >
      <style>{`
        @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
        .siri-orb { display: grid; grid-template-areas: "stack"; overflow: hidden; border-radius: 50%; position: relative; }
        .siri-orb::before,.siri-orb::after{content:"";display:block;grid-area:stack;width:100%;height:100%;border-radius:50%}
        .siri-orb::before{background:conic-gradient(from calc(var(--angle) * 2) at 25% 70%,var(--c3),transparent 20% 80%,var(--c3)),conic-gradient(from calc(var(--angle) * 2) at 45% 75%,var(--c2),transparent 30% 60%,var(--c2)),conic-gradient(from calc(var(--angle) * -3) at 80% 20%,var(--c1),transparent 40% 60%,var(--c1)),conic-gradient(from calc(var(--angle) * 2) at 15% 5%,var(--c2),transparent 10% 90%,var(--c2)),conic-gradient(from calc(var(--angle) * 1) at 20% 80%,var(--c1),transparent 10% 90%,var(--c1)),conic-gradient(from calc(var(--angle) * -2) at 85% 10%,var(--c3),transparent 20% 80%,var(--c3));box-shadow:inset var(--bg) 0 0 var(--shadow-spread) calc(var(--shadow-spread) * 0.2);filter:blur(var(--blur-amount)) contrast(var(--contrast-amount));animation:rotate var(--animation-duration) linear infinite}
        .siri-orb::after{background-image:radial-gradient(circle at center,var(--bg) var(--dot-size),transparent var(--dot-size));background-size:calc(var(--dot-size) * 2) calc(var(--dot-size) * 2);backdrop-filter:blur(calc(var(--blur-amount) * 2)) contrast(calc(var(--contrast-amount) * 2));mix-blend-mode:overlay}
        .siri-orb[style*="--mask-radius: 0%"]::after{mask-image:none}
        .siri-orb:not([style*="--mask-radius: 0%"])::after{mask-image:radial-gradient(black var(--mask-radius),transparent 75%)}
        @keyframes rotate{to{--angle:360deg}}
        @media (prefers-reduced-motion: reduce){.siri-orb::before{animation:none}}
      `}</style>
    </div>
  );
};

export default SiriOrb;
export const Component = SiriOrb;
