import React from 'react';
import { Animated } from 'react-native';
import { act, create } from 'react-test-renderer';
import { render } from '@testing-library/react-native';
import Skeleton, { SongSkeleton, CardSkeleton } from './SkeletonLoader';

jest.mock('../api/client', () => ({
  queueApi: { addToQueue: jest.fn() },
}));

describe('SkeletonLoader', () => {
  it('Skeleton renders an animated block with the given size', () => {
    const { toJSON } = render(<Skeleton width={100} height={24} borderRadius={8} />);
    expect(toJSON()).not.toBeNull();
  });

  it('SongSkeleton renders four shimmering blocks', () => {
    let tree: any;
    act(() => {
      tree = create(<SongSkeleton />);
    });
    // cover + title + subtitle + duration
    expect(tree.root.findAllByType(Animated.View)).toHaveLength(4);
    act(() => tree.unmount());
  });

  it('CardSkeleton renders count * 3 blocks (image + two lines)', () => {
    let tree: any;
    act(() => {
      tree = create(<CardSkeleton count={3} />);
    });
    expect(tree.root.findAllByType(Animated.View)).toHaveLength(9);
    act(() => tree.unmount());
  });

  it('CardSkeleton defaults to 5 cards', () => {
    let tree: any;
    act(() => {
      tree = create(<CardSkeleton />);
    });
    expect(tree.root.findAllByType(Animated.View)).toHaveLength(15);
    act(() => tree.unmount());
  });
});
