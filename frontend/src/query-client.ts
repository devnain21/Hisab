// One QueryClient for the whole app; the provider in app/_layout.tsx uses
// this instance. Import it for cache calls outside components, for example
// queryClient.invalidateQueries or setQueryData in websocket or push
// handlers; inside components useQueryClient() returns this same instance.
import { AppState, Platform } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { fileStore } from "@/src/lib/file-store";

export const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: CACHE_MAX_AGE,
      retry: 3,
      retryDelay: (n) => Math.min(2000 * 2 ** n, 15_000),
    },
  },
});

// Native apps have no window focus event; refetch when the app comes back to the foreground
// so entries made on the website show up.
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (s) => setFocused(s === "active"));
    return () => sub.remove();
  });
}

// Keeps the last synced khata on the device so it opens without internet.
export const queryPersister = createAsyncStoragePersister({ storage: fileStore, key: "hisab_query_cache_v1", throttleTime: 2000 });
