import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView, Image } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useThemeStore } from '../../store';
import Icon from '../../components/Icon';
import GlassButton from '../../components/GlassButton';

const LOGIN_LOGO = require('../../../assets/loginlogo.png');
import {
  handleSocialLogin,
  SOCIAL_PROVIDER_LABELS,
  getAppleBrandColor,
  SocialProvider,
  SocialMessage,
} from './socialAuth';
import { BASE_URL } from '../../api/client';

const CONNECTING_LABEL = 'Connecting...';
const UNCONFIGURED_NOTICE = 'Social login is not configured yet';

interface LoginScreenProps {
  navigation?: any;
  /**
   * Dev/test seam (and the future auth-session hook): supplies a provider
   * idToken directly, skipping the browser step. Mirrors the
   * `idTokenOverride` parameter of handleSocialLogin.
   */
  socialIdTokenOverride?: Partial<Record<SocialProvider, string>>;
}

const LoginScreen = ({ navigation, socialIdTokenOverride }: LoginScreenProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [socialMessage, setSocialMessage] = useState<SocialMessage | null>(null);
  const { login, isLoading } = useAuth();
  const { theme } = useThemeStore();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      await login({ email, password });
    } catch (err: any) {
      const message =
        err.response?.data?.message ||
        (err.response ? 'Invalid credentials' : `Unable to connect to backend server at ${BASE_URL}`);
      Alert.alert('Login Failed', message);
    }
  };

  const handleSocialLoginPress = async (provider: SocialProvider, idTokenOverride?: string) => {
    setSocialMessage(null);
    setPendingProvider(provider);
    const result = await handleSocialLogin(provider, idTokenOverride ?? socialIdTokenOverride?.[provider]);
    setPendingProvider(null);
    if (result.status === 'unconfigured') {
      setSocialMessage({ provider, kind: 'notice', text: UNCONFIGURED_NOTICE });
    } else if (result.status === 'error') {
      setSocialMessage({ provider, kind: 'error', text: result.message });
    }
  };

  const socialButtonsDisabled = pendingProvider !== null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <Image
              source={LOGIN_LOGO}
              style={styles.heroLogo}
              resizeMode="contain"
              accessibilityLabel="SpotiBase Logo"
            />
          </View>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            Millions of songs. Free on SpotiBase.
          </Text>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }]}
              placeholder="Email or username"
              placeholderTextColor={theme.colors.textTertiary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              accessibilityLabel="Email or username"
            />
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }]}
              placeholder="Password"
              placeholderTextColor={theme.colors.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              accessibilityLabel="Password"
            />

            <GlassButton
              variant="primary"
              size="lg"
              fullWidth
              title={isLoading ? 'Signing in...' : 'Sign In'}
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              style={{ marginTop: 8 }}
            />

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
              <Text style={[styles.dividerText, { color: theme.colors.textTertiary }]}>or continue with</Text>
              <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
            </View>

            <View style={styles.socialRow}>
              <View style={styles.socialCol}>
                <GlassButton
                  testID="social-button-google"
                  variant="metal"
                  size="md"
                  fullWidth
                  icon="google"
                  iconSize={18}
                  title={pendingProvider === 'google' ? CONNECTING_LABEL : SOCIAL_PROVIDER_LABELS.google}
                  onPress={() => handleSocialLoginPress('google')}
                  disabled={socialButtonsDisabled}
                />
              </View>
              <View style={styles.socialCol}>
                <GlassButton
                  testID="social-button-apple"
                  variant="metal"
                  size="md"
                  fullWidth
                  icon="apple"
                  iconSize={18}
                  iconColor={getAppleBrandColor(theme.dark)}
                  title={pendingProvider === 'apple' ? CONNECTING_LABEL : SOCIAL_PROVIDER_LABELS.apple}
                  onPress={() => handleSocialLoginPress('apple')}
                  disabled={socialButtonsDisabled}
                  textStyle={{ color: getAppleBrandColor(theme.dark) }}
                />
              </View>
            </View>
            {socialMessage && (
              <Text style={[styles.socialMessage, { color: socialMessage.kind === 'error' ? theme.colors.error : theme.colors.warning }]}>
                {socialMessage.text}
              </Text>
            )}

            <GlassButton
              variant="outline"
              size="lg"
              fullWidth
              title="Sign Up for SpotiBase"
              onPress={() => navigation?.navigate('Register')}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: 28, paddingVertical: 32 },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroLogo: {
    width: 96,
    height: 96,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
    opacity: 0.85,
  },
  form: { gap: 12 },
  input: {
    height: 52,
    borderRadius: 24,
    paddingHorizontal: 20,
    fontSize: 16,
    borderWidth: 1,
  },
  loginButton: {
    height: 52,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonText: { fontSize: 16, fontWeight: '800', color: '#000000' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  socialCol: {
    flex: 1,
  },
  socialButton: {
    height: 52,
    borderRadius: 999,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    gap: 10,
  },
  socialButtonDisabled: { opacity: 0.5 },
  socialButtonText: { fontSize: 14, fontWeight: '700' },
  socialMessage: { fontSize: 13, textAlign: 'center' },
  signupButton: {
    height: 52,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 8,
  },
  signupText: { fontSize: 14, fontWeight: '700' },
});

export default LoginScreen;