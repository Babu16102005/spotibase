import { Linking, Platform } from 'react-native';
import { useAuthStore } from '../../store';

/**
 * Social login plumbing shared by the auth screens.
 *
 * The full interactive flow — authorize in the provider's browser, then read
 * the idToken back from the redirect URI — needs an auth-session library such
 * as `expo-auth-session` (a documented follow-up; no new dependencies allowed
 * in this change). What exists today:
 *
 * - Client ids come from EXPO_PUBLIC_GOOGLE_CLIENT_ID / EXPO_PUBLIC_APPLE_CLIENT_ID.
 *   When unset, handleSocialLogin returns `unconfigured` WITHOUT calling the
 *   API and the screens render a graceful inline notice.
 * - When set, the handler opens the provider's authorization URL through
 *   React Native's Linking (web: `<origin>/auth/callback`, native:
 *   `spotibase://auth` — expo-linking is not a dependency, so this is the
 *   plain URL form; registering the deep link is part of the follow-up).
 * - An optional idTokenOverride bypasses the browser step entirely for
 *   programmatic/testing use (and later for the auth-session integration):
 *   the token is exchanged via authApi.socialAuth and persisted through the
 *   exact same authStore path email login uses.
 */

export type SocialProvider = 'google' | 'apple';

export type SocialLoginResult =
  | { status: 'unconfigured' }
  | { status: 'opened' }
  | { status: 'success' }
  | { status: 'error'; message: string };

/** Inline message state surfaced by the auth screens below the tapped button. */
export interface SocialMessage {
  provider: SocialProvider;
  kind: 'notice' | 'error';
  text: string;
}

export const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
};

/** Google's brand blue, used for the "G" glyph (ASCII, renders everywhere). */
export const GOOGLE_BRAND_COLOR = '#4285F4';

/** Apple's brand color flips with the theme (black on light, white on dark). */
export const getAppleBrandColor = (dark: boolean): string =>
  dark ? '#FFFFFF' : '#000000';

export const isSocialConfigured = (provider: SocialProvider): boolean =>
  provider === 'google'
    ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID)
    : Boolean(process.env.EXPO_PUBLIC_APPLE_CLIENT_ID);

export const getSocialClientId = (provider: SocialProvider): string | undefined =>
  provider === 'google'
    ? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID
    : process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;

/**
 * Builds the provider's OIDC authorization URL from the configured client id.
 * A proper session library would handle the redirect; without one we target
 * the app's own origin on web and the `spotibase://auth` custom scheme on
 * native.
 */
export const buildSocialAuthUrl = (provider: SocialProvider): string => {
  const clientId = getSocialClientId(provider);
  if (!clientId) return '';

  const authEndpoint =
    provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://appleid.apple.com/auth/authorize';

  const redirectUri =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : 'spotibase://auth';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: provider === 'google' ? 'openid email profile' : 'openid name email',
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });

  return `${authEndpoint}?${params.toString()}`;
};

export const handleSocialLogin = async (
  provider: SocialProvider,
  idTokenOverride?: string
): Promise<SocialLoginResult> => {
  if (!isSocialConfigured(provider)) {
    // Client id not configured: stay fully offline and let the UI show the
    // "Social login is not configured yet" notice.
    return { status: 'unconfigured' };
  }

  if (!idTokenOverride) {
    // Interactive path without a token yet: open the provider's auth page.
    // Turning the redirect into an idToken is the auth-session follow-up.
    try {
      await Linking.openURL(buildSocialAuthUrl(provider));
      return { status: 'opened' };
    } catch {
      return { status: 'error', message: 'Could not open the sign-in page' };
    }
  }

  try {
    // Same persistence path as email login: authStore swaps the idToken for
    // tokens + user via the backend and marks the session authenticated.
    await useAuthStore.getState().socialAuth(provider, idTokenOverride);
    return { status: 'success' };
  } catch (err: any) {
    return {
      status: 'error',
      message: err?.response?.data?.message || 'Social login failed',
    };
  }
};
