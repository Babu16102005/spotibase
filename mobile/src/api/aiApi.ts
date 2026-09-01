import apiClient from "./client";

export const aiApi = {
  text: (text: string, context?: any) =>
    apiClient.post("/ai/text", { text, context }),

  voice: (audioUri: string, transcriptFallback?: string, context?: any, filename = "audio.webm") => {
    const formData = new FormData();
    formData.append("audio", {
      uri: audioUri,
      name: filename,
      type: "audio/webm",
    } as unknown as Blob);
    if (transcriptFallback) formData.append("transcript_fallback", transcriptFallback);
    if (context) formData.append("context", JSON.stringify(context));
    return apiClient.post("/ai/voice", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 30000,
    });
  },

  health: () => apiClient.get("/ai/health"),
};

export default aiApi;
