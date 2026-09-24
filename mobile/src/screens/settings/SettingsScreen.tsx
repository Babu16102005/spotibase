import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { useThemeStore, usePlayerStore } from '../../store';
import { useAiOrbStore, AI_ORB_VARIANTS } from '../../store/aiOrbStore';
import { SiriOrb } from '../../components/SiriOrb';
import { StarOrb } from '../../components/StarOrb';
import GlassButton from '../../components/GlassButton';

const SettingsScreen = ({ navigation }: any) => {
  const { theme, themeMode, setThemeMode, greetingPattern, setGreetingPattern } = useThemeStore();
  const { variant: aiVariant, setVariant: setAiVariant } = useAiOrbStore();
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.headerRow}>
        {navigation?.canGoBack?.() && (
          <GlassButton
            variant="metal"
            size="icon"
            icon="chevronLeft"
            iconSize={18}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          />
        )}
        <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>App Theme</Text>
        <View style={styles.themeRow}>
          {(['DARK', 'AMOLED', 'LIGHT'] as const).map((m) => (
            <GlassButton
              key={m}
              variant={themeMode === m ? 'primary' : 'metal'}
              size="sm"
              title={m}
              onPress={() => setThemeMode(m)}
              style={{ flex: 1, minWidth: 80, justifyContent: 'center' }}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Greeting Section Theme</Text>
        <View style={styles.patternGrid}>
          {(['RANDOM', 'FLUID', 'AURORA', 'COSMIC', 'GEOMETRIC'] as const).map((pat) => (
            <GlassButton
              key={pat}
              variant={greetingPattern === pat ? 'primary' : 'glass'}
              size="sm"
              title={pat}
              onPress={() => setGreetingPattern(pat)}
              style={{ borderRadius: 14 }}
              textStyle={{ fontSize: 11 }}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>AI Orb Style</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary, marginBottom: 12 }]}>Choose your AI assistant orb (Siri design) - default is Classic</Text>
        <View style={styles.orbGrid}>
          {(Object.entries(AI_ORB_VARIANTS) as Array<[keyof typeof AI_ORB_VARIANTS, typeof AI_ORB_VARIANTS[keyof typeof AI_ORB_VARIANTS]]>).map(([key, v]) => {
            const selected = aiVariant === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setAiVariant(key)}
                style={[
                  styles.orbCard,
                  { backgroundColor: theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.border, borderWidth: selected ? 2 : 1 },
                ]}
              >
                {key === 'midnight' ? (
                  <StarOrb size="72px" />
                ) : (
                  <SiriOrb size="72px" colors={v.colors} animationDuration={12} />
                )}
                <Text style={[styles.orbLabel, { color: theme.colors.text }]}>{v.label}</Text>
                <Text style={[styles.orbDesc, { color: theme.colors.textTertiary }]}>{v.desc}</Text>
                {selected && <Text style={[styles.orbCheck, { color: theme.colors.primary }]}>✓ Selected</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Playback</Text>
        <View style={[styles.settingRow, { borderBottomColor: theme.colors.border }]}>
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Shuffle</Text>
          <Switch value={shuffle} onValueChange={setShuffle} trackColor={{ true: theme.colors.primary }} />
        </View>
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Repeat</Text>
          <GlassButton
            variant="glass"
            size="sm"
            title={repeat === 'off' ? 'Off' : repeat === 'all' ? 'All' : 'One'}
            onPress={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
            textStyle={{ color: theme.colors.primary }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Microphone (AI Voice)</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary, marginBottom: 12 }]}>AI voice needs microphone. If it says unavailable, test here.</Text>
        <GlassButton
          variant="primary"
          size="sm"
          title="Test Microphone"
          onPress={async () => {
            try {
              if (Platform.OS === 'web') {
                const host = typeof window !== 'undefined' ? (window.location?.hostname || '') : '';
                const protocol = typeof window !== 'undefined' ? (window.location?.protocol || '') : '';
                const isSecure =
                  typeof window !== 'undefined'
                    ? Boolean((window as any).isSecureContext) || protocol === 'https:' || host === 'localhost' || host === '127.0.0.1' || host === ''
                    : true;
                if (!isSecure) {
                  Alert.alert(
                    'Mic Blocked (Insecure Context)',
                    `Browser blocks the mic on insecure origin "${host}". Open via http://localhost:8081 (secure context, not a 10.247... LAN IP) and click Allow, then test again.`
                  );
                  return;
                }
                try {
                  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                  s.getTracks().forEach(t => t.stop());
                  Alert.alert('Mic OK', 'Browser microphone works! Use orb on http://localhost:8081 (secure context) and Allow when prompted.');
                } catch (e: any) {
                  const name = e?.name || 'Error';
                  const hint =
                    name === 'NotAllowedError'
                      ? ' Permission denied — click the lock icon → Allow, then retry.'
                      : name === 'NotFoundError'
                        ? ' No microphone device found.'
                        : name === 'NotReadableError'
                          ? ' Mic is held by another app — close it and retry.'
                          : '';
                  Alert.alert(
                    'Mic Error',
                    `Browser mic failed (${name}): ${e?.message || e}.${hint} Use http://localhost:8081 (secure context), not a LAN IP.`
                  );
                }
              } else {
                const { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } = await import('expo-audio');
                const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
                // BOTH permissions: audio recorder + speech recognizer (Expo v57 needs each).
                const audioCurrent = await getRecordingPermissionsAsync();
                const audioPerm = audioCurrent.status === 'granted' ? audioCurrent : await requestRecordingPermissionsAsync();
                let speechPerm: any = null;
                try {
                  const cur = await (ExpoSpeechRecognitionModule as any).getPermissionsAsync?.();
                  speechPerm = cur?.granted ? cur : await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                } catch {
                  try {
                    speechPerm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                  } catch (e: any) {
                    speechPerm = { status: 'unavailable', granted: false };
                  }
                }
                // Recognition service availability (network / device service).
                let recognitionAvailable: boolean | null = null;
                try {
                  recognitionAvailable = (ExpoSpeechRecognitionModule as any).isRecognitionAvailable?.() ?? null;
                } catch {
                  recognitionAvailable = null;
                }
                const audioStatus = (audioPerm as any)?.status || 'unknown';
                const speechStatus = (speechPerm as any)?.status || 'unknown';
                const availLine =
                  recognitionAvailable === true
                    ? 'Speech service: available'
                    : recognitionAvailable === false
                      ? 'Speech service: UNAVAILABLE (check network / device recognition service)'
                      : 'Speech service: unknown';
                const body =
                  `Audio mic: ${audioStatus}\nSpeech recognition: ${speechStatus}\n${availLine}\n\n` +
                  `If denied, go to Phone Settings -> Apps -> SpotiBase -> Permissions -> Microphone -> Allow, then tap again.\n\n` +
                  `If using Expo Go, allow for Expo Go app.\n\n` +
                  `Web hint: use http://localhost:8081 (secure context), not a LAN IP, and Allow.`;
                Alert.alert('Mic Status', body);
                if ((audioPerm as any)?.status === 'denied' || (speechPerm as any)?.status === 'denied') {
                  const { Linking } = await import('react-native');
                  Alert.alert('Open Settings?', 'Mic or speech permission is denied. Go to app settings to allow?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                  ]);
                } else if (recognitionAvailable === false) {
                  Alert.alert(
                    'Speech Service Unavailable',
                    'Recognition service reports unavailable. Check network connection and device speech service, then retry.'
                  );
                }
              }
            } catch (e: any) {
              Alert.alert('Mic Error', `Microphone test failed: ${e?.message || String(e)}. Check permissions and secure context (localhost:8081 on web), then retry.`);
            }
          }}
          style={{ alignSelf: 'flex-start' }}
        />
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary, marginTop: 8, fontSize: 12 }]}>Web: must open http://localhost:8081 (not 10.247...) and click Allow. Android: must be installed APK (not browser) → Settings → Apps → SpotiBase → Allow.</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>About</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary }]}>SpotiBase v1.0.0</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary }]}>A premium music streaming experience</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    gap: 12,
  },
  title: { fontSize: 28, fontWeight: '800' },
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  themeRow: { flexDirection: 'row', gap: 8 },
  patternGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5 },
  settingLabel: { fontSize: 16 },
  aboutText: { fontSize: 14, marginTop: 4 },
  orbGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  orbCard: { width: 105, alignItems: 'center', padding: 12, borderRadius: 16, gap: 6 },
  orbLabel: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  orbDesc: { fontSize: 10, textAlign: 'center' },
  orbCheck: { fontSize: 10, fontWeight: '800', marginTop: 2 },
});

export default SettingsScreen;
