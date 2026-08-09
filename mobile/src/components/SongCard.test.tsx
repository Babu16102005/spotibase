import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SongCard from './SongCard';
import { makeSong } from '../test/fixtures';

// The store (playerStore) calls the API when play() is invoked without an
// onPress — mock the client so no network can ever be reached.
jest.mock('../api/client', () => ({
  queueApi: { addToQueue: jest.fn() },
}));

describe('SongCard', () => {
  const song = makeSong({ title: 'Blinding Lights', artistName: 'The Weeknd', durationMs: 214_000 });

  it('renders the song title, artist and formatted duration', () => {
    const { getByText } = render(<SongCard song={song} />);

    expect(getByText('Blinding Lights')).toBeTruthy();
    expect(getByText('The Weeknd')).toBeTruthy();
    expect(getByText('3:34')).toBeTruthy();
  });

  it('fires onPress when the card is pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<SongCard song={song} onPress={onPress} />);

    fireEvent.press(getByText('Blinding Lights'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the artist row when showArtist is false', () => {
    const { queryByText, getByText } = render(<SongCard song={song} showArtist={false} />);

    expect(getByText('Blinding Lights')).toBeTruthy();
    expect(queryByText('The Weeknd')).toBeNull();
  });

  it('appends the album name when showAlbum is true', () => {
    const { getByText } = render(
      <SongCard song={makeSong({ artistName: 'The Weeknd', albumName: 'After Hours' })} showAlbum />
    );

    expect(getByText('The Weeknd \u2022 After Hours')).toBeTruthy();
  });

  it('renders the 1-based track index when provided', () => {
    const { getByText } = render(<SongCard song={song} index={2} />);
    expect(getByText('3')).toBeTruthy();
  });
});
