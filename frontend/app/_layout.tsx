import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { LogBox } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { AppLockGate } from "@/src/components/app-lock";
import { CACHE_BUSTER, CACHE_MAX_AGE, queryClient, queryPersister } from "@/src/query-client";
import { AuthProvider } from "@/src/context/AuthContext";
import { wakeBackend } from "@/src/lib/api";
import { pruneDailyKeys } from "@/src/lib/daily-keys";
import { loadPrefs } from "@/src/lib/prefs";

LogBox.ignoreAllLogs(true);
wakeBackend();
void loadPrefs();
setTimeout(() => void pruneDailyKeys(), 8000);

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: CACHE_MAX_AGE, buster: CACHE_BUSTER }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <AuthProvider>
              <AppLockGate>
                <Stack screenOptions={{ headerShown: false }} />
              </AppLockGate>
            </AuthProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
