import React from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { AiOrb } from './AiOrb';
import { aiApi, songApi, searchApi } from '../api/client';
import { usePlayerStore } from '../store';
import { useYouTubePlayerStore } from '../store/youtubePlayerStore';

// ── Mocks ────────────────────────────────────────────────────────────────
// jest.setup.js already stubs expo-audio / expo-speech-recognition with
// jest.fn()s. Here we only extend behaviour per-test. api/client is fully
// mocked so no test hits the network. expo-file-system is mocked to model
// the ">2KB recording" acceptance criterion.
jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  aiApi: { text: jest.fn(), voice: jest.fn(), health: jest.fn() },
  songApi: { getById: jest.fn(), like: jest.fn() },
  searchApi: { search: jest.fn() },
}));

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: true, size: 4096, uri })),
}));

// expo-haptics is require()d lazily inside onOrbPress (try/catch) — stub it
// so the impact call is observable and never throws in Jest.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'medium' },
}), { virtual: true });

const mockGetRecordingPerms = getRecordingPermissionsAsync as jest.Mock;
const mockRequestRecordingPerms = requestRecordingPermissionsAsync as jest.Mock;
const mockSetAudioMode = setAudioModeAsync as jest.Mock;
const mockSTTRequest = ExpoSpeechRecognitionModule.requestPermissionsAsync as jest.Mock;
const mockSTTStart = ExpoSpeechRecognitionModule.start as jest.Mock;
const mockSTTStop = ExpoSpeechRecognitionModule.stop as jest.Mock;
const mockSTTAbort = ExpoSpeechRecognitionModule.abort as jest.Mock;
const mockUseSTTEvent = useSpeechRecognitionEvent as jest.Mock;
const mockAiVoice = (aiApi.voice as jest.Mock);
const mockAiText = (aiApi.text as jest.Mock);
const mockGetInfo = jest.requireMock('expo-file-system').getInfoAsync as jest.Mock;

// Handlers captured from useSpeechRecognitionEvent('result' | 'error', cb).
let sttHandlers: Record<string, (e: any) => void>;
let currentRecorder: {
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  stop: jest.Mock;
  uri: string;
} | null;

const makeRecorder = (uri = 'file://recording.m4a') => ({
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  uri,
});

const pressOrb = (getByTestId: (id: string) => any) => fireEvent.press(getByTestId('ai-orb-button'));

// Generic-error strings that must NEVER surface from the voice path.
const FORBIDDEN_GENERIC = [/unexpected/i, /something went wrong/i, /an error occurred/i, /unknown error/i];

