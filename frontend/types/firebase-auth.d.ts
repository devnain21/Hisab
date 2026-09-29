import type { Persistence, ReactNativeAsyncStorage } from "firebase/auth";

// firebase 12 ships getReactNativePersistence only in its react-native build
// (@firebase/auth "react-native" entry), while the published types describe the
// web build. Metro resolves the react-native entry, so the runtime export exists.
declare module "firebase/auth" {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
