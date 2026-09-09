import { ScrollView, StyleSheet, Text } from 'react-native';

interface ConfigurationErrorScreenProps {
  error: Error;
}

export function ConfigurationErrorScreen({ error }: ConfigurationErrorScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Configuration error</Text>
      <Text style={styles.message}>{error.message}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  message: {
    fontFamily: 'monospace',
  },
});
