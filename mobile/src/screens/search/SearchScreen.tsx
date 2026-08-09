import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { searchApi } from '../../api/client';
import { useThemeStore } from '../../store';
import SongCard from '../../components/SongCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import PlaylistCard from '../../components/PlaylistCard';

const SearchScreen = ({ navigation }: any) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [trending, setTrending] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('songs');
  const { theme } = useThemeStore();
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    searchApi.trending().then((r: any) => {
      const data = r.data;
      if (Array.isArray(data)) setTrending(data);
      else if (data && typeof data === 'object') setTrending(data.trending || []);
    }).catch(() => {});
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchApi.search(q);
        setResults(res.data);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 300);
  }, []);

  const renderContent = () => {
    if (!results) {
      return (
        <View>
          {trending.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Trending Searches</Text>
              {trending.map((item, i) => (
                <TouchableOpacity key={i} style={styles.trendingItem} onPress={() => handleSearch(item)}>
                  <Text style={[styles.trendingText, { color: theme.colors.text }]}>🔥 {item}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      );
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

        {activeTab === 'songs' && results.songs?.map((s: any) => (
          <SongCard key={s.id} song={s} />
        ))}
        {activeTab === 'albums' && (
          <View style={styles.grid}>
            {results.albums?.map((a: any) => (
              <AlbumCard key={a.id} album={a} onPress={() => navigation?.navigate('Album', { id: a.id })} />
            ))}
          </View>
        )}
        {activeTab === 'artists' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {results.artists?.map((a: any) => (
              <ArtistCard key={a.id} artist={a} onPress={() => navigation?.navigate('Artist', { id: a.id })} />
            ))}
          </ScrollView>
        )}
        {activeTab === 'playlists' && (
          <View style={styles.grid}>
            {results.playlists?.map((p: any) => (
              <PlaylistCard key={p.id} playlist={p} onPress={() => navigation?.navigate('Playlist', { id: p.id })} />
            ))}
          </View>
        )}
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
          <TouchableOpacity onPress={() => { setQuery(''); setResults(null); }}>
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
});

export default SearchScreen;
