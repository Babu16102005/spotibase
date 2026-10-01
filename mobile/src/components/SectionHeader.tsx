import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeStore } from '../store';
import GlassButton from './GlassButton';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'button' | 'link';
  actionIcon?: string;
  actionTestID?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actionLabel = 'Show all',
  onAction,
  actionVariant = 'link',
  actionIcon,
  actionTestID,
}) => {
  const { theme } = useThemeStore();

  const renderAction = () => {
    if (!actionLabel || !onAction) return null;
    if (actionVariant === 'button') {
      return (
        <GlassButton
          variant="secondary"
          size="sm"
          icon={actionIcon ?? 'music'}
          title={actionLabel}
          onPress={onAction}
          testID={actionTestID}
          accessibilityLabel="Open YouTube songs"
          style={styles.actionButton}
        />
      );
    }
    return (
      <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[styles.action, { color: theme.colors.textSecondary }]}>{actionLabel}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {actionLabel && onAction && renderAction()}
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
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, marginTop: 2, opacity: 0.8 },
  action: { fontSize: 13, fontWeight: '700', marginLeft: 12 },
  // 44px minimum touch target for the button variant (GlassButton sm is
  // 36px tall — minHeight enforces WCAG/Expo a11y target without changing
  // the shared button metrics). Theme comes from GlassButton secondary.
  actionButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
});

export default React.memo(SectionHeader);