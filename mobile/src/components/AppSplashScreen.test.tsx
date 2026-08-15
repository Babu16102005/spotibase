import React from 'react';
import { render, act } from '@testing-library/react-native';
import AppSplashScreen from './AppSplashScreen';

describe('AppSplashScreen', () => {
  it('renders wording splash image correctly', () => {
    const { getByLabelText } = render(<AppSplashScreen isReady={false} />);
    expect(getByLabelText('SpotiBase')).toBeTruthy();
  });

  it('triggers onAnimationComplete after timer expires', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    render(<AppSplashScreen isReady={true} onAnimationComplete={onComplete} />);
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(onComplete).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
