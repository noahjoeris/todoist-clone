import type { RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LabelListItem, ProjectListItem, TaskActiveCounts } from '../../data/repositories';
import { activeProjects, favoriteProjects } from '../../data/repositories';
import type { AccountEntry } from '../account-entry';
import { SIDEBAR_WIDTH } from '../drawer-presence';
import type { HomePane } from '../home-pane';
import { isSamePane } from '../home-pane';
import { colors, hexForLabelColor } from '../theme';
import { ActionButton } from './ActionButton';

interface SidebarProps {
  account: AccountEntry;
  pane: HomePane;
  counts: TaskActiveCounts;
  syncLabel?: string | undefined;
  onSelect: (pane: HomePane) => void;
  onAddTask: () => void;
  onSearch: () => void;
  searchButtonRef?: RefObject<View | null>;
  favoriteLabels?: LabelListItem[];
  projects?: ProjectListItem[];
  onCreateProject?: () => void;
}

export function Sidebar({
  account,
  pane,
  counts,
  syncLabel,
  onSelect,
  onAddTask,
  onSearch,
  searchButtonRef,
  favoriteLabels,
  projects,
  onCreateProject,
}: SidebarProps) {
  const showLabels = favoriteLabels != null;
  const showProjects = projects != null;
  const myProjects = showProjects ? activeProjects(projects) : [];
  const favoriteProjectItems = showProjects ? favoriteProjects(projects) : [];
  const showFavorites =
    favoriteProjectItems.length > 0 || (showLabels && (favoriteLabels?.length ?? 0) > 0);
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
        <ActionButton
          ref={searchButtonRef}
          label="Search"
          accessibilityLabel="Search tasks"
          onPress={onSearch}
        />
      </View>
      <ScrollView
        accessibilityRole="list"
        style={styles.navScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.nav}>
          <NavItem
            label="Inbox"
            count={counts.inbox}
            selected={pane.type === 'inbox'}
            onPress={() => onSelect({ type: 'inbox' })}
          />
          <NavItem
            label="Today"
            count={counts.today}
            selected={pane.type === 'today'}
            onPress={() => onSelect({ type: 'today' })}
          />
          <NavItem
            label="Upcoming"
            selected={pane.type === 'upcoming'}
            onPress={() => onSelect({ type: 'upcoming' })}
          />
          {showLabels && (
            <NavItem
              label="Labels"
              selected={pane.type === 'labels'}
              onPress={() => onSelect({ type: 'labels' })}
            />
          )}
        </View>
        {showFavorites && (
          <View style={styles.favorites}>
            <Text style={styles.favoritesTitle}>Favorites</Text>
            {favoriteProjectItems.map((project) => (
              <NavItem
                key={`project-${project.id}`}
                label={project.name}
                count={project.activeTaskCount}
                selected={isSamePane(pane, { type: 'project', projectId: project.id })}
                color={hexForLabelColor(project.color)}
                onPress={() => onSelect({ type: 'project', projectId: project.id })}
              />
            ))}
            {showLabels &&
              favoriteLabels.map((label) => (
                <NavItem
                  key={`label-${label.id}`}
                  label={label.name}
                  count={label.activeTaskCount}
                  selected={isSamePane(pane, { type: 'label', labelId: label.id })}
                  color={hexForLabelColor(label.color)}
                  onPress={() => onSelect({ type: 'label', labelId: label.id })}
                />
              ))}
          </View>
        )}
        {showProjects && (
          <View style={styles.favorites}>
            <View style={styles.sectionHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Manage projects"
                accessibilityState={{ selected: pane.type === 'projects' }}
                onPress={() => onSelect({ type: 'projects' })}
                style={({ pressed }) => [
                  styles.sectionTitleButton,
                  (pressed || pane.type === 'projects') && styles.active,
                ]}
              >
                <Text style={styles.favoritesTitle}>My Projects</Text>
              </Pressable>
              {onCreateProject && (
                <ActionButton
                  label="+"
                  accessibilityLabel="Add project"
                  color={colors.accent}
                  onPress={onCreateProject}
                />
              )}
            </View>
            {myProjects.map((project) => (
              <NavItem
                key={project.id}
                label={project.name}
                count={project.activeTaskCount}
                selected={isSamePane(pane, { type: 'project', projectId: project.id })}
                color={hexForLabelColor(project.color)}
                onPress={() => onSelect({ type: 'project', projectId: project.id })}
              />
            ))}
          </View>
        )}
      </ScrollView>
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
  color,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
  color?: string;
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
      <View style={styles.navLabelRow}>
        {color && <View style={[styles.dot, { backgroundColor: color }]} />}
        <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{label}</Text>
      </View>
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
  add: { alignSelf: 'flex-start', gap: 8 },
  navScroll: { flex: 1 },
  nav: { gap: 4 },
  favorites: { gap: 4, marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitleButton: { flex: 1, minHeight: 44, justifyContent: 'center', borderRadius: 9 },
  favoritesTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  navItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderRadius: 9,
    gap: 8,
  },
  navLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  active: { backgroundColor: colors.hover },
  navLabel: { color: colors.text, fontSize: 15, flexShrink: 1 },
  navLabelSelected: { fontWeight: '600' },
  navCount: { color: colors.muted, fontSize: 13 },
});
