import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { aiApi } from "../api/client";
import { usePlayerStore } from "../store";

type Props = {
  currentSongId?: string;
};

/**
 * Minimal AI Mic - push-to-talk.
 * States: 🎤 Idle | 🔴 Listening | ⏳ Thinking | ▶️ Executing | ✓ Done | ⚠️ Failed
 * For now uses transcript_fallback (typed) until expo-audio recording is wired.
 */
export const AiMicButton: React.FC<Props> = ({ currentSongId }) => {
  const [state, setState] = useState<"idle"|"thinking"|"done"|"failed">("idle");
  const [lastResponse, setLastResponse] = useState<string>("");

  const handleText = async (text: string) => {
    try {
      setState("thinking");
      const res = await aiApi.text(text, { currentSongId, playing: true });
      const data: any = res.data;
      setLastResponse(data.response || JSON.stringify(data.actions));
      setState("done");
      // If AI returned PLAY_BY_MOOD etc., dispatcher already queued via backend; just refresh queue
      setTimeout(()=> setState("idle"), 2500);
    } catch (e: any) {
      setLastResponse(e?.response?.data?.message || e.message);
      setState("failed");
      setTimeout(()=> setState("idle"), 2500);
    }
  };

  // Temporary: demo buttons for P1 without microphone
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.mic, state==="thinking"&&styles.micThinking]} onPress={()=> handleText("next song")} disabled={state==="thinking"}>
          {state==="thinking" ? <ActivityIndicator color="#fff"/> : <Text style={styles.micText}>🎤</Text>}
        </TouchableOpacity>
        <Text style={styles.state}>{state==="idle"?"Tap to test: next / pause / Play calm Tamil":"⏳ "+state}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.chip} onPress={()=> handleText("next song")}><Text>⏭ Next</Text></TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={()=> handleText("pause the song")}><Text>⏸ Pause</Text></TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={()=> handleText("Play calm Tamil songs")}><Text>🎵 Calm Tamil</Text></TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={()=> handleText("Play energetic songs")}><Text>⚡ Energetic</Text></TouchableOpacity>
      </View>
      {lastResponse ? <Text style={styles.response}>{lastResponse}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  mic: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#1DB954", alignItems:"center", justifyContent:"center" },
  micThinking: { backgroundColor: "#191414" },
  micText: { fontSize: 28 },
  state: { color: "#b3b3b3", flex:1 },
  actions: { flexDirection:"row", flexWrap:"wrap", gap: 8 },
  chip: { paddingHorizontal:12, paddingVertical:8, backgroundColor:"#282828", borderRadius:20 },
  response: { color:"#1DB954", fontSize:12, marginTop:4},
});
