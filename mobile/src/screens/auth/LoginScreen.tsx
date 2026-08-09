import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useThemeStore } from '../../store';

const LoginScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuth();
  const { theme } = useThemeStore();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      await login({ email, password });
    } catch (err: any) {
      Alert.alert('Login Failed', err.response?.data?.message || 'Invalid credentials');
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <Text style={[styles.logo, { color: theme.colors.primary }]}>SpotiBase</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Welcome back!</Text>

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
            placeholder="Password"
            placeholderTextColor={theme.colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity style={[styles.loginButton, { backgroundColor: theme.colors.primary }]} onPress={handleLogin} disabled={isLoading}>
            <Text style={[styles.loginButtonText, { color: '#000' }]}>{isLoading ? 'Signing in...' : 'Sign In'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.socialButton}>
            <Text style={[styles.socialButtonText, { color: theme.colors.text }]}>Continue with Google</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.socialButton, { borderColor: theme.colors.border }]} onPress={() => navigation?.navigate('Register')}>
            <Text style={[styles.socialButtonText, { color: theme.colors.textSecondary }]}>Don't have an account? Sign Up</Text>
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
  loginButton: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  loginButtonText: { fontSize: 16, fontWeight: '700' },
  socialButton: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  socialButtonText: { fontSize: 14, fontWeight: '500' },
});

export default LoginScreen;
