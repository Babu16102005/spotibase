import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GlobalBulkSelectionBar from './GlobalBulkSelectionBar';
import { useSelectionStore } from '../store';

describe('GlobalBulkSelectionBar', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('renders null when not in selection mode', () => {
    const { toJSON } = render(<GlobalBulkSelectionBar />);
    expect(toJSON()).toBeNull();
  });

  it('renders bulk action bar when songs are selected', () => {
    useSelectionStore.getState().select('song-1');
    useSelectionStore.getState().select('song-2');

    const { getByText, getByLabelText } = render(<GlobalBulkSelectionBar />);
    expect(getByText('2')).toBeTruthy();
    expect(getByText('selected')).toBeTruthy();

    fireEvent.press(getByLabelText('Exit selection'));
    expect(useSelectionStore.getState().isSelectionMode).toBe(false);
  });
});
