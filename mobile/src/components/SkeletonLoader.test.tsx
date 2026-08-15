import React from 'react';
import { Animated } from 'react-native';
import { act, create } from 'react-test-renderer';
import { render } from '@testing-library/react-native';
import Skeleton, {
  SongSkeleton,
  CardSkeleton,
  HeaderSkeleton,
  DetailPageSkeleton,
  GridSkeleton,
  PageSkeleton,
} from './SkeletonLoader';

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

  it('DetailPageSkeleton renders header and list skeletons', () => {
    const { toJSON } = render(<DetailPageSkeleton rows={3} />);
    expect(toJSON()).not.toBeNull();
  });

  it('GridSkeleton renders grid items', () => {
    const { toJSON } = render(<GridSkeleton count={4} />);
    expect(toJSON()).not.toBeNull();
  });

  it('PageSkeleton renders page section skeletons', () => {
    const { toJSON } = render(<PageSkeleton />);
    expect(toJSON()).not.toBeNull();
  });
});
