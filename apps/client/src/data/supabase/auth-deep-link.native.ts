import { Linking } from 'react-native';
import type { RegisterAuthDeepLink } from './auth-deep-link';

// Confirmation emails redirect to `todoist-clone://auth/callback`. Cold start uses
// `getInitialURL`; a running app uses the `url` event. Duplicate deliveries of the
// same URL are ignored (`code` is single-use).
export const registerAuthDeepLink: RegisterAuthDeepLink = (onUrl) => {
  let lastUrl: string | undefined;
  const handle = (url: string | null) => {
    if (url == null || url === lastUrl) return;
    lastUrl = url;
    void onUrl(url);
  };

  void Linking.getInitialURL().then(handle, () => {});
  const subscription = Linking.addEventListener('url', (event) => handle(event.url));
  return () => subscription.remove();
};
