/**
 * Central invalidation helpers + mutation wrappers.
 *
 * Screens previously called songApi.like/unlike, playlistApi.create and
 * songApi.uploadBulk/delete directly, leaving ['songs'], ['library'] and
 * ['home'] entries stale. Route new code through the use* hooks below (which
 * invalidate onSettled); existing direct callers can call the invalidate*
 * helpers explicitly until migrated.
 */
import { useMutation } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { playlistApi, songApi } from '../api/client';
import type { BulkUploadEntry, CreatePlaylistRequest, PickedSongFile } from '../types';

/** Catalogue infinite lists (all page sizes) + legacy page entries. */
export const invalidateSongs = () =>
  queryClient.invalidateQueries({ queryKey: ['songs'] });

/** Combined library + granular library-parts entries. */
export const invalidateLibrary = () =>
  queryClient.invalidateQueries({ queryKey: ['library'] });

export const invalidateHome = () =>
  queryClient.invalidateQueries({ queryKey: ['home'] });

export const invalidateSearch = () =>
  queryClient.invalidateQueries({ queryKey: ['search'] });

export const invalidateAll = () => queryClient.invalidateQueries();

/** Full cache teardown for account switch / logout. */
export const clearAllQueries = () => queryClient.clear();

const invalidateAfterSongMutation = () => {
  void invalidateSongs();
  void invalidateLibrary();
  void invalidateHome();
};

export const useLikeSong = () =>
  useMutation({
    mutationFn: (id: string) => songApi.like(id),
    onSettled: invalidateAfterSongMutation,
  });

export const useUnlikeSong = () =>
  useMutation({
    mutationFn: (id: string) => songApi.unlike(id),
    onSettled: invalidateAfterSongMutation,
  });

export const useCreatePlaylist = () =>
  useMutation({
    mutationFn: (data: CreatePlaylistRequest) => playlistApi.create(data),
    onSettled: () => {
      void invalidateLibrary();
    },
  });

export const useDeleteSong = () =>
  useMutation({
    mutationFn: (id: string) => songApi.delete(id),
    onSettled: invalidateAfterSongMutation,
  });

export const useUploadSongs = () =>
  useMutation({
    mutationFn: ({ files, requests }: { files: PickedSongFile[]; requests?: BulkUploadEntry[] }) =>
      songApi.uploadBulk(files, requests ?? []),
    onSettled: invalidateAfterSongMutation,
  });
