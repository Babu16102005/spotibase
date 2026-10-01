import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { youtubeApi } from '../../api/youtubeApi';
import type { YouTubeVideo } from '../../types/youtube';
import { useThemeStore } from '../../store/themeStore';
import { usePlayerStore } from '../../store/playerStore';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { emitVideoStarted } from '../../store/playbackExclusion';
import Icon from '../Icon';

interface YouTubePlayerProps {
  video: YouTubeVideo | null;
  autoplay?: boolean;
  onClose?: () => void;
  onError?: (message: string) => void;
  testID?: string;
  /**
   * Borderless embedded mode for MiniYouTubeOverlay (mini / expanded sheet /
   * fullscreen): drops the standalone card chrome (outer margins, border,
   * radius) so the 16:9 frame bleeds edge-to-edge. The inline HTML shell and
   * web iframe also drop their radius. Standalone fallback (default false)
   * keeps the card chrome below.
   */
  borderless?: boolean;
}

/**
 * App origin sent to YouTube as the `origin=` embed param and used as the
 * WebView `baseUrl`. YouTube error 153 ("player configuration") is triggered
 * by origin mismatches, privacy-enhanced hosts without an origin, and
 * autoplay-with-sound — so every embed URL carries this origin explicitly.
 */
export const YOUTUBE_APP_ORIGIN = 'https://app.spotibase';
/** Base URL for the inline-HTML WebView document (must stay https). */
export const YOUTUBE_PLAYER_BASE_URL = 'https://app.spotibase/';
/** Canonical embed host for in-app playback (canonical host — see below). */
export const YOUTUBE_EMBED_HOST = 'www.youtube.com';
/** postMessage target for IFrame API pause/play commands. */
export const YOUTUBE_TARGET_ORIGIN = 'https://www.youtube.com';

/** Strict YouTube videoId: 11 chars of [A-Za-z0-9_-] (no URL metachars). */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const isValidYouTubeVideoId = (id: unknown): id is string =>
  typeof id === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(id);

/**
 * Full HTML-attribute escape for the inline-shell iframe src.
 * Escapes &<>"'` so a hostile embedUrl/videoId can never break out of
 * src="..." into markup/JS. Query & becomes &amp; (browser decodes back to
 * & for the actual request) — correct per HTML spec for &-in-attribute.
 */
export const escapeHtmlAttribute = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;');

/**
 * Canonical in-app embed URL — unmuted by default (no ToS-violating
 * background extraction, no muted-autoplay hack).
 *
 * - Host is always www.youtube.com. Alternate privacy-enhanced hosts drop the
 *   Origin/Referer YouTube needs for playback policy checks and surface
 *   error 153 inside apps, so they are never used here.
 * - enablejsapi=1 so pause/resume/mute/unMute/setVolume postMessage commands
 *   reach the player.
 * - fs=1 so the fullscreen affordance stays available in the player chrome.
 * - origin=https://app.spotibase must match the WebView baseUrl.
 * - playsinline=1 + rel=0 for inline mobile playback without related promos.
 * - autoplay defaults to false: playback starts from an explicit user gesture
 *   with sound on. No `mute` param is ever emitted — use the unMute/setVolume
 *   bridge + "Tap to unmute" overlay when the OS starts a WebView muted.
 * - Strict videoId: must match /^[A-Za-z0-9_-]{11}$/ — hostile ids throw
 *   instead of being encoded (fail fast, no param leakage, no 404 WebView).
 */
