import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SectionHeader from './SectionHeader';

jest.mock('../api/client', () => ({
  queueApi: { addToQueue: jest.fn() },
}));

describe('SectionHeader', () => {
  it('renders the title and subtitle', () => {
    const { getByText } = render(<SectionHeader title="Top Hits" subtitle="Updated daily" />);

    expect(getByText('Top Hits')).toBeTruthy();
    expect(getByText('Updated daily')).toBeTruthy();
  });

  it('renders the action label and fires onAction when pressed', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <SectionHeader title="Top Hits" actionLabel="See All" onAction={onAction} />
    );

    fireEvent.press(getByText('See All'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action button when no label is given', () => {
    const { queryByText } = render(<SectionHeader title="Top Hits" />);

    expect(queryByText('See All')).toBeNull();
  });

  it('omits the subtitle when not provided', () => {
    const { queryByText } = render(<SectionHeader title="Top Hits" />);
    expect(queryByText(/Updated daily/)).toBeNull();
  });
});
