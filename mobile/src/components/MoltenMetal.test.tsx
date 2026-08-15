import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import MoltenMetal from './MoltenMetal';

describe('MoltenMetal Component', () => {
  it('renders children correctly', () => {
    const { getByText } = render(
      <MoltenMetal>
        <Text>Molten Metal Fluid Content</Text>
      </MoltenMetal>
    );
    expect(getByText('Molten Metal Fluid Content')).toBeTruthy();
  });

  it('accepts Molten Metal props without crashing', () => {
    const { toJSON } = render(
      <MoltenMetal
        color1="#5227FF"
        color2="#FF9FFC"
        color3="#FFFFFF"
        speed={0.35}
        scale={4}
        detail={3}
        glow={1.6}
        coreSize={0.1}
        swirl={1}
        fold={-0.2}
        blackPoint={0.05}
        brightness={1.3}
        colorMode="molten"
        grain={true}
        grainIntensity={0.05}
        mouseInteraction={true}
        mouseStrength={0.3}
        opacity={1.0}
      />
    );
    expect(toJSON()).toBeTruthy();
  });
});
