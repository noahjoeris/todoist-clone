import { Alert, Platform } from 'react-native';

export function confirmDiscard(): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
    return Promise.resolve(confirm?.('Discard unsaved changes?') ?? true);
  }
  return new Promise((resolve) => {
    Alert.alert('Discard changes?', 'Your edits will be lost.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Discard', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
