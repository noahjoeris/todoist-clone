import { Alert, Platform } from 'react-native';
import { deleteProjectMessage } from './project-delete-copy';

export function confirmProjectDelete(name: string, affectedCount: number): Promise<boolean> {
  const message = deleteProjectMessage(name, affectedCount);
  if (Platform.OS === 'web') {
    const confirm = (globalThis as { confirm?: (text?: string) => boolean }).confirm;
    return Promise.resolve(confirm?.(message) ?? true);
  }
  return new Promise((resolve) => {
    Alert.alert('Delete project?', message, [
      { text: 'Keep project', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
