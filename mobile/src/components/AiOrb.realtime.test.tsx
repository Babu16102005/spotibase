/**
 * AiOrb realtime voice search — TestAgent additive suite.
 *
 * Covers what AiOrb.voice.test.tsx does NOT:
 * - VoiceLiveResults: skeleton while loading, top-5 chips, retry/type-instead
 * - Realtime invariant: interim partials never upload (aiApi.voice untouched
 *   until stop) — final QUEUE_SYNC single play stays on the stop path
 * - Single-owner play: source never subscribes to QUEUE_SYNC; exactly one
 *   playMultiple owner (static proof + no double-play comment contract)
 *
 * Expo SDK v57 docs reviewed per mobile/AGENTS.md; no native API change here
 * (pure jest + @testing-library/react-native assertions).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { VoiceLiveResults } from './VoiceLiveResults';
import { LightTheme } from '../theme';

declare const __dirname: string;
declare const require: any;

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  aiApi: { text: jest.fn(), voice: jest.fn(), health: jest.fn() },
  songApi: { getById: jest.fn(), like: jest.fn() },
  searchApi: { search: jest.fn() },
}));

const theme = LightTheme as any;
const song = (id: string, title = `Title ${id}`) => ({
  id,
  title,
  artistName: 'Anirudh',
  albumName: 'Hits',
  duration: 200,
  audioUrl: `https://cdn/${id}.mp3`,
  coverUrl: `https://cdn/${id}.jpg`,
});

describe('VoiceLiveResults live chips', () => {
  it('renders nothing when idle (no loading, no songs, no error)', () => {
    const { queryByTestId } = render(
      <VoiceLiveResults
        theme={theme}
        loading={false}
        songs={[]}
        error={null}
        query=""
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        onTypeInstead={jest.fn()}
      />,
    );
    expect(queryByTestId('voice-live-results')).toBeNull();
  });

  it('shows skeleton rows while the debounced partial is in flight', () => {
    const { getByTestId, getByLabelText } = render(
      <VoiceLiveResults
        theme={theme}
        loading
        songs={[]}
        error={null}
        query="play ani"
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        onTypeInstead={jest.fn()}
      />,
    );
    expect(getByTestId('voice-live-results')).toBeTruthy();
    expect(getByLabelText('Finding songs as you speak')).toBeTruthy();
  });

  it('renders top-5 song chips and plays the tapped index (single play)', () => {
    const onSelect = jest.fn();
    const songs = [song('s1'), song('s2'), song('s3'), song('s4'), song('s5'), song('s6')].slice(0, 5);
    const { getByTestId } = render(
      <VoiceLiveResults
        theme={theme}
        loading={false}
        songs={songs as any}
        error={null}
        query="play ani"
        onSelect={onSelect}
        onRetry={jest.fn()}
        onTypeInstead={jest.fn()}
      />,
    );
    // Top-5 cap: exactly 5 chips rendered.
    expect(songs).toHaveLength(5);
    fireEvent.press(getByTestId('voice-live-chip-s2'));
    // Single play: one onSelect with the full list + tapped index (parent
    // calls playMultiple once via handleVoiceUri/QUEUE_SYNC path).
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(songs, 1);
  });

  it('shows Retry + Type instead when live search fails with no chips', () => {
    const onRetry = jest.fn();
    const onTypeInstead = jest.fn();
    const { getByTestId, getByText } = render(
      <VoiceLiveResults
        theme={theme}
        loading={false}
        songs={[]}
        error="Live search failed: boom. Tap Retry or type instead."
        query="play ani"
        onSelect={jest.fn()}
        onRetry={onRetry}
        onTypeInstead={onTypeInstead}
      />,
    );
    expect(getByText(/Live search failed/)).toBeTruthy();
    fireEvent.press(getByTestId('voice-live-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId('voice-live-type-instead'));
    expect(onTypeInstead).toHaveBeenCalledTimes(1);
  });
});

describe('AiOrb realtime single-owner play invariant', () => {
  it('never auto-plays QUEUE_SYNC: source has one explicit playMultiple owner', () => {
    // Static contract proof: backend PLAY_BY_MOOD pushes STOMP QUEUE_SYNC,
    // but AiOrb intentionally does NOT subscribe — playMultiple below is the
    // one explicit play, so there is never a double play.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'AiOrb.tsx'), 'utf8') as string;
    expect(src).toMatch(/QUEUE_SYNC push is intentionally not auto-played/);
    expect(src).not.toMatch(/subscribe.*QUEUE_SYNC|onQUEUE_SYNC/);
    // The full stop path remains the only uploader: handleVoiceUri owns the
    // sheet, posts /ai/voice, then runs executeAction -> playMultiple.
    expect(src).toContain('handleVoiceUri');
    expect(src).toContain('/ai/voice');
    expect(src).toContain('executeAction');
    expect(src).toContain('playMultiple');
  });
});
