import { useSelectionStore } from './selectionStore';

describe('selectionStore', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('initializes with empty selection and selectionMode false', () => {
    const state = useSelectionStore.getState();
    expect(state.isSelectionMode).toBe(false);
    expect(state.selectedSongIds.size).toBe(0);
  });

  it('selects a song and activates selectionMode', () => {
    useSelectionStore.getState().select('song-1');
    const state = useSelectionStore.getState();
    expect(state.isSelectionMode).toBe(true);
    expect(state.selectedSongIds.has('song-1')).toBe(true);
    expect(state.selectedSongIds.size).toBe(1);
  });

  it('toggles selection on subsequent songs', () => {
    useSelectionStore.getState().select('song-1');
    useSelectionStore.getState().toggleSelect('song-2');

    let state = useSelectionStore.getState();
    expect(state.selectedSongIds.size).toBe(2);
    expect(state.selectedSongIds.has('song-1')).toBe(true);
    expect(state.selectedSongIds.has('song-2')).toBe(true);

    // Toggle off song-1
    useSelectionStore.getState().toggleSelect('song-1');
    state = useSelectionStore.getState();
    expect(state.selectedSongIds.size).toBe(1);
    expect(state.selectedSongIds.has('song-1')).toBe(false);
    expect(state.selectedSongIds.has('song-2')).toBe(true);
    expect(state.isSelectionMode).toBe(true);

    // Toggle off song-2 -> selection mode becomes false
    useSelectionStore.getState().toggleSelect('song-2');
    state = useSelectionStore.getState();
    expect(state.selectedSongIds.size).toBe(0);
    expect(state.isSelectionMode).toBe(false);
  });

  it('selectAll and clear work as expected', () => {
    useSelectionStore.getState().selectAll(['song-1', 'song-2', 'song-3']);
    let state = useSelectionStore.getState();
    expect(state.isSelectionMode).toBe(true);
    expect(state.selectedSongIds.size).toBe(3);

    useSelectionStore.getState().clear();
    state = useSelectionStore.getState();
    expect(state.isSelectionMode).toBe(false);
    expect(state.selectedSongIds.size).toBe(0);
  });
});
