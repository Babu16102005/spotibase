import { create } from 'zustand';

interface SelectionState {
  selectedSongIds: Set<string>;
  isSelectionMode: boolean;
  totalVisibleCount: number;

  // Actions
  toggleSelect: (songId: string) => void;
  select: (songId: string) => void;
  deselect: (songId: string) => void;
  selectAll: (songIds: string[]) => void;
  deselectAll: () => void;
  clear: () => void;
  setTotalVisibleCount: (count: number) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedSongIds: new Set<string>(),
  isSelectionMode: false,
  totalVisibleCount: 0,

  toggleSelect: (songId: string) =>
    set((state) => {
      const next = new Set(state.selectedSongIds);
      if (next.has(songId)) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      return {
        selectedSongIds: next,
        isSelectionMode: next.size > 0,
      };
    }),

  select: (songId: string) =>
    set((state) => {
      const next = new Set(state.selectedSongIds);
      next.add(songId);
      return {
        selectedSongIds: next,
        isSelectionMode: true,
      };
    }),

  deselect: (songId: string) =>
    set((state) => {
      const next = new Set(state.selectedSongIds);
      next.delete(songId);
      return {
        selectedSongIds: next,
        isSelectionMode: next.size > 0,
      };
    }),

  selectAll: (songIds: string[]) =>
    set(() => ({
      selectedSongIds: new Set(songIds),
      isSelectionMode: songIds.length > 0,
      totalVisibleCount: songIds.length,
    })),

  deselectAll: () =>
    set(() => ({
      selectedSongIds: new Set(),
      isSelectionMode: false,
    })),

  clear: () =>
    set(() => ({
      selectedSongIds: new Set(),
      isSelectionMode: false,
    })),

  setTotalVisibleCount: (count: number) =>
    set(() => ({
      totalVisibleCount: count,
    })),
}));
