import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SongRow from './SongRow';
import { makeSong } from '../test/fixtures';

describe('SongRow', () => {
  const song = makeSong({ title: 'Blinding Lights', artistName: 'The Weeknd', durationMs: 214_000 });

  it('renders index, title, artist and formatted duration', () => {
    const { getByText } = render(
      <SongRow song={song} index={2} isCurrent={false} isPlaying={false} onPress={jest.fn()} onToggleLike={jest.fn()} />
    );

    expect(getByText('2')).toBeTruthy();
    expect(getByText('Blinding Lights')).toBeTruthy();
    expect(getByText('The Weeknd \u2022 Test Album')).toBeTruthy();
    expect(getByText('3:34')).toBeTruthy();
  });

  it('fires onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <SongRow song={song} index={1} isCurrent={false} isPlaying={false} onPress={onPress} onToggleLike={jest.fn()} />
    );

    fireEvent.press(getByText('Blinding Lights'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('fires onToggleLike with the song', () => {
    const onToggleLike = jest.fn();
    const { getByLabelText } = render(
      <SongRow song={song} index={1} isCurrent={false} isPlaying={false} onPress={jest.fn()} onToggleLike={onToggleLike} />
    );

    fireEvent.press(getByLabelText('Like song'));

    expect(onToggleLike).toHaveBeenCalledWith(song);
  });

  it('shows a liked state when the song is liked', () => {
    const { getByLabelText } = render(
      <SongRow
        song={makeSong({ liked: true })}
        index={1}
        isCurrent={false}
        isPlaying={false}
        onPress={jest.fn()}
        onToggleLike={jest.fn()}
      />
    );

    expect(getByLabelText('Unlike song')).toBeTruthy();
  });

  it('replaces the index with an equalizer for the current track', () => {
    const { queryByText } = render(
      <SongRow song={song} index={1} isCurrent isPlaying onPress={jest.fn()} onToggleLike={jest.fn()} />
    );

    expect(queryByText('1')).toBeNull();
  });
});
