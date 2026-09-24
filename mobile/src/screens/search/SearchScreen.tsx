import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { searchApi } from '../../api/client';
import { useThemeStore, usePlayerStore } from '../../store';
import SongCard from '../../components/SongCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import PlaylistCard from '../../components/PlaylistCard';

const SearchScreen = ({ navigation, route }: any) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [trending, setTrending] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('songs');
  const { theme } = useThemeStore();
  const playMultiple = usePlayerStore((s) => s.playMultiple);
  const debounceRef = useRef<any>(null);
  // Cancels the previous in-flight search so slow responses can't overwrite fresh ones.
  const searchAbortRef = useRef<AbortController | null>(null);

  const genreFromParam = route?.params?.genre;

  useEffect(() => {
    searchApi.trending().then((r: any) => {
      const data = r.data;
      if (Array.isArray(data)) setTrending(data);
      else if (data && typeof data === 'object') setTrending(data.trending || []);
    }).catch(() => {});
  }, []);

  // When arriving with a genre param (e.g. Home genre card), prefill & search it
  useEffect(() => {
    if (genreFromParam) {
      setQuery(genreFromParam as string);
      handleSearch(genreFromParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreFromParam]);

  // Abort any in-flight search + pending debounce on unmount.
  useEffect(() => () => {
    searchAbortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      // Cancel the previous request before starting a new one.
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await searchApi.search(q, undefined, 0, controller.signal);
        // Stale response (a newer search started while this was in flight): drop it.
        if (searchAbortRef.current !== controller) return;
        setResults(res.data);
      } catch (err: any) {
        // Aborted requests are expected — not errors.
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        console.error('Search error:', err);
      }
    }, 300);
  }, []);

  // Memoized per-type renderers so they are not recreated on every keystroke/theme change
  const renderTrending = useCallback((items: string[]) => (
    <View>
      <TouchableOpacity
        style={[styles.youtubeCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        onPress={() => navigation?.navigate('YouTubeSongs')}
        accessibilityRole="button"
        accessibilityLabel="Discover trending YouTube songs"
      >
        <Text style={[styles.youtubeTitle, { color: theme.colors.text }]}>▶ Trending YouTube Songs</Text>
        <Text style={[styles.youtubeSub, { color: theme.colors.textSecondary }]}>
          Watch viral hits & music videos
        </Text>
        <Text style={[styles.youtubeCta, { color: theme.colors.primary }]}>Open YouTube →</Text>
      </TouchableOpacity>
      {items.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Trending Searches</Text>
          {items.map((item, i) => (
            <TouchableOpacity key={i} style={styles.trendingItem} onPress={() => handleSearch(item)}>
              <Text style={[styles.trendingText, { color: theme.colors.text }]}>🔥 {item}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  ), [theme, handleSearch, navigation]);

  const renderSongs = useCallback((songs: any[]) => (
    <>
      {songs?.map((s: any, idx: number) => (
        <SongCard
          key={s.id}
          song={s}
          index={idx}
          onPress={() => playMultiple(songs, idx)}
        />
      ))}
    </>
  ), [playMultiple]);

  const renderAlbums = useCallback((albums: any[]) => (
    <View style={styles.grid}>
      {albums?.map((a: any) => (
        <AlbumCard key={a.id} album={a} onPress={() => navigation?.navigate('Album', { id: a.id })} />
      ))}
    </View>
  ), [navigation]);

  const renderArtists = useCallback((artists: any[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {artists?.map((a: any) => (
        <ArtistCard key={a.id} artist={a} onPress={() => navigation?.navigate('Artist', { id: a.id })} />
      ))}
    </ScrollView>
  ), [navigation]);

  const renderPlaylists = useCallback((playlists: any[]) => (
    <View style={styles.grid}>
      {playlists?.map((p: any) => (
        <PlaylistCard key={p.id} playlist={p} onPress={() => navigation?.navigate('Playlist', { id: p.id })} />
      ))}
    </View>
  ), [navigation]);

  const renderContent = () => {
    if (!results) {
      return renderTrending(trending);
    }

    const tabs = ['songs', 'albums', 'artists', 'playlists'];

    return (
      <View style={styles.results}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, { backgroundColor: activeTab === tab ? theme.colors.primary : theme.colors.surface }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? '#000' : theme.colors.text }]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {activeTab === 'songs' && renderSongs(results.songs)}
        {activeTab === 'albums' && renderAlbums(results.albums)}
        {activeTab === 'artists' && renderArtists(results.artists)}
        {activeTab === 'playlists' && renderPlaylists(results.playlists)}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.searchIcon, { color: theme.colors.textSecondary }]}>🔍</Text>
        <TextInput
          style={[styles.input, { color: theme.colors.text }]}
          placeholder="What do you want to listen to?"
          placeholderTextColor={theme.colors.textTertiary}
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
        />
        {query ? (
          <TouchableOpacity onPress={() => { searchAbortRef.current?.abort(); setQuery(''); setResults(null); }}>
            <Text style={{ color: theme.colors.textSecondary }}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {renderContent()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', margin: 16, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  input: { flex: 1, fontSize: 15, height: 44 },
  sectionTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 12 },
  trendingItem: { paddingHorizontal: 16, paddingVertical: 10 },
  trendingText: { fontSize: 15 },
  results: { flex: 1 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8 },
  tabText: { fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  youtubeCard: { marginHorizontal: 16, marginTop: 8, marginBottom: 4, borderRadius: 12, borderWidth: 1, padding: 14 },
  youtubeTitle: { fontSize: 15, fontWeight: '800' },
  youtubeSub: { fontSize: 12, marginTop: 4 },
  youtubeCta: { fontSize: 13, fontWeight: '800', marginTop: 8 },
});

export default SearchScreen;
