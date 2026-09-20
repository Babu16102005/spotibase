"use client";
import * as React from "react";
import { Platform, View } from "react-native";

let WebView: any = null;
if (Platform.OS !== "web") {
  try { WebView = require("react-native-webview").WebView; } catch {}
}

export interface StarOrbProps {
  size?: string;
  style?: any;
}

export const StarOrb: React.FC<StarOrbProps> = ({ size = "58px", style }) => {
  const sizeValue = Number.parseInt(size.replace("px", ""), 10);
  // Scale inner orb sizes proportionally to container
  const orbSize = sizeValue;
  const innerScale = 1.6; // 160% as per CSS

  if (Platform.OS !== "web" && WebView) {
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
      .orb-container{position:relative;width:${orbSize}px;height:${orbSize}px;display:flex;justify-content:center;align-items:center;overflow:hidden;border-radius:50%;transform:rotate(90deg);filter:drop-shadow(0 0 10px #ff3e1caa) drop-shadow(0 0 10px #1c8cffaa)}
      .orb{position:absolute;width:${orbSize}px;aspect-ratio:1;border-radius:50%;background:#060606;filter:blur(8px)}
      .orb-inner{position:absolute;left:-120%;top:-25%;width:${innerScale * 100}%;aspect-ratio:1;border-radius:50%;background:#ff3e1c;clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);animation:rotate 6s linear infinite}
      .orb-inner:nth-child(2){left:auto;right:-120%;top:auto;bottom:-25%;background:#1c8cff;animation-duration:8s;clip-path:polygon(20% 0%,0% 20%,30% 50%,0% 80%,20% 100%,50% 70%,80% 100%,100% 80%,70% 50%,100% 20%,80% 0%,50% 30%)}
      @keyframes rotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    </style></head><body><div class="orb-container"><div class="orb"><div class="orb-inner"></div><div class="orb-inner"></div></div></div></body></html>`;
    return (
      <View style={[{ width: orbSize, height: orbSize, overflow: "hidden", borderRadius: orbSize / 2, transform: [{ rotate: "90deg" }] }, style]}>
        <WebView
          originWhitelist={["*"]}
          source={{ html }}
          style={{ width: orbSize, height: orbSize, backgroundColor: "transparent" }}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
        />
      </View>
    );
  }

  // Web: exact CSS from Uiverse
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        borderRadius: "50%",
        ...(style || {}),
      }}
    >
      <div className="orb-container" style={{ width: orbSize, height: orbSize } as React.CSSProperties}>
        <div className="orb">
          <div className="orb-inner" />
          <div className="orb-inner" />
        </div>
      </div>
      <style>{`
        .orb-container {
          position: relative;
          width: ${orbSize}px;
          height: ${orbSize}px;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          border-radius: 50%;
          rotate: 90deg;
          cursor: pointer;
          filter: drop-shadow(0 0 10px #ff3e1caa) drop-shadow(0 0 10px #1c8cffaa);
          transition: all 0.3s ease;
        }
        .orb {
          position: absolute;
          width: ${orbSize}px;
          aspect-ratio: 1;
          border-radius: 50%;
          background: #060606;
          filter: blur(8px);
          transition: all 0.3s ease;
        }
        .orb-container:hover .orb {
          width: ${orbSize + 12}px;
          animation: rotateStar 6s infinite;
        }
        @keyframes rotateStar {
          50% { transform: rotate(180deg); }
        }
        .orb-inner {
          position: absolute;
          left: -120%;
          top: -25%;
          width: ${innerScale * 100}%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: #ff3e1c;
          clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
          animation: rotate 6s linear infinite;
          transition: all 0.3s ease;
        }
        .orb-inner:nth-child(2) {
          left: auto;
          right: -120%;
          top: auto;
          bottom: -25%;
          background: #1c8cff;
          animation-duration: 8s;
          clip-path: polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%);
        }
        @keyframes rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default StarOrb;
