import { makeMutable } from 'react-native-reanimated';
import { Dimensions } from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const playerTranslateY = makeMutable(SCREEN_HEIGHT);
export const playerScale = makeMutable(0.95);
export const playerBorderRadius = makeMutable(12);
export const playerContentOpacity = makeMutable(0);
export const playerBackdropOpacity = makeMutable(0);
