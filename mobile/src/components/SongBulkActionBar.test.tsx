import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SongBulkActionBar from './SongBulkActionBar';

describe('SongBulkActionBar', () => {
  it('renders selected count and triggers actions', () => {
    const onSelectAll = jest.fn();
    const onDeselectAll = jest.fn();
    const onClose = jest.fn();
    const onAddToPlaylist = jest.fn();
    const onDelete = jest.fn();

    const { getByText, getByLabelText } = render(
      <SongBulkActionBar
        selectedCount={3}
        totalCount={10}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onClose={onClose}
        onAddToPlaylist={onAddToPlaylist}
        onDelete={onDelete}
        deleteLabel="Delete"
      />
    );

    expect(getByText('3')).toBeTruthy();
    expect(getByText('selected')).toBeTruthy();

    fireEvent.press(getByText('All'));
    expect(onSelectAll).toHaveBeenCalled();

    fireEvent.press(getByText('Playlist'));
    expect(onAddToPlaylist).toHaveBeenCalled();

    fireEvent.press(getByText('Delete'));
    expect(onDelete).toHaveBeenCalled();

    fireEvent.press(getByLabelText('Exit selection'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders None when all items are selected', () => {
    const onDeselectAll = jest.fn();

    const { getByText } = render(
      <SongBulkActionBar
        selectedCount={5}
        totalCount={5}
        onSelectAll={jest.fn()}
        onDeselectAll={onDeselectAll}
        onClose={jest.fn()}
        onAddToPlaylist={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(getByText('None')).toBeTruthy();
    fireEvent.press(getByText('None'));
    expect(onDeselectAll).toHaveBeenCalled();
  });
});
