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

  // --- Link (text-action) variant vs no-action ---------------------------------
  // The component exposes a single pressable "link" variant: a TouchableOpacity
  // wrapping the action label. There is no separate pill/button variant prop —
  // callers (e.g. HomeScreen YouTube) reuse this same link affordance.

  it('link variant: renders a pressable action when label + onAction are provided', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <SectionHeader title="Recently Played" actionLabel="YouTube" onAction={onAction} />
    );

    const action = getByText('YouTube');
    expect(action).toBeTruthy();
    fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('link variant: accumulates one onAction call per press', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <SectionHeader title="Recently Played" actionLabel="YouTube" onAction={onAction} />
    );

    fireEvent.press(getByText('YouTube'));
    fireEvent.press(getByText('YouTube'));

    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('renders the default "Show all" label when only onAction is given', () => {
    const onAction = jest.fn();
    const { getByText } = render(<SectionHeader title="Top Hits" onAction={onAction} />);

    fireEvent.press(getByText('Show all'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action when onAction is missing even if a label is given (validation path)', () => {
    const { queryByText } = render(
      <SectionHeader title="Top Hits" actionLabel="YouTube" />
    );

    expect(queryByText('YouTube')).toBeNull();
  });

  it('omits the action when the label is an empty string even if onAction is given', () => {
    const onAction = jest.fn();
    const { queryByText, getByText } = render(
      <SectionHeader title="Top Hits" actionLabel="" onAction={onAction} />
    );

    // Title still renders; no pressable action text exists to fire.
    expect(getByText('Top Hits')).toBeTruthy();
    expect(queryByText('Show all')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('omits both action and subtitle when neither is provided (header-only)', () => {
    const { getByText, queryByText } = render(<SectionHeader title="Featured Albums" />);

    expect(getByText('Featured Albums')).toBeTruthy();
    expect(queryByText('Show all')).toBeNull();
  });

  it('omits the subtitle when it is an empty string (edge case)', () => {
    const { getByText, queryByText } = render(
      <SectionHeader title="Top Hits" subtitle="" />
    );

    expect(getByText('Top Hits')).toBeTruthy();
    // No subtitle node should be rendered for "".
    expect(queryByText('Updated daily')).toBeNull();
  });

  it('renders long titles without clipping the action', () => {
    const onAction = jest.fn();
    const longTitle = 'A Very Long Section Title That Should Still Render Beside The Action';
    const { getByText } = render(
      <SectionHeader title={longTitle} actionLabel="YouTube" onAction={onAction} />
    );

    expect(getByText(longTitle)).toBeTruthy();
    fireEvent.press(getByText('YouTube'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  // --- Button (pill) variant ---------------------------------------------------
  // actionVariant="button" renders a GlassButton pill (secondary/sm) instead of
  // the text link. Used by HomeScreen beside Recently Played.

  it('button variant: renders a pressable pill with testID + a11y label and fires onAction', () => {
    const onAction = jest.fn();
    const { getByTestId, getByText } = render(
      <SectionHeader
        title="Recently Played"
        actionLabel="YouTube"
        onAction={onAction}
        actionVariant="button"
        actionTestID="recently-played-youtube-button"
      />
    );

    expect(getByText('YouTube')).toBeTruthy();
    const pill = getByTestId('recently-played-youtube-button');
    expect(pill).toBeTruthy();
    expect(pill.props.accessibilityLabel).toBe('Open YouTube songs');

    fireEvent.press(pill);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('button variant: forwards a custom icon and testID', () => {
    const onAction = jest.fn();
    const { getByTestId } = render(
      <SectionHeader
        title="Recently Played"
        actionLabel="YouTube"
        onAction={onAction}
        actionVariant="button"
        actionIcon="play"
        actionTestID="custom-yt-btn"
      />
    );

    fireEvent.press(getByTestId('custom-yt-btn'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('button variant: renders and fires without an explicit testID', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <SectionHeader
        title="Recently Played"
        actionLabel="YouTube"
        onAction={onAction}
        actionVariant="button"
      />
    );

    fireEvent.press(getByText('YouTube'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('button variant: omits the pill when onAction is missing (validation path)', () => {
    const { queryByTestId, queryByText } = render(
      <SectionHeader
        title="Recently Played"
        actionLabel="YouTube"
        actionVariant="button"
        actionTestID="recently-played-youtube-button"
      />
    );

    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
    expect(queryByText('YouTube')).toBeNull();
  });

  it('button variant: omits the pill when the label is empty', () => {
    const onAction = jest.fn();
    const { queryByTestId, getByText } = render(
      <SectionHeader
        title="Recently Played"
        actionLabel=""
        onAction={onAction}
        actionVariant="button"
        actionTestID="recently-played-youtube-button"
      />
    );

    expect(getByText('Recently Played')).toBeTruthy();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('explicit link variant renders text (no pill testID) and fires', () => {
    const onAction = jest.fn();
    const { getByText, queryByTestId } = render(
      <SectionHeader
        title="Trending Now"
        actionLabel="YouTube"
        onAction={onAction}
        actionVariant="link"
        actionTestID="trending-youtube-link"
      />
    );

    // Link variant ignores the pill testID — plain pressable text only.
    expect(queryByTestId('trending-youtube-link')).toBeNull();
    fireEvent.press(getByText('YouTube'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
