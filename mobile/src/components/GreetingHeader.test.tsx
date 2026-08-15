import React from 'react';
import { render } from '@testing-library/react-native';
import { GreetingHeader, MULTICOLOR_PALETTES, PATTERN_PALETTES } from './GreetingHeader';

describe('GreetingHeader', () => {
  it('renders greeting text correctly', () => {
    const { getByText } = render(
      <GreetingHeader greetingText="Good Morning" />
    );
    expect(getByText('Good Morning')).toBeTruthy();
  });

  it('resolves multicolor palettes for morning, afternoon, evening, fluid, and aurora', () => {
    expect(MULTICOLOR_PALETTES.morning).toEqual(['#063B00', '#266210', '#90B800', '#E1E100']);
    expect(MULTICOLOR_PALETTES.afternoon).toEqual(['#2C5EAD', '#1591DC', '#4BB8FA', '#C4E2F5']);
    expect(MULTICOLOR_PALETTES.evening).toEqual(['#332FD0', '#9254C8', '#E15FED', '#6EDCD9']);
    expect(MULTICOLOR_PALETTES.default).toEqual(['#063B00', '#266210', '#90B800', '#E1E100']);
    expect(MULTICOLOR_PALETTES.fluid).toEqual(['#5227FF', '#FF9FFC', '#FFFFFF', '#07080D']);
    expect(MULTICOLOR_PALETTES.aurora).toEqual(['#f7f7f7', '#e100ff', '#3A29FF', '#07080D']);
    expect(PATTERN_PALETTES.aurora).toEqual(['#f7f7f7', '#e100ff', '#3A29FF', '#07080D']);
  });
});
