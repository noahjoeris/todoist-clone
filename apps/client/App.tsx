import { StatusBar } from 'expo-status-bar';
import { createDataSystem, type DataSystem } from './src/data/system';
import { ConfigurationErrorScreen } from './src/ui/screens/ConfigurationErrorScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';

type Bootstrap = { system: DataSystem } | { error: Error };

// Open the local database once. Guest tasks do not require cloud configuration.
function bootstrap(): Bootstrap {
  try {
    return { system: createDataSystem() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

const bootstrapResult = bootstrap();

export default function App() {
  return (
    <>
      {'error' in bootstrapResult ? (
        <ConfigurationErrorScreen error={bootstrapResult.error} />
      ) : (
        <HomeScreen repository={bootstrapResult.system.tasks} />
      )}
      <StatusBar style="light" />
    </>
  );
}
