import { registerRootComponent } from 'expo';
import TrackPlayer, { Event } from 'react-native-track-player';
import App from './App';

// Background playback service (UIBackgroundModes audio is kept in app.json).
// Hardware / notification / headset controls delegate to the player store.
// Dynamic imports keep the headless entry point free of require cycles — the
// factory only runs after the bundle is initialized.
TrackPlayer.registerPlaybackService(() => async () => {
  try {
    TrackPlayer.addEventListener(Event.RemotePlay, () => {
      void import('./src/store/playerStore')
        .then((m) => m.usePlayerStore.getState().resume())
        .catch(() => TrackPlayer.play().catch(() => {}));
    });
    TrackPlayer.addEventListener(Event.RemotePause, () => {
      void import('./src/store/playerStore')
        .then((m) => m.usePlayerStore.getState().pause())
        .catch(() => TrackPlayer.pause().catch(() => {}));
    });
    TrackPlayer.addEventListener(Event.RemoteStop, () => {
      void import('./src/store/playerStore')
        .then((m) => m.usePlayerStore.getState().pause())
        .catch(() => TrackPlayer.pause().catch(() => {}));
      TrackPlayer.stop().catch(() => {});
    });
    TrackPlayer.addEventListener(Event.RemoteNext, () => {
      void import('./src/store/playerStore')
        .then((m) => m.usePlayerStore.getState().next())
        .catch(() => {});
    });
    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
      void import('./src/store/playerStore')
        .then((m) => m.usePlayerStore.getState().previous())
        .catch(() => {});
    });
    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
      TrackPlayer.seekTo(event.position).catch(() => {});
    });
  } catch {}
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
