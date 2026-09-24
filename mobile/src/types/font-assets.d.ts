/**
 * Type declarations for static font assets imported directly (Expo SDK 57).
 * Submodule imports like
 * '@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf'
 * resolve to a numeric asset reference at runtime; this keeps `tsc --noEmit`
 * clean without touching the font-loading behavior.
 */
declare module '*.ttf' {
  const value: number;
  export default value;
}
