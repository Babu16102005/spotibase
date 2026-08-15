/**
 * Type declarations for react-native-vector-icons (no bundled types).
 * Imported by DownloadButton.tsx and DownloadsScreen.tsx.
 */
declare module 'react-native-vector-icons/Ionicons' {
  import { Component } from 'react';
  import { TextProps } from 'react-native';

  interface IconProps extends TextProps {
    name: string;
    size?: number;
    color?: string;
  }

  export default class Ionicons extends Component<IconProps> {}
}