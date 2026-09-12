import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TaskActiveCounts, TaskDestination } from '../../data/repositories';
import type { AccountEntry } from '../account-entry';
import { SIDEBAR_WIDTH } from '../drawer-presence';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';

interface SidebarProps {
  account: AccountEntry;
  destination: TaskDestination;
  counts: TaskActiveCounts;
  syncLabel?: string | undefined;
  onSelect: (destination: TaskDestination) => void;
  onAddTask: () => void;
}

export function Sidebar({
  account,
  destination,
  counts,
  syncLabel,
  onSelect,
  onAddTask,
}: SidebarProps) {
  return (
    <View style={styles.sidebar} accessibilityRole="menu">
      <AccountEntryView account={account} />
      {syncLabel && (
        <Text accessibilityLiveRegion="polite" style={styles.sync}>
          {syncLabel}
        </Text>
      )}
      <View style={styles.add}>
        <ActionButton label="+ Add task" color={colors.accent} onPress={onAddTask} />
      </View>
      <View accessibilityRole="list" style={styles.nav}>
        <NavItem
          label="Inbox"
          count={counts.inbox}
          selected={destination === 'inbox'}
          onPress={() => onSelect('inbox')}
        />
        <NavItem
          label="Today"
          count={counts.today}
          selected={destination === 'today'}
          onPress={() => onSelect('today')}
        />
        <NavItem
          label="Upcoming"
          selected={destination === 'upcoming'}
          onPress={() => onSelect('upcoming')}
        />
      </View>
    </View>
  );
}

function AccountEntryView({ account }: { account: AccountEntry }) {
  if (account.kind === 'hidden') return null;
  if (account.kind === 'unavailable') {
    return (
      <Text accessibilityRole="alert" style={styles.unavailable}>
        Sign-in is unavailable. {account.message}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={account.kind === 'sign-in' ? 'Sign in' : `Account, ${account.label}`}
      onPress={account.onPress}
      style={({ pressed }) => [styles.account, pressed && styles.active]}
    >
      <Text style={styles.accountLabel}>
        {account.kind === 'sign-in' ? 'Sign in' : account.label}
      </Text>
    </Pressable>
  );
}

function NavItem({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const accessibilityLabel =
    count == null ? label : `${label}, ${count} ${count === 1 ? 'task' : 'tasks'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.navItem, (pressed || selected) && styles.active]}
    >
      <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{label}</Text>
      {count != null && <Text style={styles.navCount}>{count}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  account: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  accountLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  unavailable: { color: colors.error, fontSize: 13, lineHeight: 18 },
  sync: { color: colors.muted, fontSize: 13, paddingHorizontal: 8 },
  add: { alignSelf: 'flex-start' },
  nav: { gap: 4 },
  navItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderRadius: 9,
  },
  active: { backgroundColor: colors.hover },
  navLabel: { color: colors.text, fontSize: 15 },
  navLabelSelected: { fontWeight: '600' },
  navCount: { color: colors.muted, fontSize: 13 },
});
