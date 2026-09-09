import { StatusBar } from 'expo-status-bar';
import { createDataSystem, type DataSystem } from './src/data/system';
import { ConfigurationErrorScreen } from './src/ui/screens/ConfigurationErrorScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';

type Bootstrap = { system: DataSystem } | { error: Error };

// Open the local database once at startup, like a local-first app should. Missing public
// configuration is the most common setup mistake, so surface it instead of crashing.
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
        <HomeScreen />
      )}
      <StatusBar style="auto" />
    </>
  );
}
