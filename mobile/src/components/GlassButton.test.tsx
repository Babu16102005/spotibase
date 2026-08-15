import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GlassButton, LiquidButton, MetalButton, Button } from './GlassButton';

describe('GlassButton Component', () => {
  it('renders correctly with title', () => {
    const { getByText } = render(<GlassButton title="Glass Action" />);
    expect(getByText('Glass Action')).toBeTruthy();
  });

  it('handles onPress event', () => {
    const onPressMock = jest.fn();
    const { getByText } = render(<GlassButton title="Click Me" onPress={onPressMock} />);
    fireEvent.press(getByText('Click Me'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('renders all variants without crashing', () => {
    const variants = [
      'default',
      'primary',
      'metal',
      'glass',
      'destructive',
      'secondary',
      'outline',
      'ghost',
      'success',
      'gold',
      'bronze',
    ] as const;

    variants.forEach((variant) => {
      const { getByText } = render(<GlassButton variant={variant} title={variant} />);
      expect(getByText(variant)).toBeTruthy();
    });
  });

  it('renders all sizes without crashing', () => {
    const sizes = ['sm', 'md', 'lg', 'xl', 'icon'] as const;

    sizes.forEach((size) => {
      const { getByTestId } = render(
        <GlassButton size={size} title={size} testID={`btn-${size}`} />
      );
      expect(getByTestId(`btn-${size}`)).toBeTruthy();
    });
  });

  it('supports aliases LiquidButton, MetalButton, and Button', () => {
    const { getByText: getLiquid } = render(<LiquidButton title="Liquid" />);
    const { getByText: getMetal } = render(<MetalButton title="Metal" />);
    const { getByText: getStandard } = render(<Button title="Standard" />);

    expect(getLiquid('Liquid')).toBeTruthy();
    expect(getMetal('Metal')).toBeTruthy();
    expect(getStandard('Standard')).toBeTruthy();
  });

  it('renders loading indicator when loading is true', () => {
    const { getByTestId } = render(
      <GlassButton title="Loading Action" loading testID="loading-btn" />
    );
    expect(getByTestId('loading-btn')).toBeTruthy();
  });
});
