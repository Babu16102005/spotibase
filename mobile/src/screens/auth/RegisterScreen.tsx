import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Alert, Image, ScrollView } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useThemeStore } from '../../store';
import GlassButton from '../../components/GlassButton';

const LOGIN_LOGO = require('../../../assets/loginlogo.png');
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
      const message = err.response?.data?.message || (err.response ? 'Could not create account' : 'Unable to connect to backend server');
      Alert.alert('Registration Failed', message);
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

            <GlassButton
              variant="primary"
              size="lg"
              fullWidth
              title={isLoading ? 'Creating account...' : 'Sign Up'}
              onPress={handleRegister}
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
              variant="ghost"
              size="md"
              fullWidth
              title="Already have an account? Sign In"
              onPress={() => navigation?.goBack()}
              style={{ marginTop: 8 }}
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
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 32 },
  form: { gap: 14 },
  input: { height: 52, borderRadius: 24, paddingHorizontal: 20, fontSize: 16, borderWidth: 1 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
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
  socialMessage: { fontSize: 13, textAlign: 'center' },
});

export default RegisterScreen;
