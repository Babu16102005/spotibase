import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { StackScreenProps } from '@react-navigation/stack';
import { useNotificationStore, useThemeStore } from '../../store';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { NotificationResponse } from '../../types';
import { getRelativeTime } from '../../utils';
import Skeleton from '../../components/SkeletonLoader';

type Props = StackScreenProps<RootStackParamList, 'Notifications'>;

const NotificationsScreen = (_props: Props) => {
  const { theme } = useThemeStore();
  const {
    notifications,
    unreadCount,
    page,
    last,
    isLoading,
    error,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
  } = useNotificationStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchNotifications(0);
    fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchNotifications(0), fetchUnreadCount()]);
    setRefreshing(false);
  }, [fetchNotifications, fetchUnreadCount]);

  const onEndReached = useCallback(() => {
    if (!last && !isLoading) {
      fetchNotifications(page + 1);
    }
  }, [last, isLoading, page, fetchNotifications]);

  const renderSkeleton = () => (
    <View style={styles.skeletonRow}>
      <Skeleton width={48} height={48} borderRadius={24} />
      <View style={styles.skeletonText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="50%" height={12} style={{ marginTop: 6 }} />
        <Skeleton width="30%" height={10} style={{ marginTop: 6 }} />
      </View>
    </View>
  );

  const renderItem = ({ item }: { item: NotificationResponse }) => {
    const unread = !item.isRead;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { backgroundColor: unread ? theme.colors.surfaceLight : theme.colors.surface },
        ]}
        onPress={() => {
          if (unread) markAsRead(item.id);
        }}
        activeOpacity={0.8}
      >
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={[styles.avatar, { borderColor: theme.colors.border }]} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryDark }]}>
            <Text style={styles.avatarGlyph}>♪</Text>
          </View>
        )}
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={1}
              style={[
                styles.rowTitle,
                { color: theme.colors.text, fontWeight: unread ? '700' : '500' },
              ]}
            >
              {item.title}
            </Text>
            {unread && <View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} />}
          </View>
          {item.body ? (
            <Text
              numberOfLines={2}
              style={[styles.body, { color: theme.colors.textSecondary }]}
            >
              {item.body}
            </Text>
          ) : null}
          <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
            {getRelativeTime(item.createdAt)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (isLoading && notifications.length === 0) {
      return (
        <View style={styles.listContainer}>
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i}>{renderSkeleton()}</View>
          ))}
        </View>
      );
    }

    if (error && notifications.length === 0) {
      return (
        <View style={styles.centerState}>
          <Text style={[styles.stateTitle, { color: theme.colors.text }]}>
            Couldn't load notifications
          </Text>
          <Text style={[styles.stateSubtitle, { color: theme.colors.textSecondary }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => {
              fetchNotifications(0);
              fetchUnreadCount();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (notifications.length === 0) {
      return (
        <View style={styles.centerState}>
          <View style={[styles.emptyCircle, { backgroundColor: theme.colors.surfaceLight }]}>
            <Text style={[styles.emptyGlyph, { color: theme.colors.textTertiary }]}>♪</Text>
          </View>
          <Text style={[styles.stateTitle, { color: theme.colors.text }]}>
            You're all caught up
          </Text>
          <Text style={[styles.stateSubtitle, { color: theme.colors.textSecondary }]}>
            No notifications yet. When something happens, it will show up here.
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isLoading && notifications.length > 0 ? (
            <ActivityIndicator
              style={styles.footerLoader}
              size="small"
              color={theme.colors.primary}
            />
          ) : null
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Notifications</Text>
        {unreadCount > 0 && (
          <View style={styles.headerActions}>
            <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
            <TouchableOpacity onPress={markAllAsRead} hitSlop={8}>
              <Text style={[styles.markAll, { color: theme.colors.primary }]}>Mark all read</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {renderContent()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#000', fontSize: 12, fontWeight: '700' },
  markAll: { fontSize: 14, fontWeight: '600' },
  listContainer: { flex: 1, paddingHorizontal: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  skeletonText: { flex: 1, marginLeft: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { color: '#000', fontSize: 20 },
  textContainer: { flex: 1, marginLeft: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { flex: 1, fontSize: 15 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  body: { fontSize: 13, marginTop: 2 },
  time: { fontSize: 12, marginTop: 4 },
  separator: { height: 8 },
  footerLoader: { marginTop: 16 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyGlyph: { fontSize: 28 },
  stateTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateSubtitle: { fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  retryButtonText: { color: '#000', fontSize: 14, fontWeight: '700' },
});

export default NotificationsScreen;