describe('AiOrb mic voice input', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (Platform as any).OS = 'ios';
    sttHandlers = {};
    mockUseSTTEvent.mockImplementation((event: string, cb: (e: any) => void) => {
      sttHandlers[event] = cb;
    });
    currentRecorder = null;
    (AudioModule.AudioRecorder as unknown as jest.Mock).mockImplementation(() => {
      if (!currentRecorder) currentRecorder = makeRecorder();
      return currentRecorder;
    });
    mockSetAudioMode.mockResolvedValue(undefined);
    mockSTTAbort.mockImplementation(() => {});
    mockSTTStop.mockImplementation(() => {});
    mockSTTStart.mockImplementation(() => {});
    // Sane granted defaults; individual tests override for fresh-install/deny.
    mockGetRecordingPerms.mockResolvedValue({ status: 'granted', granted: true });
    mockRequestRecordingPerms.mockResolvedValue({ status: 'granted', granted: true });
    mockSTTRequest.mockResolvedValue({ status: 'granted', granted: true });
    mockAiVoice.mockResolvedValue({
      data: { actions: [], results: [{ displayText: 'Done' }], response: 'Done' },
    });
    mockAiText.mockResolvedValue({
      data: { actions: [], results: [{ displayText: 'Done' }], response: 'Done' },
    });
    mockGetInfo.mockResolvedValue({ exists: true, size: 4096, uri: 'file://recording.m4a' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (Linking as any).openSettings = jest.fn(async () => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  describe('fresh install permission prompt', () => {
    it('requests recording permission when status is undetermined (fresh install)', async () => {
      mockGetRecordingPerms.mockResolvedValue({ status: 'undetermined', granted: false });
      mockRequestRecordingPerms.mockResolvedValue({ status: 'granted', granted: true });
      currentRecorder = makeRecorder('file://fresh.m4a');

      const { getByTestId, getByText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => {
        expect(mockSTTRequest).toHaveBeenCalled();
        expect(mockGetRecordingPerms).toHaveBeenCalled();
        expect(mockRequestRecordingPerms).toHaveBeenCalledTimes(1);
        expect(mockSetAudioMode).toHaveBeenCalledWith(
          expect.objectContaining({ allowsRecording: true })
        );
        expect(currentRecorder!.prepareToRecordAsync).toHaveBeenCalled();
        expect(currentRecorder!.record).toHaveBeenCalled();
      });
      // Listening UI is surfaced.
      expect(getByText('Listening...')).toBeTruthy();
    });

    it('skips the prompt when permission is already granted', async () => {
      mockGetRecordingPerms.mockResolvedValue({ status: 'granted', granted: true });
      currentRecorder = makeRecorder('file://granted.m4a');

      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => {
        expect(mockGetRecordingPerms).toHaveBeenCalled();
        expect(currentRecorder!.record).toHaveBeenCalled();
      });
      expect(mockRequestRecordingPerms).not.toHaveBeenCalled();
    });

    it('requests STT permissions separately before starting realtime STT', async () => {
      currentRecorder = makeRecorder();
      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(mockSTTRequest).toHaveBeenCalledTimes(1));
      expect(mockSTTStart).toHaveBeenCalledWith(
        expect.objectContaining({ lang: 'en-US', interimResults: true })
      );
    });
  });

  describe('grant -> recording uri > 2KB + STT interim', () => {
    it('uploads a >2KB recording with transcript_fallback from interim STT', async () => {
      const uri = 'file://voice-note.m4a';
      currentRecorder = makeRecorder(uri);
      // Model a real 4s HIGH_QUALITY m4a (>2KB).
      mockGetInfo.mockResolvedValue({ exists: true, size: 8192, uri });

      const { getByTestId, getByText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      // Interim STT result streams live into the "You said" bubble.
      await waitFor(() => expect(mockSTTStart).toHaveBeenCalled());
      await act(async () => {
        sttHandlers['result']?.({ results: [{ transcript: 'play calm', isFinal: false }] });
      });
      expect(getByText('"play calm"')).toBeTruthy();

      // Second tap stops and uploads with the interim transcript as fallback.
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(mockAiVoice).toHaveBeenCalled());
      const [gotUri, fallback, , filename] = mockAiVoice.mock.calls[0];
      expect(gotUri).toBe(uri);
      expect(fallback).toBe('play calm');
      expect(typeof filename).toBe('string');

      // Acceptance criterion: the recorded file behind the uri is > 2KB.
      const FileSystem = jest.requireMock('expo-file-system');
      const info = await FileSystem.getInfoAsync(gotUri);
      expect(info.exists).toBe(true);
      expect(info.size).toBeGreaterThan(2 * 1024);
    });

    it('falls back to typed text when the uri is empty but interim transcript exists', async () => {
      currentRecorder = makeRecorder('');
      // stop() resolves but uri is empty (e.g. simulator with no mic data).
      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await waitFor(() => expect(mockSTTStart).toHaveBeenCalled());

      await act(async () => {
        sttHandlers['result']?.({ results: [{ transcript: 'next song', isFinal: true }] });
      });
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(mockAiText).toHaveBeenCalledWith('next song', expect.anything()));
      expect(mockAiVoice).not.toHaveBeenCalled();
    });
  });

  describe('deny -> settings', () => {
    it('shows a Microphone Permission alert with Open Settings when audio is denied', async () => {
      mockGetRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });
      mockRequestRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });

      const { getByTestId, getByPlaceholderText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
      const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toMatch(/microphone permission/i);
      expect(message).toMatch(/allow in settings/i);
      const labels = (buttons as Array<{ text: string }>).map((b) => b.text);
      expect(labels).toEqual(expect.arrayContaining(['Open Settings', 'Type Instead', 'Cancel']));
      // Order in startNativeListening: STT starts first, then audio recording.
      // On audio deny STT is aborted during cleanup and no recorder is built.
      expect(mockSTTStart).toHaveBeenCalledWith(
        expect.objectContaining({ lang: 'en-US', interimResults: true })
      );
      expect(mockSTTAbort).toHaveBeenCalled();
      expect(currentRecorder).toBeNull();
      // "Type Instead" path offers keyboard input.
      expect(getByPlaceholderText(/type a command/i)).toBeTruthy();
    });

    it('Open Settings routes to app settings via Linking', async () => {
      mockGetRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });
      mockRequestRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });

      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await waitFor(() => expect(Alert.alert).toHaveBeenCalled());

      const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
      const openSettings = buttons.find((b) => b.text === 'Open Settings');
      expect(openSettings?.onPress).toBeDefined();
      await act(async () => { openSettings!.onPress!(); });
      expect((Linking as any).openSettings).toHaveBeenCalled();
    });

    it('shows the settings guidance when STT permission itself is denied', async () => {
      mockSTTRequest.mockResolvedValue({ status: 'denied', granted: false });

      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
      expect(Alert.alert).toHaveBeenCalledWith(
        'Microphone Permission',
        expect.stringMatching(/allow in settings/i),
        expect.anything()
      );
      expect(mockSTTStart).not.toHaveBeenCalled();
    });
  });

  describe('auto-stop 7s', () => {
    it('schedules auto-stop at 7000ms and uploads without a second tap', async () => {
      jest.useFakeTimers();
      const uri = 'file://autostop.m4a';
      currentRecorder = makeRecorder(uri);
      mockGetInfo.mockResolvedValue({ exists: true, size: 5120, uri });

      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await act(async () => {
        sttHandlers['result']?.({ results: [{ transcript: 'play anirudh hits', isFinal: false }] });
      });

      expect(mockAiVoice).not.toHaveBeenCalled();
      // Advance exactly to the auto-stop deadline.
      await act(async () => { jest.advanceTimersByTime(7000); });
      // Flush the async stop -> upload chain.
      await act(async () => { jest.runOnlyPendingTimers(); });
      await act(async () => {});

      await waitFor(() => expect(mockAiVoice).toHaveBeenCalled());
      expect(mockSTTStop).toHaveBeenCalled();
      expect(currentRecorder!.stop).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('manual stop before 7s cancels the auto-stop timer (single upload)', async () => {
      jest.useFakeTimers();
      currentRecorder = makeRecorder('file://manual.m4a');

      const { getByTestId } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await act(async () => {
        sttHandlers['result']?.({ results: [{ transcript: 'pause music', isFinal: true }] });
      });
      // Manual second tap before the deadline.
      await act(async () => { jest.advanceTimersByTime(1000); });
      await act(async () => { pressOrb(getByTestId); });
      await act(async () => {});
      expect(mockAiVoice).toHaveBeenCalledTimes(1);

      // Let the original 7s deadline pass — no second upload may occur.
      await act(async () => { jest.advanceTimersByTime(10000); });
      await act(async () => {});
      expect(mockAiVoice).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('error message specificity (no generic "unexpected")', () => {
    it('never renders a generic unexpected-error string on voice failure', async () => {
      mockAiVoice.mockRejectedValueOnce({ response: { status: 500, data: { message: 'boom' } }, message: 'boom' });
      currentRecorder = makeRecorder('file://fail.m4a');

      const { getByTestId, queryByText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await act(async () => {
        sttHandlers['result']?.({ results: [{ transcript: 'play calm tamil', isFinal: true }] });
      });
      // Force the voice path (uri present) so the 500 surfaces; the component
      // retries as text when a transcript exists — either surface must be specific.
      await act(async () => { pressOrb(getByTestId); });
      await act(async () => {});

      // Collect every visible text node and assert none is generic.
      // queryByText with a regex returns the first match; null means absent.
      for (const pattern of FORBIDDEN_GENERIC) {
        expect(queryByText(pattern)).toBeNull();
      }
    });

    it('permission-denied copy names the microphone and the Settings remedy', async () => {
      mockGetRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });
      mockRequestRecordingPerms.mockResolvedValue({ status: 'denied', granted: false });

      const { getByTestId, getByText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
      const [, alertBody] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, unknown];
      expect(alertBody).toMatch(/microphone/i);
      expect(alertBody).toMatch(/settings/i);
      // Sheet response copy is equally specific (never "Unexpected error").
      await waitFor(() => expect(getByText(/microphone error:/i)).toBeTruthy());
      expect(getByText(/microphone error:/i).props.children).toBeDefined();
    });

    it('empty-capture copy is specific ("No audio") rather than generic', async () => {
      currentRecorder = makeRecorder('');
      const { getByTestId, getByText } = render(<AiOrb />);
      await act(async () => { pressOrb(getByTestId); });
      await waitFor(() => expect(mockSTTStart).toHaveBeenCalled());
      // No interim transcript and empty uri -> "No audio" branch.
      await act(async () => { pressOrb(getByTestId); });

      await waitFor(() => expect(getByText('No audio')).toBeTruthy());
      for (const pattern of FORBIDDEN_GENERIC) {
        expect(pattern.test('No audio')).toBe(false);
      }
    });
  });

  describe('PLAY_RANDOM / PLAY_LIKED (backend live-served actions)', () => {
    const mockSongGetById = (songApi.getById as jest.Mock);
    const mockSearch = (searchApi.search as jest.Mock);
    let playMultipleSpy: jest.Mock;
    let realPlayMultiple: any;

    const likedSong = (id: string, title: string) => ({
      id,
      title,
      artistName: 'Anirudh',
      albumName: 'Hits',
      duration: 200,
      audioUrl: `https://cdn/${id}.mp3`,
      coverUrl: `https://cdn/${id}.jpg`,
    });

    // Drive handleText via long-press -> keyboard mode -> Send.
    const sendTextCommand = async (screen: any, text: string) => {
      await act(async () => {
        fireEvent(screen.getByTestId('ai-orb-button'), 'longPress');
      });
      fireEvent.changeText(screen.getByPlaceholderText(/type a command/i), text);
      await act(async () => {
        fireEvent.press(screen.getByText('Send'));
      });
    };

    beforeEach(() => {
      realPlayMultiple = usePlayerStore.getState().playMultiple;
      playMultipleSpy = jest.fn(async () => {});
      usePlayerStore.setState({ playMultiple: playMultipleSpy as any });
    });

    afterEach(() => {
      act(() => {
        usePlayerStore.setState({ playMultiple: realPlayMultiple });
      });
    });

    it('PLAY_RANDOM resolves the served id and plays it via playMultiple', async () => {
      mockSongGetById.mockImplementation(async (id: string) => ({
        data: likedSong(id, 'Midnight Dreams'),
      }));
      mockAiText.mockResolvedValueOnce({
        data: {
          actions: [{ action: 'PLAY_RANDOM', parameters: {} }],
          results: [{ songs: ['r1'], displayText: 'Playing Midnight Dreams' }],
          response: 'Playing Midnight Dreams',
        },
      });

      const screen = render(<AiOrb />);
      await sendTextCommand(screen, 'play something random');

      await waitFor(() => expect(mockSongGetById).toHaveBeenCalledWith('r1'));
      await waitFor(() => expect(playMultipleSpy).toHaveBeenCalledTimes(1));
      expect(playMultipleSpy).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'r1', title: 'Midnight Dreams' })],
        0
      );
      // No searchApi fallback: the backend id is the source of truth.
      expect(mockSearch).not.toHaveBeenCalled();
      // User visibly sees the track play (previously silently ignored).
      await waitFor(() => expect(screen.getByText('Playing Midnight Dreams')).toBeTruthy());
    });

    it('PLAY_LIKED plays the full served liked queue in most-recent-first order', async () => {
      const ids = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
      mockSongGetById.mockImplementation(async (id: string) => ({
        data: likedSong(id, `Liked ${id}`),
      }));
      mockAiText.mockResolvedValueOnce({
        data: {
          actions: [{ action: 'PLAY_LIKED', parameters: {} }],
          results: [{ songs: ids, displayText: `Playing your liked songs (${ids.length} songs)` }],
          response: `Playing your liked songs (${ids.length} songs)`,
        },
      });

      const screen = render(<AiOrb />);
      await sendTextCommand(screen, 'play my liked songs');

      await waitFor(() => expect(playMultipleSpy).toHaveBeenCalledTimes(1));
      const [played, startIndex] = playMultipleSpy.mock.calls[0];
      // All 7 served ids resolve (no 5-cap truncation) in served order.
      expect(played.map((s: any) => s.id)).toEqual(ids);
      expect(startIndex).toBe(0);
      expect(mockSongGetById).toHaveBeenCalledTimes(ids.length);
      // No searchApi fallback: backend ids are the source of truth.
      expect(mockSearch).not.toHaveBeenCalled();
      // Success refines to the liked-songs line with the first title.
      await waitFor(() => expect(screen.getByText('Playing liked songs - Liked l1')).toBeTruthy());
    });
  });

  describe('PLAY_YOUTUBE (QUEUED_YOUTUBE fallback when not in local catalog)', () => {
    const mockSearch = (searchApi.search as jest.Mock);
    let playVideoSpy: jest.Mock;
    let realPlayVideo: any;

    const sendTextCommand = async (screen: any, text: string) => {
      await act(async () => {
        fireEvent(screen.getByTestId('ai-orb-button'), 'longPress');
      });
      fireEvent.changeText(screen.getByPlaceholderText(/type a command/i), text);
      await act(async () => {
        fireEvent.press(screen.getByText('Send'));
      });
    };

    beforeEach(() => {
      realPlayVideo = useYouTubePlayerStore.getState().playVideo;
      playVideoSpy = jest.fn();
      useYouTubePlayerStore.setState({ playVideo: playVideoSpy as any });
    });

    afterEach(() => {
      act(() => {
        useYouTubePlayerStore.setState({ playVideo: realPlayVideo });
      });
    });

    it('plays the lyric-identified video via the global single player + response bubble', async () => {
      mockAiText.mockResolvedValueOnce({
        data: {
          actions: [
            {
              action: 'PLAY_YOUTUBE',
              parameters: {
                videoId: 'YQHsXMglC9A',
                title: 'Hello',
                channelTitle: 'Adele',
              },
            },
          ],
          results: [{ displayText: 'Found on YouTube: Hello', status: 'QUEUED_YOUTUBE' }],
          response: 'Found on YouTube: Hello',
        },
      });

      const screen = render(<AiOrb />);
      await sendTextCommand(screen, 'hello by adele lyrics');

      await waitFor(() => expect(playVideoSpy).toHaveBeenCalledTimes(1));
      expect(playVideoSpy).toHaveBeenCalledWith({
        videoId: 'YQHsXMglC9A',
        title: 'Hello',
        channelTitle: 'Adele',
        thumbnailUrl: 'https://i.ytimg.com/vi/YQHsXMglC9A/hqdefault.jpg',
      });
      await waitFor(() => expect(screen.getByText('Playing Hello on YouTube')).toBeTruthy());
      // Audio catalog is untouched: no local search fallback for YouTube ids.
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('reads video fields from result when parameters are empty', async () => {
      mockAiText.mockResolvedValueOnce({
        data: {
          actions: [{ action: 'PLAY_YOUTUBE', parameters: {} }],
          results: [
            {
              videoId: 'YQHsXMglC9A',
              title: 'Hello',
              channelTitle: 'Adele',
              displayText: 'Found on YouTube: Hello',
              status: 'QUEUED_YOUTUBE',
            },
          ],
          response: 'Found on YouTube: Hello',
        },
      });

      const screen = render(<AiOrb />);
      await sendTextCommand(screen, 'hello adele');

      await waitFor(() => expect(playVideoSpy).toHaveBeenCalledTimes(1));
      expect(playVideoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: 'YQHsXMglC9A', title: 'Hello' })
      );
      await waitFor(() => expect(screen.getByText('Playing Hello on YouTube')).toBeTruthy());
    });

    it('shows displayText only and never plays on invalid/missing videoId', async () => {
      mockAiText.mockResolvedValueOnce({
        data: {
          actions: [{ action: 'PLAY_YOUTUBE', parameters: { videoId: 'bad', title: 'Hello' } }],
          results: [{ displayText: 'Found on YouTube: Hello', status: 'QUEUED_YOUTUBE' }],
          response: 'Found on YouTube: Hello',
        },
      });

      const screen = render(<AiOrb />);
      await sendTextCommand(screen, 'hello adele');

      await waitFor(() => expect(screen.getByText('Found on YouTube: Hello')).toBeTruthy());
      expect(playVideoSpy).not.toHaveBeenCalled();
      expect(screen.queryByText(/on YouTube.*Playing|Playing Hello on YouTube/)).toBeNull();
    });
  });
});
