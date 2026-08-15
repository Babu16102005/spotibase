import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import SoftAurora, { Aurora } from './SoftAurora';

describe('SoftAurora', () => {
  it('renders correctly with default props', () => {
    const { getByText } = render(
      <SoftAurora>
        <Text>Soft Aurora Content</Text>
      </SoftAurora>
    );
    expect(getByText('Soft Aurora Content')).toBeTruthy();
  });

  it('accepts official ReactBits SoftAurora props', () => {
    const { getByText } = render(
      <Aurora
        speed={0.6}
        scale={1.5}
        brightness={1.0}
        color1="#f7f7f7"
        color2="#e100ff"
        noiseFrequency={2.5}
        noiseAmplitude={1.0}
        bandHeight={0.5}
        bandSpread={1.0}
        octaveDecay={0.1}
        enableMouseInteraction={true}
        mouseInfluence={0.25}
      >
        <Text>Aurora Official Props</Text>
      </Aurora>
    );
    expect(getByText('Aurora Official Props')).toBeTruthy();
  });
});
