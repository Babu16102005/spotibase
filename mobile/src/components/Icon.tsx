import React from 'react';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';
import { ViewStyle } from 'react-native';

export type IconName =
  | 'home'
  | 'search'
  | 'library'
  | 'songs'
  | 'profile'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'shuffle'
  | 'repeat'
  | 'repeatOne'
  | 'heart'
  | 'heartFilled'
  | 'download'
  | 'upload'
  | 'more'
  | 'chevronLeft'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronUp'
  | 'settings'
  | 'bell'
  | 'queue'
  | 'plus'
  | 'music'
  | 'close'
  | 'google'
  | 'apple'
  | 'check'
  | 'mic'
  | 'volume'
  | 'volumeMute'
  | 'trash'
  | 'sync'
  | 'refresh'
  | 'folder';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: ViewStyle;
  testID?: string;
}

/**
 * SpotiBase icon set — hand-drawn, stroke-based, Spotify-style line icons
 * rendered with react-native-svg (works on native and web).
 */
const Icon: React.FC<IconProps> = ({ name, size = 24, color = '#FFFFFF', style, testID }) => {
  const stroke = color;
  const fill = color;
  const sw = 1.8;

  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <Path d="M3 10.5L12 3l9 7.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    search: (
      <G>
        <Circle cx="11" cy="11" r="7" stroke={stroke} strokeWidth={sw} fill="none" />
        <Path d="M16.5 16.5L21 21" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    library: (
      <>
        <Path d="M4 21V5.5a1 1 0 0 1 1-1h2.2a1 1 0 0 1 1 1V21" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M9 21V5.5a1 1 0 0 1 1-1h2.2a1 1 0 0 1 1 1V21" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M14 21V7.2a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1V21" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3 21h18" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    songs: (
      <>
        <Path d="M9 18.5V5l11-2v13.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="6.5" cy="18.5" r="2.5" stroke={stroke} strokeWidth={sw} fill="none" />
        <Circle cx="17.5" cy="16.5" r="2.5" stroke={stroke} strokeWidth={sw} fill="none" />
      </>
    ),
    profile: (
      <G>
        <Circle cx="12" cy="8" r="4" stroke={stroke} strokeWidth={sw} fill="none" />
        <Path d="M4.5 20.5c1.5-3.5 4.2-5 7.5-5s6 1.5 7.5 5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </G>
    ),
    play: <Path d="M7 4.5v15l13-7.5z" fill={fill} />,
    pause: (
      <>
        <Rect x="6.5" y="4.5" width="4" height="15" rx="1.2" fill={fill} />
        <Rect x="13.5" y="4.5" width="4" height="15" rx="1.2" fill={fill} />
      </>
    ),
    next: (
      <>
        <Path d="M5 5v14l9.5-7z" fill={fill} />
        <Rect x="16.5" y="5" width="2.6" height="14" rx="1" fill={fill} />
      </>
    ),
    previous: (
      <>
        <Path d="M19 5v14l-9.5-7z" fill={fill} />
        <Rect x="4.9" y="5" width="2.6" height="14" rx="1" fill={fill} />
      </>
    ),
    shuffle: (
      <>
        <Path d="M3 6.5h3.4c5 0 5.6 11 10.6 11H21" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M17.5 21l3.5-3.5-3.5-3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3 17.5h3.4c1.8 0 3-1 4.1-2.3" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M17.5 3L21 6.5l-3.5 3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3 6.5h3.4c1.8 0 3 1 4.1 2.3" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </>
    ),
    repeat: (
      <>
        <Path d="M17 3.5l3.5 3.5-3.5 3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M20.5 7H8.5a5 5 0 0 0-5 5v.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M7 20.5L3.5 17l3.5-3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3.5 17h12a5 5 0 0 0 5-5v-.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </>
    ),
    repeatOne: (
      <>
        <Path d="M17 3.5l3.5 3.5-3.5 3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M20.5 7H8.5a5 5 0 0 0-5 5v.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M7 20.5L3.5 17l3.5-3.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3.5 17h12a5 5 0 0 0 5-5v-.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <TextTest />
      </>
    ),
    heart: (
      <Path
        d="M12 20.5S4 15.2 4 9.8C4 6.9 6.2 5 8.6 5c1.5 0 2.7.8 3.4 2 .7-1.2 1.9-2 3.4-2C17.8 5 20 6.9 20 9.8c0 5.4-8 10.7-8 10.7z"
        stroke={stroke}
        strokeWidth={sw}
        fill="none"
        strokeLinejoin="round"
      />
    ),
    heartFilled: (
      <Path
        d="M12 20.5S4 15.2 4 9.8C4 6.9 6.2 5 8.6 5c1.5 0 2.7.8 3.4 2 .7-1.2 1.9-2 3.4-2C17.8 5 20 6.9 20 9.8c0 5.4-8 10.7-8 10.7z"
        fill={fill}
      />
    ),
    download: (
      <>
        <Path d="M12 4v11" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M7.5 10.5L12 15l4.5-4.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M4.5 18.5h15" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    upload: (
      <>
        <Path d="M12 15V4" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M7.5 8.5L12 4l4.5 4.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M4.5 18.5h15" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    more: (
      <G fill={fill}>
        <Circle cx="5" cy="12" r="1.6" />
        <Circle cx="12" cy="12" r="1.6" />
        <Circle cx="19" cy="12" r="1.6" />
      </G>
    ),
    chevronLeft: <Path d="M14.5 5.5L8 12l6.5 6.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    chevronRight: <Path d="M9.5 5.5L16 12l-6.5 6.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    chevronDown: <Path d="M5.5 9.5L12 16l6.5-6.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    chevronUp: <Path d="M18.5 14.5L12 8l-6.5 6.5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    settings: (
      <G>
        <Circle cx="12" cy="12" r="3.2" stroke={stroke} strokeWidth={sw} fill="none" />
        <Path
          d="M12 3.5l1.1 2.3 2.5-.7 1 2.3 2.4.9-.3 2.6 1.8 1.8-1.8 1.8.3 2.6-2.4.9-1 2.3-2.5-.7-1.1 2.3-1.1-2.3-2.5.7-1-2.3-2.4-.9.3-2.6L3.3 12l1.8-1.8-.3-2.6 2.4-.9 1-2.3 2.5.7z"
          stroke={stroke}
          strokeWidth={1.4}
          fill="none"
          strokeLinejoin="round"
        />
      </G>
    ),
    bell: (
      <G>
        <Path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2.5 6.5H3.5C4.5 15.5 6 14 6 10z" stroke={stroke} strokeWidth={sw} fill="none" strokeLinejoin="round" />
        <Path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </G>
    ),
    queue: (
      <>
        <Path d="M4 6.5h16" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M4 12h16" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M4 17.5h9" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    plus: (
      <>
        <Path d="M12 5v14" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M5 12h14" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    music: (
      <>
        <Path d="M9 17.5V5.5L20 3.5v12" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="6.5" cy="17.5" r="2.5" stroke={stroke} strokeWidth={sw} fill="none" />
        <Circle cx="17.5" cy="15.5" r="2.5" stroke={stroke} strokeWidth={sw} fill="none" />
      </>
    ),
    close: (
      <>
        <Path d="M6 6l12 12" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M18 6L6 18" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>
    ),
    google: (
      <G>
        <Path d="M21.5 12.2c0-.7-.06-1.4-.18-2H12v3.8h5.34a4.4 4.4 0 0 1-1.9 2.9v2.4h3.08c1.8-1.66 2.98-4.1 2.98-7.1z" fill="#4285F4" />
        <Path d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.08-2.4c-.85.57-1.94.9-3.54.9-2.72 0-5.02-1.84-5.84-4.3H2.98v2.48A10 10 0 0 0 12 22z" fill="#34A853" />
        <Path d="M6.16 13.78A6 6 0 0 1 6.16 10.2V7.72H2.98a10 10 0 0 0 0 9.54l3.18-2.48z" fill="#FBBC05" />
        <Path d="M12 5.5c1.47 0 2.79.5 3.83 1.5l2.86-2.86A10 10 0 0 0 2.98 7.72l3.18 2.48c.82-2.46 3.12-4.3 5.84-4.3z" fill="#EA4335" />
      </G>
    ),
    apple: (
      <Path
        d="M16.7 12.9c-.03-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.88-1.48-.15-2.89.87-3.64.87-.75 0-1.9-.85-3.13-.83-1.61.02-3.1.94-3.93 2.38-1.67 2.9-.43 7.2 1.2 9.55.8 1.15 1.75 2.45 3 2.4 1.2-.05 1.66-.78 3.11-.78 1.45 0 1.86.78 3.13.75 1.3-.02 2.12-1.17 2.91-2.33.92-1.34 1.3-2.64 1.32-2.71-.03-.01-2.53-.97-2.54-3.8zM14.25 5.6c.66-.8 1.1-1.91.98-3.02-1.03.04-2.23.66-2.96 1.5-.65.74-1.22 1.93-1.07 3.06 1.11.09 2.38-.57 3.05-1.54z"
        fill={fill}
      />
    ),
    check: (
      <Path d="M4.5 12.5l5 5L19.5 6.5" stroke={stroke} strokeWidth={sw + 0.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ),
    mic: (
      <G>
        <Rect x="9" y="3" width="6" height="11" rx="3" stroke={stroke} strokeWidth={sw} fill="none" />
        <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M12 18v3.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    volume: (
      <G>
        <Path d="M6 15v-3l6-4.5V15" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M15.5 17a5 5 0 0 0 0-10" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M19.5 21a9 9 0 0 0 0-18" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </G>
    ),
    volumeMute: (
      <G>
        <Path d="M6 15v-3l6-4.5V15" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M16 4l8 8M24 4l-8 8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    trash: (
      <G>
        <Path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M10 11v6M14 11v6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    sync: (
      <G>
        <Path d="M21 3v5h-5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M21 8A9 9 0 0 0 5.6 5.6L3 8.2" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M3 21v-5h5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3 16a9 9 0 0 0 15.4 2.4l2.6-2.6" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </G>
    ),
    refresh: (
      <G>
        <Path d="M21 3v5h-5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M21 8A9 9 0 0 0 5.6 5.6L3 8.2" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Path d="M3 21v-5h5" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M3 16a9 9 0 0 0 15.4 2.4l2.6-2.6" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </G>
    ),
    folder: (
      <G>
        <Path
          d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2a1.5 1.5 0 0 1 1.1.5L11.5 7h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z"
          stroke={stroke}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    ),
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style} testID={testID}>
      {paths[name]}
    </Svg>
  );
};

/** Tiny helper so repeatOne renders a "1" inside the loop (keeps icon crisp at small sizes). */
const TextTest: React.FC = () => {
  // Number glyph drawn with lines instead of <Text> for cross-platform consistency.
  return (
    <>
      <Path d="M12 14.2v-4.4l-1.6 1.2" stroke="#fff" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
};

export default Icon;
