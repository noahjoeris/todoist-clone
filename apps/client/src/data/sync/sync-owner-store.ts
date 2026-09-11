import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncOwnerStore } from './sync-lifecycle';

const QUEUED_OWNER_KEY = 'todoist-clone.sync.queued-owner';

/** Survives process death so a later account cannot inherit the previous upload queue. */
export function createSyncOwnerStore(): SyncOwnerStore {
  return {
    async get() {
      return AsyncStorage.getItem(QUEUED_OWNER_KEY);
    },
    async set(userId) {
      if (userId == null) {
        await AsyncStorage.removeItem(QUEUED_OWNER_KEY);
        return;
      }
      await AsyncStorage.setItem(QUEUED_OWNER_KEY, userId);
    },
  };
}
