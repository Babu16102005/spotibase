import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeStore } from '../store';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, actionLabel, onAction }) => {
  const { theme } = useThemeStore();

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {actionLabel && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={[styles.action, { color: theme.colors.primary }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  titleContainer: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },
  action: { fontSize: 13, fontWeight: '600' },
});

export default SectionHeader;
