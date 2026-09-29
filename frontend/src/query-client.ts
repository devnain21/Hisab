// One QueryClient for the whole app; the provider in app/_layout.tsx uses
// this instance. Import it for cache calls outside components, for example
// queryClient.invalidateQueries or setQueryData in websocket or push
// handlers; inside components useQueryClient() returns this same instance.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

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

// Keeps the last synced khata on the device so it opens without internet.
export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage, key: "hisab_query_cache_v1" });
