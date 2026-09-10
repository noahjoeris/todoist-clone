import { StatusBar } from 'expo-status-bar';
import { createDataSystem, type DataSystem } from './src/data/system';
import { RootScreen } from './src/ui/RootScreen';
import { ConfigurationErrorScreen } from './src/ui/screens/ConfigurationErrorScreen';

type Bootstrap = { system: DataSystem } | { error: Error };

// Open the local database once. Guest tasks do not require cloud configuration; auth is
// optional and its (mis)configuration is reported inside the app rather than thrown here.
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
        <RootScreen system={bootstrapResult.system} />
      )}
      <StatusBar style="light" />
    </>
  );
}