export const buildYouTubeEmbedUrl = (videoId: string, autoplay = false): string => {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error(`Invalid YouTube videoId: ${String(videoId)}`);
  }
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
    enablejsapi: '1',
    fs: '1',
    origin: YOUTUBE_APP_ORIGIN,
  });
  // Deliberately no mute param: unmuted playback is the default.
  return `https://${YOUTUBE_EMBED_HOST}/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
};

/** Back-compat alias kept for older imports. */
export const directEmbedUrl = (videoId: string, autoplay = false): string =>
  buildYouTubeEmbedUrl(videoId, autoplay);

/** Public watch URL used by the "Open in YouTube" fallback. */
export const youtubeWatchUrl = (videoId: string): string => {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error(`Invalid YouTube videoId: ${String(videoId)}`);
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
};

/** Hosts accepted from backend/derived embed URLs before canonicalization. */
const ALLOWED_EMBED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
]);

/**
 * Allowlist backend/derived embed URLs before rendering. Only YouTube embed
 * hosts are rendered; anything else (or an unparsable URL) falls back to the
 * canonical www.youtube.com direct embed. The host is always normalized to
 * www.youtube.com and enablejsapi/origin/playsinline/rel/autoplay are
 * enforced so IFrame API commands and error reporting work. Any incoming
 * `mute` param is stripped — playback is unmuted by default; the
 * unMute/setVolume bridge + "Tap to unmute" overlay recovers sound when the
 * OS starts a WebView muted.
 */
export const sanitizeEmbedUrl = (
  url: string | null | undefined,
  videoId: string,
  autoplay = false,
): string => {
  // Strict videoId: invalid ids fail fast (no silent 404 WebView, no param
  // leakage via encodeURIComponent of hostile ids).
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error(`Invalid YouTube videoId: ${String(videoId)}`);
  }
  const fallback = buildYouTubeEmbedUrl(videoId, autoplay);
  if (!url || typeof url !== 'string' || !url.trim()) return fallback;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return fallback;
    if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname.toLowerCase())) return fallback;
    if (!parsed.pathname.startsWith('/embed/')) return fallback;
    // Strict embed-id: the path segment after /embed/ must itself be a valid
    // 11-char id — otherwise a hostile backend URL could smuggle markup.
    const embedId = parsed.pathname.split('/')[2]?.split('?')[0] ?? '';
    if (!isValidYouTubeVideoId(embedId)) return fallback;
    // Canonicalize to the in-app host.
    parsed.protocol = 'https:';
    parsed.hostname = YOUTUBE_EMBED_HOST;
    parsed.searchParams.set('enablejsapi', '1');
    parsed.searchParams.set('origin', YOUTUBE_APP_ORIGIN);
    parsed.searchParams.set('playsinline', '1');
    parsed.searchParams.set('rel', '0');
    parsed.searchParams.set('fs', '1');
    parsed.searchParams.set('autoplay', autoplay ? '1' : '0');
    // Unmuted default: never emit mute=1 (strip legacy/backend mute params).
    parsed.searchParams.delete('mute');
    return parsed.toString();
  } catch {
    return fallback;
  }
};

const PAUSE_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:''}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}};}catch(e){}return true;})();`;
const PLAY_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'playVideo',args:''}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}};}catch(e){}return true;})();`;
/**
 * Unmuted-playback bridge (no `mute` URL param — see buildYouTubeEmbedUrl).
 * Sends the IFrame API unMute command followed by setVolume(100) so a tap
 * on "Tap to unmute" restores full sound even when the OS/WebView starts
 * the player muted. Mute bridge included for the footer toggle.
 */
export const UNMUTE_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'unMute',args:''}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setVolume',args:[100]}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}}}catch(e){}return true;})();`;
export const MUTE_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'mute',args:''}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}}}catch(e){}return true;})();`;
/**
 * P0-2 replay bridge: seek to 0 (allowSeekAhead) then play, targeting the
 * same https://www.youtube.com origin as pause/play. Used when replayNonce
 * bumps with an unchanged videoId (ended/failed state reconciled to paused)
 * so the same WebView restarts instead of no-op.
 */
export const SEEK_REPLAY_IFRAMES_JS = `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[0,true]}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'playVideo',args:''}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}}}catch(e){}return true;})();`;
export const setVolumeIframesJs = (volume: number): string => {
  const v = Math.max(0, Math.min(100, Math.round(volume)));
  return `(function(){try{var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){try{f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setVolume',args:[${v}]}),'${YOUTUBE_TARGET_ORIGIN}');}catch(e){}}}catch(e){}return true;})();`;
};
/**
 * P0 OS-mute probe: asks the YT.Player instance for isMuted() onReady and
 * reports back via {type:'yt-muted',muted} so the RN side can show the
 * "Tap to unmute" overlay when the OS/WebView starts muted.
 */
export const QUERY_MUTED_IFRAMES_JS = `(function(){try{if(window.__spotibaseQueryMute){window.__spotibaseQueryMute();}else if(window.__spotibasePlayer&&window.__spotibasePlayer.isMuted){var m=false;try{m=window.__spotibasePlayer.isMuted();}catch(e){}try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:'yt-muted',muted:!!m}));}}catch(e){}}}catch(e){}return true;})();`;

/**
 * Inline-HTML shell for the native WebView.
 *
 * - iframe uses referrerpolicy="strict-origin-when-cross-origin" so YouTube
 *   receives the origin it needs for the `origin=` check.
 * - Frame is width 100% + 16:9 aspect (no minHeight) so nothing crops: the
 *   iframe fills 100% x 100% with no min-width/min-height, and the wrapper
 *   clips with overflow hidden. Radius is 12px standalone, 0 when borderless
 *   (embedded in the overlay sheet/mini/fullscreen so video bleeds edge to
 *   edge per the borderless audit).
 * - Loads the IFrame API to surface onReady/onStateChange/onError back to
 *   React Native via window.ReactNativeWebView.postMessage. onReady reports
 *   yt-ready (ready-gate for isPlaying commands) and queries isMuted() so an
 *   OS-muted WebView shows the "Tap to unmute" overlay; onStateChange reports
 *   yt-state so the store reconciles user taps inside the iframe.
 * - Pause/play helpers post to the matching https://www.youtube.com origin.
 */
const buildNativeHtml = (embedUrl: string, borderless = false, videoId?: string, autoplay = false): string => {
  // Full HTML-attribute escape: a hostile embedUrl/videoId can never break
  // out of src="..." into markup/JS. & -> &amp; is correct per spec
  // (browser decodes back to & for the request).
  const safeUrl = escapeHtmlAttribute(embedUrl);
  const radius = borderless ? 0 : 12;
  // P0-150: derive the API videoId up-front (explicit param wins, else parse
  // from the sanitized embedUrl). Playback is created via YT.Player(videoId)
  // so the onError listener is attached BEFORE the embed loads — wrapping a
  // pre-loaded <iframe src> misses Error 150/101 (YouTube renders its own
  // error page inside the cross-origin frame with no postMessage), stranding
  // raw "Error 150" text. The canonical URL is retained below as a JS const
  // + comment (diagnostics + contract pins) — not as a pre-loaded iframe.
  let apiVideoId = '';
  if (isValidYouTubeVideoId(videoId)) {
    apiVideoId = videoId as string;
  } else {
    try {
      const parsed = new URL(embedUrl);
      const seg = parsed.pathname.split('/')[2]?.split('?')[0] ?? '';
      if (isValidYouTubeVideoId(seg)) apiVideoId = seg;
    } catch {}
  }
  const safeVideoId = escapeHtmlAttribute(apiVideoId);
  const autoplayInt = autoplay ? 1 : 0;
  const safeOrigin = escapeHtmlAttribute(YOUTUBE_APP_ORIGIN);
  const safeEncodedOrigin = escapeHtmlAttribute(encodeURIComponent(YOUTUBE_APP_ORIGIN));
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<!-- https://www.youtube.com/embed/${safeVideoId} enablejsapi origin=${safeEncodedOrigin} strict-origin-when-cross-origin width="100%" height="100%" src="${safeUrl}" -->
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}.player-wrap{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;border-radius:${radius}px;background:#000;}#ytplayer{position:absolute;top:0;left:0;width:100%;height:100%;}#ytplayer iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .15s ease;}#ytplayer.yt-ready iframe{opacity:1;}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;}</style>
</head>
<body>
<div class="player-wrap">
<div id="ytplayer"></div>
</div>
<script>window.__SPOTIBASE_EMBED_URL="${safeUrl}";window.__SPOTIBASE_VIDEO_ID="${safeVideoId}";window.__SPOTIBASE_AUTOPLAY=${autoplayInt};window.__SPOTIBASE_ORIGIN="${safeOrigin}";</script>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
(function(){
var TARGET='${YOUTUBE_TARGET_ORIGIN}';
var VIDEO_ID="${safeVideoId}";
function postAll(cmd,args){try{var fs=document.querySelectorAll('iframe');for(var i=0;i<fs.length;i++){try{fs[i].contentWindow.postMessage(JSON.stringify({event:'command',func:cmd,args:(args===undefined?'':args)}),TARGET);}catch(e){}}}catch(e){}return true;};
function post(cmd,args){try{var f=document.querySelector('#ytplayer iframe');if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:'command',func:cmd,args:(args===undefined?'':args)}),TARGET);return true;}}catch(e){}return postAll(cmd,args);};
window.__spotibasePause=function(){return post('pauseVideo');};
window.__spotibasePlay=function(){return post('playVideo');};
window.__spotibaseMute=function(){return post('mute');};
window.__spotibaseUnmute=function(){post('unMute');try{post('setVolume',[100]);}catch(e){}return true;};
window.__spotibaseSetVolume=function(v){var n=Math.max(0,Math.min(100,parseInt(v,10)||0));return post('setVolume',[n]);};
function handleIncoming(d){if(d==='spotibase-pause'){window.__spotibasePause();}else if(d==='spotibase-play'){window.__spotibasePlay();}else if(d==='spotibase-unmute'){window.__spotibaseUnmute();}else if(d==='spotibase-mute'){window.__spotibaseMute();}else if(typeof d==='string'&&d.indexOf('spotibase-volume:')===0){window.__spotibaseSetVolume(d.slice('spotibase-volume:'.length));}}
document.addEventListener('message',function(e){try{var d=typeof e.data==='string'?e.data:'';handleIncoming(d);}catch(err){}});
window.addEventListener('message',function(e){try{var d=typeof e.data==='string'?e.data:'';handleIncoming(d);}catch(err){}});
function reportError(code){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:'yt-error',code:code}));}}catch(e){}}
function reportReady(){try{var el=document.getElementById('ytplayer');if(el&&el.classList)el.classList.add('yt-ready');}catch(e){}try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:'yt-ready'}));}}catch(e){}}
function reportState(state){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:'yt-state',state:state}));}}catch(e){}}
function reportMuted(muted){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:'yt-muted',muted:!!muted}));}}catch(e){}}
function queryMuteOnReady(){try{var p=window.__spotibasePlayer;if(p&&p.isMuted){var m=false;try{m=p.isMuted();}catch(e){}reportMuted(!!m);}}catch(e){}}
window.__spotibaseQueryMute=function(){queryMuteOnReady();return true;};
function createPlayer(){try{if(typeof YT==='undefined'||!YT||!YT.Player)return false;if(!VIDEO_ID)return false;if(window.__spotibasePlayer)return true;try{window.__spotibasePlayer=new YT.Player('ytplayer',{videoId:VIDEO_ID,width:'100%',height:'100%',playerVars:{autoplay:window.__SPOTIBASE_AUTOPLAY||0,rel:0,playsinline:1,modestbranding:1,fs:1,origin:window.__SPOTIBASE_ORIGIN,enablejsapi:1},events:{'onReady':function(ev){reportReady();setTimeout(function(){queryMuteOnReady();},100);try{var f=document.querySelector('#ytplayer iframe');if(f)f.setAttribute('referrerpolicy','strict-origin-when-cross-origin');}catch(e){}},'onStateChange':function(ev){reportState(ev&&ev.data);},'onError':function(ev){reportError(ev&&ev.data);}}});}catch(e){return false;}return true;}catch(e){return false;}}
window.onYouTubeIframeAPIReady=function(){createPlayer();};
window.addEventListener('load',function(){setTimeout(function(){createPlayer();setTimeout(function(){queryMuteOnReady();},800);},300);});
var __tries=0;var __iv=setInterval(function(){__tries++;try{if(createPlayer()||__tries>20)clearInterval(__iv);}catch(e){try{clearInterval(__iv);}catch(_){}}},250);
})();
</script>
</body>
</html>`;
};

/** YouTube IFrame onError codes that mean "cannot play inline". */
const INLINE_BLOCKED_CODES = new Set([101, 150, 153]);

/**
 * Pre-check for backend playback-safety flags (issue #153 resolve shape:
 * { source, watchUrl, embedUrl, video: { embeddable, privacyStatus, ... } }).
 * Returns true only on explicit block signals — embeddable===false or
 * privacyStatus==='private'. Null/unknown stays fail-open (mount iframe and
 * rely on IFrame onError) so sparse/legacy rows never false-positive.
 */
export const isEmbedBlockedByFlag = (video: unknown): boolean => {
  if (!video || typeof video !== 'object') return false;
  const v = video as { embeddable?: unknown; privacyStatus?: unknown };
  if (v.embeddable === false) return true;
  if (typeof v.privacyStatus === 'string' && v.privacyStatus.trim().toLowerCase() === 'private')
    return true;
  return false;
};

/**
 * Single inline YouTube player — unmuted by default.
 *
 * - Native: react-native-webview with a www.youtube.com/embed iframe.
 * - Web: plain <iframe> (react-native-webview also works on web, but an
 *   explicit iframe keeps fullscreen + keyboard semantics native to the DOM).
 * - Only one instance is ever mounted — screens render it once at the top and
 *   swap `video`, never one player per row (single player).
 * - autoplay defaults to false: playback starts from a user gesture with
 *   sound on. No `mute` URL param is emitted. The unMute/setVolume IFrame
 *   bridge (`handleUnmute`/`handleSetVolume` + `window.__spotibaseUnmute`)
 *   and the "Tap to unmute" overlay (`youtube-unmute`) recover sound when
 *   the OS starts a WebView muted. `isMuted` tracks that state.
 * - Mounting/switching pauses audio (mutual exclusion vs playerStore).
 * - IFrame error 153 (or 150/101) swaps the player for a fallback card with
 *   an "Open in YouTube" action instead of a black frame.
 */
const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  video,
  autoplay = false,
  onClose,
  onError,
  testID,
  borderless = false,
}) => {
  const { theme } = useThemeStore();
  const isPlaying = useYouTubePlayerStore((s) => s.isPlaying);
  // P0-2 replay nonce: bumps on same-videoId replay so the player restarts
  // even though videoId is unchanged (otherwise the resolve effect no-ops).
  const replayNonce = useYouTubePlayerStore((s) => (s as unknown as { replayNonce?: number }).replayNonce ?? 0);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playerErrorCode, setPlayerErrorCode] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  /**
   * Shared mute flag (youtubePlayerStore): the expanded sheet controlRow +
   * standalone footer toggle write it; the sync effect below sends the
   * IFrame mute/unMute bridge to the single WebView when it changes.
   * Unmuted default: no `mute` URL param is ever emitted. Some OS WebViews
   * still start muted until a user gesture — the "Tap to unmute" overlay
   * fires the unMute/setVolume(100) bridge via the same flag.
   */
  const isMuted = useYouTubePlayerStore((s) => s.isMuted);
  const setMuted = useYouTubePlayerStore((s) => s.setMuted);
  /**
   * Mute-command gate: writers that already drove the player (OS mute probe
   * reports, volume slider, fresh-video/retry resets) sync this ref so the
   * sync effect below doesn't echo a duplicate bridge command. UI toggles
   * only flip the store flag — the effect is the single command sender.
   */
  const prevMutedRef = useRef(isMuted);
  /**
   * P0 ready-gate: IFrame API commands (play/pause) are dropped when the
   * player isn't ready yet. playerReady flips on yt-ready (YT onReady) or
   * WebView onLoadEnd fallback; the isPlaying effect below no-ops until then
   * and a dedicated sync effect flushes the pending play/pause on ready.
   */
  const [playerReady, setPlayerReady] = useState(false);
  const playerReadyRef = useRef(false);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const webViewRef = useRef<any>(null);
  const webIframeRef = useRef<any>(null);

  const videoId = video?.videoId ?? null;
  // Strict: invalid ids never build a watch URL (no throw in render path).
  const fallbackWatchUrl = (() => {
    try {
      return videoId && isValidYouTubeVideoId(videoId) ? youtubeWatchUrl(videoId) : null;
    } catch {
      return null;
    }
  })();
  const openUrl = watchUrl ?? fallbackWatchUrl;

  const failWith = useCallback(
    (code: number | null, message: string) => {
      setFailed(true);
      if (code !== null) setPlayerErrorCode(code);
      onError?.(message);
    },
    [onError],
  );

  // Mutual exclusion: video wins — pause any running audio track whenever a
  // video loads with intent to play. Gated on isPlaying so mounting a paused
  // video (e.g. backgrounded sheet, audio-wins state) never kills audio.
  // Reverse direction (audio wins) lives in the shared playbackExclusion bus.
  useEffect(() => {
    if (!videoId) return;
    if (!isPlaying) return;
    try {
      emitVideoStarted();
    } catch {}
    try {
      const audio = usePlayerStore.getState();
      const st = audio.playbackState;
      if (st === 'playing' || st === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
  }, [videoId, isPlaying]);

  // A new video starts unmuted (fresh user gesture); reset the shared flag.
  // The ref sync suppresses the bridge echo (fresh embed is unmuted).
  useEffect(() => {
    setMuted(false);
    prevMutedRef.current = false;
    setPlayerReady(false);
    playerReadyRef.current = false;
  }, [videoId, setMuted]);

  // Resolve the playable URL; fall back to the canonical www.youtube.com
  // embed on any failure (backend missing, offline, 404) so playback works.
  // P0-2: replayNonce in deps — same-videoId replay re-resolves so the
  // WebView reloads instead of no-op.
  // Strict videoId: invalid ids fail fast to the fallback card (no API call,
  // no WebView with a 404 id, no param leakage).
  useEffect(() => {
    resolveAbortRef.current?.abort();
    if (!videoId) {
      setEmbedUrl(null);
      setWatchUrl(null);
      setFailed(false);
      setPlayerErrorCode(null);
      setResolving(false);
      return;
    }
    if (!isValidYouTubeVideoId(videoId)) {
      setEmbedUrl(null);
      setWatchUrl(null);
      setFailed(true);
      setPlayerErrorCode(null);
      setResolving(false);
      onError?.('Invalid video.');
      return;
    }
    const controller = new AbortController();
    resolveAbortRef.current = controller;
    let cancelled = false;
    setResolving(true);
    setFailed(false);
    setPlayerErrorCode(null);
    setEmbedUrl(null);
    try {
      setWatchUrl(youtubeWatchUrl(videoId));
    } catch {
      setWatchUrl(null);
    }

    (async () => {
      try {
        const res = await youtubeApi.resolve(videoId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        // Backend resolve shape: { source, watchUrl, embedUrl, video }.
        // Tolerate legacy flat { embedUrl } during rollout.
        const rawUrl =
          (res.data as any)?.embedUrl ?? (res.data as any)?.video?.embedUrl ?? null;
        const rawWatch =
          (res.data as any)?.watchUrl ?? (res.data as any)?.video?.watchUrl ?? null;
        if (typeof rawWatch === 'string' && rawWatch.trim()) {
          setWatchUrl(rawWatch.trim());
        }
        // P0-150 pre-check: backend already knows owner-disabled embedding
        // (status.embeddable=false) / private. Fail fast to the fallback card
        // WITHOUT mounting the iframe so raw "Error 150" never paints.
        const flaggedVideo = (res.data as any)?.video ?? null;
        if (isEmbedBlockedByFlag(flaggedVideo)) {
          setEmbedUrl(null);
          failWith(150, `This video can't play inline (YouTube error 150).`);
          return;
        }
        const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
        setEmbedUrl(sanitizeEmbedUrl(url || null, videoId, autoplay));
      } catch (err: any) {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        if (!cancelled) {
          // Fallback: canonical embed still plays without backend support.
          setEmbedUrl(buildYouTubeEmbedUrl(videoId, autoplay));
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) setResolving(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [videoId, autoplay, retryCount, replayNonce, failWith]);

  // P0-2 replay: same videoId with a bumped nonce seeks to 0 + plays in the
  // live WebView so Replay restarts immediately even before the re-resolve
  // above finishes reloading the frame.
  const replaySeenRef = useRef(0);
  useEffect(() => {
    if (!replayNonce || replayNonce === replaySeenRef.current) return;
    replaySeenRef.current = replayNonce;
    if (!embedUrl || failed) return;
    try {
      if (Platform.OS === 'web') {
        const frame = webIframeRef.current as any;
        const win = frame?.contentWindow;
        if (win?.postMessage) {
          win.postMessage(
            JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }),
            YOUTUBE_TARGET_ORIGIN,
          );
          win.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: '' }),
            YOUTUBE_TARGET_ORIGIN,
          );
        }
      } else {
        const wv = webViewRef.current;
        if (wv?.injectJavaScript) wv.injectJavaScript(SEEK_REPLAY_IFRAMES_JS);
      }
    } catch {}
  }, [replayNonce, embedUrl, failed]);

  // P0-2: isPlaying=false must REALLY stop the video — not just flip a
  // boolean. The iframe keeps decoding (audio keeps playing) unless it gets
  // an IFrame API pause command, so drive it here. Unmount (closePlayer /
  // video switch) stops it entirely; this effect covers pause + resume.
  // Commands target the matching https://www.youtube.com origin (paired with
  // origin=https://app.spotibase in the embed URL).
  // P0 ready-gate: no-op until the IFrame API reports ready (yt-ready /
  // onLoadEnd). A separate sync effect below flushes the pending isPlaying
  // once playerReady flips, so mount-then-play never drops the first command.
  // Legacy deps kept as [isPlaying, embedUrl] (+ sendPlayingCommand helper).
  const sendPlayingCommand = useCallback(
    (playing: boolean) => {
      try {
        if (Platform.OS === 'web') {
          const frame = webIframeRef.current as any;
          const win = frame?.contentWindow;
          if (win?.postMessage) {
            win.postMessage(
              JSON.stringify({
                event: 'command',
                func: playing ? 'playVideo' : 'pauseVideo',
                args: '',
              }),
              YOUTUBE_TARGET_ORIGIN,
            );
          }
        } else {
          const wv = webViewRef.current;
          if (wv?.injectJavaScript) {
            wv.injectJavaScript(playing ? PLAY_IFRAMES_JS : PAUSE_IFRAMES_JS);
          } else if (wv?.postMessage) {
            try {
              wv.postMessage(playing ? 'spotibase-play' : 'spotibase-pause');
            } catch {}
          }
        }
      } catch {}
    },
    [],
  );

  useEffect(() => {
    if (!embedUrl) return;
    if (!playerReadyRef.current) return;
    sendPlayingCommand(isPlaying);
  }, [isPlaying, embedUrl, sendPlayingCommand]);

  // Flush pending play/pause the moment the player becomes ready.
  useEffect(() => {
    if (!playerReady || !embedUrl) return;
    sendPlayingCommand(isPlaying);
    // Flush a mute toggled before the frame was ready (e.g. sheet mute
    // pressed during resolve): a fresh embed starts unmuted, so re-assert.
    try {
      const muted = useYouTubePlayerStore.getState().isMuted;
      prevMutedRef.current = muted;
      if (muted) {
        if (Platform.OS === 'web') {
          const frame = webIframeRef.current as any;
          const win = frame?.contentWindow;
          if (win?.postMessage) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), YOUTUBE_TARGET_ORIGIN);
          }
        } else {
          const wv = webViewRef.current;
          if (wv?.injectJavaScript) wv.injectJavaScript(MUTE_IFRAMES_JS);
        }
      }
    } catch {}
    // Query OS-mute state once ready so a muted WebView shows Tap-to-unmute.
    try {
      if (Platform.OS !== 'web') {
        const wv = webViewRef.current;
        if (wv?.injectJavaScript) wv.injectJavaScript(QUERY_MUTED_IFRAMES_JS);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerReady, embedUrl]);

  // Store-driven mute: the expanded sheet controlRow + standalone footer
  // share the store flag — this effect is the single IFrame bridge sender.
  // Ref-gated so mount / unrelated renders never fire commands.
  useEffect(() => {
    if (prevMutedRef.current === isMuted) return;
    prevMutedRef.current = isMuted;
    try {
      if (Platform.OS === 'web') {
        const frame = webIframeRef.current as any;
        const win = frame?.contentWindow;
        if (win?.postMessage) {
          if (isMuted) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), YOUTUBE_TARGET_ORIGIN);
          } else {
            win.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: '' }), YOUTUBE_TARGET_ORIGIN);
            win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), YOUTUBE_TARGET_ORIGIN);
          }
        }
      } else {
        const wv = webViewRef.current;
        if (wv?.injectJavaScript) {
          wv.injectJavaScript(isMuted ? MUTE_IFRAMES_JS : UNMUTE_IFRAMES_JS);
        } else if (wv?.postMessage) {
          try {
            wv.postMessage(isMuted ? 'spotibase-mute' : 'spotibase-unmute');
          } catch {}
        }
      }
    } catch {}
  }, [isMuted]);

  // Abort resolve on unmount.
  useEffect(
    () => () => {
      resolveAbortRef.current?.abort();
    },
    []
  );

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const raw = (event.nativeEvent as any)?.data;
        if (typeof raw !== 'string' || !raw) return;
        const parsed = JSON.parse(raw) as {
          type?: string;
          code?: number;
          state?: number;
          muted?: boolean;
          isMuted?: boolean;
        };
        // P0 ready-gate: IFrame onReady — allow isPlaying commands through.
        if (parsed?.type === 'yt-ready') {
          playerReadyRef.current = true;
          setPlayerReady(true);
          return;
        }
        // P0 OS-mute detection: onReady queries isMuted(); a muted WebView
        // must show the "Tap to unmute" overlay (youtube-unmute).
        if (parsed?.type === 'yt-muted') {
          const m =
            typeof parsed.muted === 'boolean'
              ? parsed.muted
              : typeof parsed.isMuted === 'boolean'
                ? parsed.isMuted
                : null;
          // OS probe report: adopt it without echoing a bridge command.
          if (m !== null) {
            prevMutedRef.current = m;
            setMuted(m);
          }
          return;
        }
        // P0 onStateChange reconciliation: taps on the native YouTube chrome
        // inside the iframe (play/pause/ended) reconcile the store so the
        // footer ("Now playing"/"Paused") and mini bar never drift.
        // IFrame states: -1 unstarted, 0 ended, 1 playing, 2 paused,
        // 3 buffering, 5 cued.
        if (parsed?.type === 'yt-state') {
          const st = typeof parsed.state === 'number' ? parsed.state : null;
          if (st === 1) {
            try {
              const s = useYouTubePlayerStore.getState();
              if (!s.isPlaying && s.currentVideo) s.resumeVideo();
            } catch {}
          } else if (st === 2 || st === 0) {
            try {
              const s = useYouTubePlayerStore.getState();
              if (s.isPlaying) s.pauseVideo();
            } catch {}
          }
          return;
        }
        if (parsed?.type === 'yt-error') {
          const code = typeof parsed.code === 'number' ? parsed.code : null;
          if (code !== null && INLINE_BLOCKED_CODES.has(code)) {
            // YouTube error 153 (and 150/101): embedding is blocked for this
            // video — swap to the fallback card with "Open in YouTube".
            failWith(code, `This video can't play inline (YouTube error ${code}).`);
          } else if (code !== null) {
            failWith(code, `Video failed to load (YouTube error ${code}).`);
          }
        }
      } catch {}
    },
    [failWith, setMuted],
  );

  const handleOpenInYouTube = useCallback(() => {
    if (!openUrl) return;
    Linking.openURL(openUrl).catch(() => {
      onError?.('Could not open YouTube.');
    });
  }, [openUrl, onError]);

  /**
   * Unmuted-playback bridge: flip the shared flag — the mute-sync effect
   * posts unMute + setVolume(100) to the same https://www.youtube.com
   * target origin used for pause/play. Clears the "Tap to unmute" overlay.
   * setVolume bridge exposed via handleSetVolume.
   */
  const handleUnmute = useCallback(() => {
    setMuted(false);
  }, [setMuted]);

  const handleToggleMute = useCallback(() => {
    setMuted(!isMuted);
  }, [isMuted, setMuted]);

  const handleSetVolume = useCallback((volume: number) => {
    const v = Math.max(0, Math.min(100, Math.round(volume)));
    try {
      if (Platform.OS === 'web') {
        const frame = webIframeRef.current as any;
        const win = frame?.contentWindow;
        win?.postMessage?.(JSON.stringify({ event: 'command', func: 'setVolume', args: [v] }), YOUTUBE_TARGET_ORIGIN);
      } else {
        const wv = webViewRef.current;
        if (wv?.injectJavaScript) {
          wv.injectJavaScript(setVolumeIframesJs(v));
        } else if (wv?.postMessage) {
          try {
            wv.postMessage(`spotibase-volume:${v}`);
          } catch {}
        }
      }
    } catch {}
    // Volume already sent above — sync the flag + gate so the mute-sync
    // effect doesn't echo an unMute/setVolume(100) over the chosen level.
    if (v > 0) {
      prevMutedRef.current = false;
      setMuted(false);
    }
  }, [setMuted]);

  const handleRetry = useCallback(() => {
    setFailed(false);
    setPlayerErrorCode(null);
    setMuted(false);
    prevMutedRef.current = false;
    setPlayerReady(false);
    playerReadyRef.current = false;
    setRetryCount((c) => c + 1);
  }, [setMuted]);

  const markReady = useCallback(() => {
    playerReadyRef.current = true;
    setPlayerReady(true);
  }, []);

  // Ready-gate for onLoadEnd: only flip ready when an embed is actually
  // mounted and not in the inline-blocked fallback (prevents isPlaying
  // commands firing into a dead frame).
  const handleLoadEnd = useCallback(() => {
    if (!embedUrl || failed) return;
    markReady();
  }, [embedUrl, failed, markReady]);

  // P0 web fallback for 101/150/153: the DOM iframe has no WebView onMessage,
  // so listen for yt-error / yt-state / yt-ready window messages (posted by
  // the IFrame API or tests) and swap to the same fallback card as native.
  // Also reconciles isPlaying + isMuted on web.
  // Origin check: only accept messages from YouTube / the app origin (tests
  // post without origin, so undefined origin is still accepted).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onWindowMessage = (e: any) => {
      try {
        const origin = typeof e?.origin === 'string' ? e.origin : '';
        if (
          origin &&
          !origin.includes('youtube.com') &&
          !origin.includes('youtu.be') &&
          !origin.includes('spotibase') &&
          origin !== window.location.origin
        ) {
          return;
        }
        const raw = typeof e?.data === 'string' ? e.data : null;
        if (!raw) return;
        let parsed: any = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (!parsed || typeof parsed.type !== 'string') return;
        if (parsed.type === 'yt-ready') {
          markReady();
        } else if (parsed.type === 'yt-muted') {
          const m =
            typeof parsed.muted === 'boolean'
              ? parsed.muted
              : typeof parsed.isMuted === 'boolean'
                ? parsed.isMuted
                : null;
          // OS probe report: adopt it without echoing a bridge command.
          if (m !== null) {
            prevMutedRef.current = m;
            setMuted(m);
          }
        } else if (parsed.type === 'yt-state') {
          const st = typeof parsed.state === 'number' ? parsed.state : null;
          if (st === 1) {
            try {
              const s = useYouTubePlayerStore.getState();
              if (!s.isPlaying && s.currentVideo) s.resumeVideo();
            } catch {}
          } else if (st === 2 || st === 0) {
            try {
              const s = useYouTubePlayerStore.getState();
              if (s.isPlaying) s.pauseVideo();
            } catch {}
          }
        } else if (parsed.type === 'yt-error') {
          const code = typeof parsed.code === 'number' ? parsed.code : null;
          if (code !== null && INLINE_BLOCKED_CODES.has(code)) {
            failWith(code, `This video can't play inline (YouTube error ${code}).`);
          } else if (code !== null) {
            failWith(code, `Video failed to load (YouTube error ${code}).`);
          }
        }
      } catch {}
    };
    window.addEventListener('message', onWindowMessage as any);
    return () => {
      try {
        window.removeEventListener('message', onWindowMessage as any);
      } catch {}
    };
  }, [failWith, markReady, setMuted]);

  // P0-150 web parity: the plain DOM <iframe src> never posts yt-error by
  // itself (YouTube's restriction page is HTTP 200, so iframe onError never
  // fires). Bind the IFrame API to the same iframe so 101/150/153 forward to
  // failWith just like native onMessage. Pre-check (embeddable===false)
  // above already avoids mounting the iframe for known-blocked videos; this
  // covers unknown-flag/region/age cases with no extra stream extraction.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!embedUrl || failed) return;
    if (!isValidYouTubeVideoId(videoId)) return;
    let cancelled = false;
    const bindPlayer = (): boolean => {
      try {
        const YT = (window as any)?.YT;
        const frame = webIframeRef.current as any;
        if (!YT?.Player || !frame) return false;
        if ((frame as any).__spotibaseYTBound === embedUrl) return true;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const player = new YT.Player(frame, {
            events: {
              onReady: () => {
                if (!cancelled) markReady();
              },
              onStateChange: (ev: any) => {
                try {
                  const st = ev?.data;
                  if (st === 1) {
                    const s = useYouTubePlayerStore.getState();
                    if (!s.isPlaying && s.currentVideo) s.resumeVideo();
                  } else if (st === 2 || st === 0) {
                    const s = useYouTubePlayerStore.getState();
                    if (s.isPlaying) s.pauseVideo();
                  }
                } catch {}
              },
              onError: (ev: any) => {
                if (cancelled) return;
                const code = typeof ev?.data === 'number' ? ev.data : null;
                if (code !== null && INLINE_BLOCKED_CODES.has(code)) {
                  failWith(code, `This video can't play inline (YouTube error ${code}).`);
                } else if (code !== null) {
                  failWith(code, `Video failed to load (YouTube error ${code}).`);
                }
              },
            },
          });
          (frame as any).__spotibaseYTBound = embedUrl;
          return true;
        } catch {
          return false;
        }
      } catch {
        return false;
      }
    };
    try {
      const w = window as any;
      if (w?.YT?.Player) {
        bindPlayer();
      } else {
        const existing = document.querySelector('script[data-spotibase-yt-api]');
        if (!existing) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          s.setAttribute('data-spotibase-yt-api', '1');
          (s as any).async = true;
          s.onload = () => {
            if (!cancelled) bindPlayer();
          };
          document.head.appendChild(s);
        }
        const prevReady = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = (...args: any[]) => {
          try {
            if (typeof prevReady === 'function') (prevReady as any)(...args);
          } catch {}
          if (!cancelled) bindPlayer();
        };
      }
    } catch {}
    const iv: any = setInterval(() => {
      if (cancelled) {
        try {
          clearInterval(iv);
        } catch {}
        return;
      }
      try {
        if ((window as any)?.YT?.Player && bindPlayer()) {
          try {
            clearInterval(iv);
          } catch {}
        }
      } catch {}
    }, 500);
    const timeout: any = setTimeout(() => {
      try {
        clearInterval(iv);
      } catch {}
    }, 10000);
    return () => {
      cancelled = true;
      try {
        clearInterval(iv);
      } catch {}
      try {
        clearTimeout(timeout);
      } catch {}
    };
  }, [embedUrl, videoId, failed, failWith, markReady]);

  const handleWebIframeError = useCallback(() => {
    failWith(null, 'Video failed to load.');
  }, [failWith]);

  const handleWebIframeLoad = useCallback(() => {
    // DOM iframe loaded — treat as ready so isPlaying commands flow; the
    // yt-ready window message (IFrame onReady) re-affirms it when present.
    markReady();
  }, [markReady]);

  // P0 iframe fullscreen escape: the YouTube chrome inside the iframe can
  // enter native DOM fullscreen (allowfullscreen). Pressing ESC exits DOM
  // fullscreen but leaves the RN store in fullscreen — reconcile by exiting
  // RN fullscreen when the document is no longer in fullscreen.
  const handleFullscreenChange = useCallback(() => {
    try {
      if (typeof document !== 'undefined') {
        const doc: any = document as any;
        const active =
          doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
        if (!active) {
          const s = useYouTubePlayerStore.getState();
          if (s.isFullscreen) s.exitFullscreen();
        }
      }
    } catch {}
  }, []);

  // Web fullscreenchange escape: same reconcile for browsers that don't fire
  // the React onFullscreenChange prop on the iframe (Safari webkit prefix).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const doc: any = document as any;
    const onChange = () => handleFullscreenChange();
    try {
      document.addEventListener('fullscreenchange', onChange);
      document.addEventListener('webkitfullscreenchange', onChange);
    } catch {}
    return () => {
      try {
        document.removeEventListener('fullscreenchange', onChange);
      } catch {}
      try {
        document.removeEventListener('webkitfullscreenchange', onChange);
      } catch {}
      void doc;
    };
  }, [handleFullscreenChange]);

  const webIframe = useMemo(() => {
    if (Platform.OS !== 'web' || !embedUrl) return null;
    const Iframe = 'iframe' as any;
    return (
      <Iframe
        key={`yt-web-${videoId}-${retryCount}-${replayNonce}`}
        ref={webIframeRef}
        src={embedUrl}
        title={video?.title ?? 'YouTube player'}
        width="100%"
        height="100%"
        style={{ width: '100%', height: '100%', borderWidth: 0, borderStyle: 'none' } as any}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder="0"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={handleWebIframeLoad}
        onError={handleWebIframeError}
        onFullscreenChange={handleFullscreenChange}
        testID="youtube-player-webview"
      />
    );
  }, [embedUrl, videoId, video?.title, retryCount, replayNonce, handleWebIframeLoad, handleWebIframeError, handleFullscreenChange]);

  if (!video) return null;

  const showFallback = failed || (playerErrorCode !== null && INLINE_BLOCKED_CODES.has(playerErrorCode));

  // Borderless embedded mode (overlay mini/expanded/fullscreen): no outer
  // margins, borders, or radius — the 16:9 frame bleeds edge-to-edge.
  // Standalone fallback keeps the card chrome (margin + border + radius 12).
  const containerStyle = borderless
    ? { backgroundColor: '#000', borderWidth: 0, borderRadius: 0, marginHorizontal: 0, marginTop: 0 }
    : { backgroundColor: '#000', borderColor: theme.colors.border };
  const frameStyle = borderless
    ? { borderRadius: 0 }
    : undefined;

  return (
    <View
      style={[styles.container, containerStyle, borderless && styles.containerBorderless]}
      accessibilityRole="none"
      accessibilityLabel={`YouTube player: ${video.title}`}
      testID={testID ?? 'youtube-player'}
    >
      {/* No title ABOVE the frame: the title/channel lives BELOW the video
          (standalone footer, overlay nowPlayingBlock). Borderless bare
          chrome (overlay mini/expanded/fullscreen) hides this row + the
          footer so the overlay owns the single close/play set — no
          duplicated close/mute chrome inside the 16:9 frame. */}
      {!borderless && onClose ? (
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close video player"
          >
            <Icon name="close" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.frame, frameStyle]} accessible accessibilityLabel="YouTube video frame">
        {resolving && !embedUrl && !showFallback ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.loadingText}>Loading video…</Text>
          </View>
        ) : null}
        {embedUrl && !showFallback ? (
          Platform.OS === 'web' ? (
            <View style={styles.webFrame}>{webIframe}</View>
          ) : (
            <WebView
              key={`yt-native-${videoId}-${retryCount}-${replayNonce}`}
              ref={webViewRef}
              source={{ html: buildNativeHtml(embedUrl, borderless, videoId ?? undefined, autoplay), baseUrl: YOUTUBE_PLAYER_BASE_URL }}
              originWhitelist={['https://*']}
              style={styles.nativeFrame}
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              startInLoadingState={false}
              onMessage={handleWebViewMessage}
              onLoadEnd={handleLoadEnd}
              // P0 iframe fullscreen escape (native): exiting the OS video
              // fullscreen must reconcile the RN store out of fullscreen so
              // the overlay doesn't stick in landscape after ESC/done.
              {...({ onFullscreenChange: handleFullscreenChange } as any)}
              onError={() => {
                failWith(null, 'Video failed to load.');
              }}
              onHttpError={() => {
                failWith(null, 'Video failed to load.');
              }}
              testID="youtube-player-webview"
            />
          )
        ) : null}
        {isMuted && embedUrl && !showFallback ? (
          <TouchableOpacity
            onPress={handleUnmute}
            style={styles.unmuteOverlay}
            accessibilityRole="button"
            accessibilityLabel="Tap to unmute"
            accessibilityHint="Restores video sound to full volume"
            testID="youtube-unmute"
            activeOpacity={0.85}
          >
            <View style={styles.unmutePill}>
              <Icon name="volume" size={16} color="#000000" />
              <Text style={styles.unmuteText}>Tap to unmute</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {showFallback ? (
          <View
            style={styles.fallback}
            accessibilityRole="alert"
            accessibilityLabel={
              playerErrorCode !== null
                ? `Video unavailable inline, YouTube error ${playerErrorCode}`
                : 'Video unavailable inline'
            }
            testID="youtube-player-fallback"
          >
            <Text style={styles.fallbackTitle} numberOfLines={2}>
              This video can&apos;t play inline
              {playerErrorCode !== null ? ` (YouTube error ${playerErrorCode})` : ''}
            </Text>
            <Text style={styles.fallbackSub} numberOfLines={3}>
              The owner restricted embedding for this video. Open it in the YouTube app instead — your
              spot stays right here.
            </Text>
            <View style={styles.fallbackActions}>
              <TouchableOpacity
                onPress={handleOpenInYouTube}
                disabled={!openUrl}
                style={[styles.primaryBtn, !openUrl && styles.disabledBtn]}
                accessibilityRole="button"
                accessibilityLabel="Open in YouTube"
                accessibilityHint={openUrl ?? 'No YouTube link available'}
                testID="youtube-open-external"
              >
                <Text style={styles.primaryBtnText}>Open in YouTube</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRetry}
                style={styles.secondaryBtn}
                accessibilityRole="button"
                accessibilityLabel="Retry video"
                testID="youtube-player-retry"
              >
                <Text style={styles.secondaryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>

      {/* Borderless bare chrome: footer (channel/state/mute) hidden when
          embedded — the overlay mini bar / fullscreen controls own the
          single play/close set. Standalone keeps the footer. */}
      {!borderless ? (
        <View style={styles.footer}>
          {!!video.channelTitle && (
            <Text style={styles.channel} numberOfLines={1}>
              {video.channelTitle}
            </Text>
          )}
          <Text style={styles.state} accessibilityLiveRegion="polite">
            {showFallback ? 'Unavailable inline' : isPlaying ? 'Now playing' : 'Paused'}
          </Text>
          {!showFallback ? (
            <TouchableOpacity
              onPress={handleToggleMute}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.muteBtn}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
              testID="youtube-mute-toggle"
            >
              <Icon name={isMuted ? 'volumeMute' : 'volume'} size={16} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
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
  // Borderless embedded override: strip standalone card chrome when the
  // player is embedded in the overlay (mini / expanded / fullscreen).
  containerBorderless: {
    borderRadius: 0,
    borderWidth: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerSpacer: { flex: 1 },
  closeBtn: { padding: 4, minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
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
  unmuteOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unmutePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    minHeight: 44,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  unmuteText: { color: '#000000', fontSize: 13, fontWeight: '800' },
  muteBtn: {
    padding: 4,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#0A0A0A',
  },
  fallbackTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  fallbackSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  fallbackActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  primaryBtn: {
    backgroundColor: '#1DB954',
    borderRadius: 20,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: { opacity: 0.5 },
  primaryBtnText: { color: '#000000', fontSize: 13, fontWeight: '800' },
  secondaryBtn: {
    borderRadius: 20,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  secondaryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
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
