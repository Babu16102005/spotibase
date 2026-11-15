/**
 * AiOrb Jarvis voice (expo-speech SDK v57) + CHAT action.
 *
 * Contract: CHAT returns results [{status: CHAT_OK, songs: [], displayText}],
 * response mirrors it. CHAT shows response/displayText in the bubble and
 * speaks it — never playback, never search.
 *
 * Voice replies: every Jarvis reply (play actions + CHAT + clarifications)
 * goes through Speech.speak with state 'speaking' while talking;
 * Speech.stop runs before new speak / re-listen / close / unmount;
 * onDone/onStopped/onError -> 'done'.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { AudioModule, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { AiOrb } from './AiOrb';
import { aiApi, songApi, searchApi } from '../api/client';
import { usePlayerStore } from '../store';
import { useYouTubePlayerStore } from '../store/youtubePlayerStore';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  aiApi: { text: jest.fn(), voice: jest.fn(), health: jest.fn() },
  songApi: { getById: jest.fn(), like: jest.fn() },
  searchApi: { search: jest.fn() },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'medium' },
}), { virtual: true });

const mockAiText = aiApi.text as jest.Mock;
const mockSongGetById = songApi.getById as jest.Mock;
const mockSearch = searchApi.search as jest.Mock;
const mockSpeak = Speech.speak as jest.Mock;
const mockStop = Speech.stop as jest.Mock;
const mockUseSTTEvent = useSpeechRecognitionEvent as jest.Mock;

const sendTextCommand = async (screen: any, text: string) => {
  await act(async () => {
    fireEvent(screen.getByTestId('ai-orb-button'), 'longPress');
  });
  fireEvent.changeText(screen.getByPlaceholderText(/type a command/i), text);
  await act(async () => {
    fireEvent.press(screen.getByText('Send'));
  });
};

describe('AiOrb Jarvis voice + CHAT', () => {
  let playMultipleSpy: jest.Mock;
  let realPlayMultiple: any;
  let playVideoSpy: jest.Mock;
  let realPlayVideo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (Platform as any).OS = 'ios';
    mockUseSTTEvent.mockImplementation(() => {});
    // Native mic doubles as the re-listen path: grant + working recorder so
    // tapping the orb while speaking reaches `listening` (not an error).
    (AudioModule.AudioRecorder as unknown as jest.Mock).mockImplementation(() => ({
      prepareToRecordAsync: jest.fn(async () => {}),
      record: jest.fn(async () => {}),
      stop: jest.fn(async () => {}),
      uri: 'file://recording.m4a',
    }));
    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true });
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true });
    (setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    (ExpoSpeechRecognitionModule.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true });
    (ExpoSpeechRecognitionModule.start as jest.Mock).mockImplementation(() => {});
    (ExpoSpeechRecognitionModule.stop as jest.Mock).mockImplementation(() => {});
    (ExpoSpeechRecognitionModule.abort as jest.Mock).mockImplementation(() => {});
    mockAiText.mockResolvedValue({
      data: { actions: [], results: [{ displayText: 'Done' }], response: 'Done' },
    });
    mockSongGetById.mockResolvedValue({ data: null });
    mockSearch.mockResolvedValue({ data: { songs: [] } });

    realPlayMultiple = usePlayerStore.getState().playMultiple;
    playMultipleSpy = jest.fn(async () => {});
    usePlayerStore.setState({ playMultiple: playMultipleSpy as any });

    realPlayVideo = useYouTubePlayerStore.getState().playVideo;
    playVideoSpy = jest.fn();
    useYouTubePlayerStore.setState({ playVideo: playVideoSpy as any });
  });

  afterEach(() => {
    act(() => {
      usePlayerStore.setState({ playMultiple: realPlayMultiple });
      useYouTubePlayerStore.setState({ playVideo: realPlayVideo });
    });
    jest.useRealTimers();
  });

  it('CHAT displays Jarvis text, speaks it, and never plays or searches', async () => {
    const jarvis = 'Hey boss! I am Jarvis, always here for you. What should we play?';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: jarvis }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'how are you jarvis');

    // Bubble shows the Jarvis text.
    await waitFor(() => expect(screen.getByText(jarvis)).toBeTruthy());
    // No playback: local player untouched, no catalog search, no YouTube.
    expect(playMultipleSpy).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(playVideoSpy).not.toHaveBeenCalled();
    expect(mockSongGetById).not.toHaveBeenCalled();
    // Voice reply: spoken as-is with done/stopped/error callbacks.
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    expect(mockSpeak).toHaveBeenCalledWith(
      jarvis,
      expect.objectContaining({
        onDone: expect.any(Function),
        onStopped: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('CHAT falls back to top-level response when result displayText is blank', async () => {
    const jarvis = 'Anytime, boss! Happy to help.';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: '' }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'thank you');

    await waitFor(() => expect(screen.getByText(jarvis)).toBeTruthy());
    expect(playMultipleSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(mockSpeak).toHaveBeenCalledWith(
      jarvis,
      expect.objectContaining({ onDone: expect.any(Function) }),
    ));
  });

  it('play actions speak the refined Playing line (single speak owner)', async () => {
    mockSongGetById.mockImplementation(async (id: string) => ({
      data: {
        id,
        title: 'Midnight Dreams',
        artistName: 'Anirudh',
        albumName: 'Hits',
        duration: 200,
        audioUrl: `https://cdn/${id}.mp3`,
        coverUrl: `https://cdn/${id}.jpg`,
      },
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

    await waitFor(() => expect(playMultipleSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Playing Midnight Dreams')).toBeTruthy());
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    // Refined line is what Jarvis says — never the generic Done.
    expect(mockSpeak).toHaveBeenCalledWith(
      'Playing Midnight Dreams',
      expect.objectContaining({ onDone: expect.any(Function) }),
    );
  });

  it('clarifications speak the question', async () => {
    const q = "Sorry boss, I didn't catch that. Try one of these: 'Play calm Tamil songs'";
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [],
        results: [],
        response: '',
        clarificationNeeded: true,
        clarificationQuestion: q,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'asdfgh');

    await waitFor(() => expect(screen.getByText(q)).toBeTruthy());
    await waitFor(() => expect(mockSpeak).toHaveBeenCalledWith(
      q,
      expect.objectContaining({ onDone: expect.any(Function) }),
    ));
    expect(playMultipleSpy).not.toHaveBeenCalled();
  });

  it('onDone/onStopped/onError resolve speaking back to done', async () => {
    const jarvis = 'Hey boss! I am Jarvis.';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: jarvis }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'hello jarvis');

    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    // Speaking state is visible while TTS owns the reply.
    await waitFor(() => expect(screen.getByText('Speaking...')).toBeTruthy());

    const opts = mockSpeak.mock.calls[0][1] as any;
    expect(typeof opts.onDone).toBe('function');
    expect(typeof opts.onStopped).toBe('function');
    expect(typeof opts.onError).toBe('function');

    await act(async () => {
      opts.onDone();
    });
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  });

  it('falls back to idle (normal orb) after the reply finishes', async () => {
    const jarvis = 'Hey boss! I am Jarvis.';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: jarvis }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'hello jarvis');

    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    const opts = mockSpeak.mock.calls[0][1] as any;
    await act(async () => {
      opts.onDone();
    });
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
    // The Strands design settles back to the normal orb once work completes.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });
    await waitFor(() => expect(screen.getByText('AI')).toBeTruthy());
  });

  it('stop is called before a new speak and when re-listening (mutual exclusion)', async () => {
    const first = 'Hey boss! First reply.';
    const second = 'Anytime, boss! Second reply.';
    mockAiText
      .mockResolvedValueOnce({
        data: {
          actions: [{ action: 'CHAT', parameters: {} }],
          results: [{ status: 'CHAT_OK', songs: [], displayText: first }],
          response: first,
        },
      })
      .mockResolvedValueOnce({
        data: {
          actions: [{ action: 'CHAT', parameters: {} }],
          results: [{ status: 'CHAT_OK', songs: [], displayText: second }],
          response: second,
        },
      });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'hello');
    await waitFor(() => expect(mockSpeak).toHaveBeenCalledWith(
      first,
      expect.objectContaining({ onDone: expect.any(Function) }),
    ));
    const stopsBeforeSecondSpeak = mockStop.mock.calls.length;

    // Second Jarvis reply stops the previous utterance first (stop-before-speak).
    await sendTextCommand(screen, 'thank you');
    await waitFor(() => expect(mockSpeak).toHaveBeenCalledWith(
      second,
      expect.objectContaining({ onDone: expect.any(Function) }),
    ));
    expect(mockStop.mock.calls.length).toBeGreaterThan(stopsBeforeSecondSpeak);

    // Tapping the orb to speak again stops TTS (mutual exclusion with listening).
    const stopsBeforeListen = mockStop.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-orb-button'));
    });
    await waitFor(() => {
      expect(mockStop.mock.calls.length).toBeGreaterThan(stopsBeforeListen);
    });
  });

  it('stop is called on unmount and on sheet close', async () => {
    const jarvis = 'Hey boss! I am Jarvis.';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: jarvis }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'hello');
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());

    const stopsBeforeUnmount = mockStop.mock.calls.length;
    await act(async () => {
      screen.unmount();
    });
    expect(mockStop.mock.calls.length).toBeGreaterThan(stopsBeforeUnmount);
  });

  it('close button stops TTS', async () => {
    const jarvis = 'Hey boss! I am Jarvis.';
    mockAiText.mockResolvedValueOnce({
      data: {
        actions: [{ action: 'CHAT', parameters: {} }],
        results: [{ status: 'CHAT_OK', songs: [], displayText: jarvis }],
        response: jarvis,
      },
    });

    const screen = render(<AiOrb />);
    await sendTextCommand(screen, 'hello');
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());

    const stopsBeforeClose = mockStop.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByText('Close'));
    });
    expect(mockStop.mock.calls.length).toBeGreaterThan(stopsBeforeClose);
  });
});
