import { StyleSheet, Text, View } from 'react-native';
import type { GuestTaskAdoptionRepository } from '../../data/repositories';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useGuestTaskAdoption } from '../hooks/useGuestTaskAdoption';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';
import { FormError } from './FormScreen';

interface GuestTaskAdoptionBannerProps {
  repository: GuestTaskAdoptionRepository;
  userId: string;
}

/** Prompt to copy guest tasks into the signed-in account. Hidden when there is nothing to offer. */
export function GuestTaskAdoptionBanner({ repository, userId }: GuestTaskAdoptionBannerProps) {
  const state = useGuestTaskAdoption(repository);
  const { pending, error, run } = useAsyncAction((cause) =>
    cause instanceof Error ? cause : new Error(String(cause)),
  );

  if (state.status !== 'offer') return null;

  const countLabel = state.count === 1 ? 'task' : 'tasks';

  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <Text accessibilityRole="header" style={styles.message}>
          You have {state.count} {countLabel} from before you signed in.
        </Text>
        {error && <FormError message="Couldn’t save that. Try again." />}
        <View style={styles.actions}>
          <ActionButton
            label={pending ? 'Adding…' : 'Add to my account'}
            accent
            disabled={pending}
            onPress={() =>
              void run(async () => {
                await repository.adopt(userId);
              })
            }
          />
          <ActionButton
            label="Not now"
            disabled={pending}
            onPress={() => {
              repository.skip();
            }}
          />
          <ActionButton
            label="Don't ask again"
            color={colors.muted}
            disabled={pending}
            onPress={() => void run(() => repository.dismissForever())}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inner: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  message: { color: colors.text, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
