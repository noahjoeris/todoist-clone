import { Linking } from 'react-native';
import type { RegisterAuthDeepLink } from './auth-deep-link';
import { createAuthDeepLinkHandler } from './auth-deep-link-guard';

// Confirmation emails redirect to `todoist-clone://auth/callback`. Cold start uses
// `getInitialURL`; a running app uses the `url` event. In-flight and already-consumed
// URLs are ignored (`code` is single-use); a failed exchange can be retried.
export const registerAuthDeepLink: RegisterAuthDeepLink = (onUrl) => {
  const handle = createAuthDeepLinkHandler(onUrl);

  void Linking.getInitialURL().then(
    (url) => void handle(url),
    () => {},
  );
  const subscription = Linking.addEventListener('url', (event) => {
    void handle(event.url);
  });
  return () => subscription.remove();
};
