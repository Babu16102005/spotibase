import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useThemeStore } from '../store';
import Icon, { IconName } from './Icon';

export type TabKey = 'Home' | 'Songs' | 'Library' | 'Profile';

interface SidebarProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}

const NAV_ITEMS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'Home', label: 'Home', icon: 'home' },
  { key: 'Songs', label: 'Songs', icon: 'songs' },
  { key: 'Library', label: 'Library', icon: 'library' },
  { key: 'Profile', label: 'Profile', icon: 'profile' },
];

const LIBRARY_ITEMS: { label: string; icon: IconName; action: () => void }[] = [];

interface SidebarNavItemProps {
  item: typeof NAV_ITEMS[0];
  active: boolean;
  onPress: () => void;
  theme: any;
}

const SidebarNavItem: React.FC<SidebarNavItemProps> = ({ item, active, onPress, theme }) => {
  const [hovered, setHovered] = React.useState(false);

  const onHover = Platform.OS === 'web' ? {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } : {};

  return (
    <TouchableOpacity
      style={[
        styles.navItem,
        active && { backgroundColor: theme.colors.cardHover },
        !active && hovered && { backgroundColor: theme.colors.glass, transform: [{ translateX: 4 }] },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      {...onHover}
    >
      <Icon
        name={item.icon}
        size={20}
        color={active ? theme.colors.primary : (hovered ? theme.colors.text : theme.colors.textSecondary)}
      />
      <Text
        style={[
          styles.navLabel,
          { color: active ? theme.colors.text : (hovered ? theme.colors.text : theme.colors.textSecondary) },
        ]}
      >
        {item.label}
      </Text>
    </TouchableOpacity>
  );
};

/**
 * Spotify-style desktop sidebar with macOS accent: brand mark, primary navigation,
 * and quick links. Renders window dots and uses glassmorphism backdrop blur on web.
 */
const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab }) => {
  const { theme } = useThemeStore();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.sidebar, borderRightColor: theme.colors.border }]}>
      {/* macOS dots at top-left of the sidebar */}
      {Platform.OS === 'web' && (
        <View style={styles.macOSDots}>
          <View style={[styles.macOSDot, { backgroundColor: '#FF5F56' }]} />
          <View style={[styles.macOSDot, { backgroundColor: '#FFBD2E' }]} />
          <View style={[styles.macOSDot, { backgroundColor: '#27C93F' }]} />
        </View>
      )}

      {/* Brand */}
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Icon name="music" size={18} color="#FFFFFF" />
        </View>
        <Text style={[styles.brandName, { color: theme.colors.text }]}>
          SpotiBase
        </Text>
      </View>

      {/* Primary nav */}
      <View style={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem
            key={item.key}
            item={item}
            active={activeTab === item.key}
            onPress={() => onSelectTab(item.key)}
            theme={theme}
          />
        ))}
      </View>

      {/* Library quick links */}
      <View style={[styles.librarySection, { borderTopColor: theme.colors.border }]}>
        <View style={styles.libraryHeader}>
          <Icon name="library" size={14} color={theme.colors.textTertiary} />
          <Text style={[styles.libraryTitle, { color: theme.colors.textTertiary }]}>
            Your Library
          </Text>
        </View>
        {LIBRARY_ITEMS.map((item) => (
          <TouchableOpacity key={item.label} style={styles.libraryItem} onPress={item.action}>
            <Icon name={item.icon} size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.libraryLabel, { color: theme.colors.textSecondary }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={[styles.libraryHint, { color: theme.colors.textTertiary }]}>
          Liked Songs
        </Text>
        <Text style={[styles.libraryHint, { color: theme.colors.textTertiary }]}>
          Your Playlists
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.colors.textTertiary }]}>
          {'SpotiBase \u00B7 v1.0'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 232,
    paddingTop: Platform.OS === 'web' ? 20 : 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
    overflow: 'hidden',
    borderRightWidth: 1,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(30px)',
      WebkitBackdropFilter: 'blur(30px)',
    } : {}),
  },
  macOSDots: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 6,
    marginBottom: 20,
  },
  macOSDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.85,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginBottom: 22,
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  nav: {
    marginBottom: 24,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
    ...(Platform.OS === 'web' ? {
      transition: 'background-color 0.2s ease, transform 0.2s ease',
    } : {}),
  },
  navLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
  },
  librarySection: {
    flex: 1,
    borderTopWidth: 1,
    paddingTop: 18,
  },
  libraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  libraryTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
  },
  libraryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  libraryLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 10,
  },
  libraryHint: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    opacity: 0.7,
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  footerText: {
    fontSize: 11,
    opacity: 0.6,
  },
});

export default Sidebar;
