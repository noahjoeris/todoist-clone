import { Alert, Platform } from 'react-native';
import { deleteMessage } from './label-delete-copy';

export function confirmLabelDelete(name: string, affectedCount: number): Promise<boolean> {
  const message = deleteMessage(name, affectedCount);
  if (Platform.OS === 'web') {
    const confirm = (globalThis as { confirm?: (text?: string) => boolean }).confirm;
    return Promise.resolve(confirm?.(message) ?? true);
  }
  return new Promise((resolve) => {
    Alert.alert('Delete label?', message, [
      { text: 'Keep label', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
