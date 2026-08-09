import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useThemeStore } from '../../store';
import {
  handleSocialLogin,
  SOCIAL_PROVIDER_LABELS,
  GOOGLE_BRAND_COLOR,
  getAppleBrandColor,
  SocialProvider,
  SocialMessage,
} from './socialAuth';

const CONNECTING_LABEL = 'Connecting...';
const UNCONFIGURED_NOTICE = 'Social login is not configured yet';

interface RegisterScreenProps {
  navigation?: any;
  /**
   * Dev/test seam (and the future auth-session hook): supplies a provider
   * idToken directly, skipping the browser step. Mirrors the
   * `idTokenOverride` parameter of handleSocialLogin.
   */
  socialIdTokenOverride?: Partial<Record<SocialProvider, string>>;
}

const RegisterScreen = ({ navigation, socialIdTokenOverride }: RegisterScreenProps) => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [socialMessage, setSocialMessage] = useState<SocialMessage | null>(null);
  const { register, isLoading } = useAuth();
  const { theme } = useThemeStore();

  const handleRegister = async () => {
    if (!email || !username || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    try {
      await register({ email, username, password });
    } catch (err: any) {
      Alert.alert('Registration Failed', err.response?.data?.message || 'Could not create account');
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
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <Text style={[styles.logo, { color: theme.colors.primary }]}>SpotiBase</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Create your account</Text>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }]}
            placeholder="Email"
            placeholderTextColor={theme.colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }]}
            placeholder="Username"
            placeholderTextColor={theme.colors.textTertiary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }]}
            placeholder="Password"
            placeholderTextColor={theme.colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity style={[styles.registerButton, { backgroundColor: theme.colors.primary }]} onPress={handleRegister} disabled={isLoading}>
            <Text style={[styles.registerButtonText, { color: '#000' }]}>{isLoading ? 'Creating account...' : 'Sign Up'}</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
            <Text style={[styles.dividerText, { color: theme.colors.textTertiary }]}>or continue with</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
          </View>

          <TouchableOpacity
            testID="social-button-google"
            style={[styles.socialButton, { borderColor: theme.colors.border }, socialButtonsDisabled && styles.socialButtonDisabled]}
            onPress={() => handleSocialLoginPress('google')}
            disabled={socialButtonsDisabled}
            accessibilityState={{ disabled: socialButtonsDisabled }}
          >
            <Text style={[styles.socialGlyph, { color: GOOGLE_BRAND_COLOR }]}>G</Text>
            <Text style={[styles.socialButtonText, { color: theme.colors.text }]}>
              {pendingProvider === 'google' ? CONNECTING_LABEL : SOCIAL_PROVIDER_LABELS.google}
            </Text>
          </TouchableOpacity>
          {socialMessage?.provider === 'google' && (
            <Text style={[styles.socialMessage, { color: socialMessage.kind === 'error' ? theme.colors.error : theme.colors.warning }]}>
              {socialMessage.text}
            </Text>
          )}

          <TouchableOpacity
            testID="social-button-apple"
            style={[styles.socialButton, { borderColor: theme.colors.border }, socialButtonsDisabled && styles.socialButtonDisabled]}
            onPress={() => handleSocialLoginPress('apple')}
            disabled={socialButtonsDisabled}
            accessibilityState={{ disabled: socialButtonsDisabled }}
          >
            {/* Apple's private-use logo glyph (U+F8FF) only renders on iOS —
                keep the button text-only so it looks right on Android and web. */}
            <Text style={[styles.socialButtonText, { color: getAppleBrandColor(theme.dark) }]}>
              {pendingProvider === 'apple' ? CONNECTING_LABEL : SOCIAL_PROVIDER_LABELS.apple}
            </Text>
          </TouchableOpacity>
          {socialMessage?.provider === 'apple' && (
            <Text style={[styles.socialMessage, { color: socialMessage.kind === 'error' ? theme.colors.error : theme.colors.warning }]}>
              {socialMessage.text}
            </Text>
          )}

          <TouchableOpacity onPress={() => navigation?.goBack()}>
            <Text style={[styles.loginLink, { color: theme.colors.textSecondary }]}>Already have an account? Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  logo: { fontSize: 42, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 40 },
  form: { gap: 16 },
  input: { height: 52, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, borderWidth: 1 },
  registerButton: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  registerButtonText: { fontSize: 16, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontWeight: '500' },
  socialButton: { height: 52, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  socialButtonDisabled: { opacity: 0.5 },
  socialGlyph: { fontSize: 16, fontWeight: '700', marginRight: 8 },
  socialButtonText: { fontSize: 14, fontWeight: '500' },
  socialMessage: { fontSize: 13, textAlign: 'center' },
  loginLink: { fontSize: 14, textAlign: 'center', marginTop: 16 },
});

export default RegisterScreen;
