import React from 'react';
import { render } from '@testing-library/react-native';
import TimelineLoadingBeam from './TimelineLoadingBeam';

describe('TimelineLoadingBeam', () => {
  it('renders correctly with default props', () => {
    const { getByTestId, getByLabelText } = render(<TimelineLoadingBeam />);
    expect(getByTestId('timeline-loading-beam')).toBeTruthy();
    expect(getByLabelText('Loading track')).toBeTruthy();
  });

  it('renders with custom height and colors', () => {
    const { getByTestId } = render(
      <TimelineLoadingBeam height={4} backgroundColor="#333333" beamColor="#FFFFFF" />
    );
    expect(getByTestId('timeline-loading-beam')).toBeTruthy();
  });
});
