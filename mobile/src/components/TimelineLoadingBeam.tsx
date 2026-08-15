import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, LayoutChangeEvent } from 'react-native';

export interface TimelineLoadingBeamProps {
  height?: number;
  backgroundColor?: string;
  beamColor?: string;
  testID?: string;
  style?: any;
}

export const TimelineLoadingBeam: React.FC<TimelineLoadingBeamProps> = ({
  height = 3,
  backgroundColor = 'rgba(255, 255, 255, 0.25)',
  beamColor = '#FFFFFF',
  testID = 'timeline-loading-beam',
  style,
}) => {
  const anim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(300);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    const animation = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [anim]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setContainerWidth(w);
  };

  const beamWidth = Math.max(containerWidth * 0.35, 60);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-beamWidth, containerWidth + beamWidth],
  });

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={[
        styles.track,
        { height, backgroundColor },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading track"
    >
      <Animated.View
        style={[
          styles.beam,
          {
            width: beamWidth,
            height: '100%',
            backgroundColor: beamColor,
            transform: [{ translateX }],
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    borderRadius: 2,
  },
  beam: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 2,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
});

export default TimelineLoadingBeam;
