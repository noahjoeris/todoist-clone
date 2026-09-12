export function subscribeAppForeground(listener: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', listener);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', listener);
  };
}
