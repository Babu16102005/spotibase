import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { youtubeApi } from '../../api/youtubeApi';
import type { YouTubeVideo } from '../../types/youtube';
import { useThemeStore } from '../../store/themeStore';
import { usePlayerStore } from '../../store/playerStore';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import Icon from '../Icon';

interface YouTubePlayerProps {
  video: YouTubeVideo | null;
  autoplay?: boolean;
  onClose?: () => void;
  onError?: (message: string) => void;
  testID?: string;
}

const directEmbedUrl = (videoId: string) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1`;

/** Hosts allowed inside the player iframe. Anything else falls back to nocookie. */
const ALLOWED_EMBED_HOSTS = new Set([
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'www.youtube.com',
  'youtube.com',
]);

/**
 * P1: allowlist backend/derived embed URLs before rendering. Only YouTube
 * embed hosts are rendered; anything else (or an unparsable URL) falls back
 * to the privacy-enhanced nocookie direct embed. Ensures enablejsapi=1 so
 * pause/resume postMessage commands reach the player.
 */
const sanitizeEmbedUrl = (url: string | null | undefined, videoId: string): string => {
  const fallback = directEmbedUrl(videoId);
  if (!url || typeof url !== 'string' || !url.trim()) return fallback;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return fallback;
    if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname.toLowerCase())) return fallback;
    if (!parsed.pathname.startsWith('/embed/')) return fallback;
    if (!parsed.searchParams.has('enablejsapi')) parsed.searchParams.set('enablejsapi', '1');
    return parsed.toString();
  } catch {
    return fallback;
  }
};

const PAUSE_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:''}),'*');}catch(e){}};}catch(e){}return true;})();`;
const PLAY_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'playVideo',args:''}),'*');}catch(e){}};}catch(e){}return true;})();`;

const buildNativeHtml = (embedUrl: string): string => `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<style>html,body{margin:0;padding:0;background:#000;height:100%;}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;}</style>
</head>
<body>
<iframe id="ytplayer" src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
<script>
window.__spotibasePause = function(){try{var f=document.getElementById('ytplayer');if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:''}),'*');}}catch(e){}return true;};
window.__spotibasePlay = function(){try{var f=document.getElementById('ytplayer');if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:'command',func:'playVideo',args:''}),'*');}}catch(e){}return true;};
document.addEventListener('message',function(e){try{var d=typeof e.data==='string'?e.data:'';if(d==='spotibase-pause'){window.__spotibasePause();}else if(d==='spotibase-play'){window.__spotibasePlay();}}catch(err){}});
window.addEventListener('message',function(e){try{var d=typeof e.data==='string'?e.data:'';if(d==='spotibase-pause'){window.__spotibasePause();}else if(d==='spotibase-play'){window.__spotibasePlay();}}catch(err){}});
</script>
</body>
</html>`;

/**
 * Single inline YouTube player.
 *
 * - Native: react-native-webview with a youtube-nocookie/embed iframe.
 * - Web: plain <iframe> (react-native-webview also works on web, but an
 *   explicit iframe keeps fullscreen + keyboard semantics native to the DOM).
 * - Only one instance is ever mounted — screens render it once at the top and
 *   swap `video`, never one player per row.
 * - Mounting/switching pauses audio (mutual exclusion vs playerStore).
 */
const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  video,
  autoplay = true,
  onClose,
  onError,
  testID,
}) => {
  const { theme } = useThemeStore();
  const isPlaying = useYouTubePlayerStore((s) => s.isPlaying);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const webViewRef = useRef<any>(null);
  const webIframeRef = useRef<any>(null);

  const videoId = video?.videoId ?? null;

  // Mutual exclusion: video wins — pause any running audio track.
  useEffect(() => {
    if (!videoId || autoplay === false) return;
    try {
      const audio = usePlayerStore.getState();
      const st = audio.playbackState;
      if (st === 'playing' || st === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
  }, [videoId, autoplay]);

  // Resolve the playable URL; fall back to the direct embed on any failure
  // (backend missing, offline, 404) so playback still works.
  useEffect(() => {
    resolveAbortRef.current?.abort();
    if (!videoId) {
      setEmbedUrl(null);
      setFailed(false);
      setResolving(false);
      return;
    }
    const controller = new AbortController();
    resolveAbortRef.current = controller;
    let cancelled = false;
    setResolving(true);
    setFailed(false);
    setEmbedUrl(null);

    (async () => {
      try {
        const res = await youtubeApi.resolve(videoId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        // Backend resolve shape: { source, watchUrl, embedUrl, video }.
        // Tolerate legacy flat { embedUrl } during rollout.
        const rawUrl =
          (res.data as any)?.embedUrl ?? (res.data as any)?.video?.embedUrl ?? null;
        const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
        setEmbedUrl(sanitizeEmbedUrl(url || null, videoId));
      } catch (err: any) {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        if (!cancelled) {
          // Fallback: direct embed still plays without backend support.
          setEmbedUrl(directEmbedUrl(videoId));
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) setResolving(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [videoId]);

  // P0-2: isPlaying=false must REALLY stop the video — not just flip a
  // boolean. The iframe keeps decoding (audio keeps playing) unless it gets
  // an IFrame API pause command, so drive it here. Unmount (closePlayer /
  // video switch) stops it entirely; this effect covers pause + resume.
  useEffect(() => {
    if (!embedUrl) return;
    try {
      if (Platform.OS === 'web') {
        const frame = webIframeRef.current as any;
        const win = frame?.contentWindow;
        if (win?.postMessage) {
          win.postMessage(
            JSON.stringify({
              event: 'command',
              func: isPlaying ? 'playVideo' : 'pauseVideo',
              args: '',
            }),
            '*'
          );
        }
      } else {
        const wv = webViewRef.current;
        if (wv?.injectJavaScript) {
          wv.injectJavaScript(isPlaying ? PLAY_IFRAMES_JS : PAUSE_IFRAMES_JS);
        } else if (wv?.postMessage) {
          try {
            wv.postMessage(isPlaying ? 'spotibase-play' : 'spotibase-pause');
          } catch {}
        }
      }
    } catch {}
  }, [isPlaying, embedUrl]);

  // Abort resolve on unmount.
  useEffect(
    () => () => {
      resolveAbortRef.current?.abort();
    },
    []
  );

  const webIframe = useMemo(() => {
    if (Platform.OS !== 'web' || !embedUrl) return null;
    const Iframe = 'iframe' as any;
    return (
      <Iframe
        ref={webIframeRef}
        src={embedUrl}
        title={video?.title ?? 'YouTube player'}
        style={{ width: '100%', height: '100%', borderWidth: 0, borderStyle: 'none' } as any}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      />
    );
  }, [embedUrl, video?.title]);

  if (!video) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: '#000', borderColor: theme.colors.border }]}
      accessibilityRole="none"
      accessibilityLabel={`YouTube player: ${video.title}`}
      testID={testID ?? 'youtube-player'}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {video.title}
        </Text>
        {onClose ? (
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close video player"
          >
            <Icon name="close" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.frame}>
        {resolving && !embedUrl ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.loadingText}>Loading video…</Text>
          </View>
        ) : null}
        {embedUrl && !failed ? (
          Platform.OS === 'web' ? (
            <View style={styles.webFrame}>{webIframe}</View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ html: buildNativeHtml(embedUrl) }}
              style={styles.nativeFrame}
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              startInLoadingState={false}
              onError={() => {
                setFailed(true);
                onError?.('Video failed to load.');
              }}
              onHttpError={() => {
                setFailed(true);
                onError?.('Video failed to load.');
              }}
              testID="youtube-player-webview"
            />
          )
        ) : null}
        {failed ? (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Video failed to load.</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {!!video.channelTitle && (
          <Text style={styles.channel} numberOfLines={1}>
            {video.channelTitle}
          </Text>
        )}
        <Text style={styles.state} accessibilityLiveRegion="polite">
          {isPlaying ? 'Now playing' : 'Paused'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  closeBtn: { padding: 4 },
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  nativeFrame: { flex: 1, backgroundColor: '#000' },
  webFrame: { flex: 1 },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000',
  },
  loadingText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  channel: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  state: { color: '#1DB954', fontSize: 12, fontWeight: '700' },
});

export default React.memo(YouTubePlayer);
