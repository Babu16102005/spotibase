import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useThemeStore } from '../../store';

const RegisterScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
  loginLink: { fontSize: 14, textAlign: 'center', marginTop: 16 },
});

export default RegisterScreen;
