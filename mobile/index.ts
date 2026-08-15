import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';
import App from './App';

// Register TrackPlayer playback service before component registration to avoid headless task warning
TrackPlayer.registerPlaybackService(() => async () => {
  // Event handlers can be registered here if needed, otherwise handled in playerStore setup
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
