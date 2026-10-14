import "react-native-reanimated";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { isRetryableError } from "../src/services/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Only retry transient errors (network / timeout / 5xx that we marked retryable).
      // Never blind-retry auth (401/403), not-found (404) or auth-not-configured (503).
      retry: (failureCount, error) => isRetryableError(error) && failureCount < 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000)
    }
  }
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
