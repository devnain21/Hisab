import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { Platform } from "react-native";

// Public client config. `eas update` does not pass build env vars, so these defaults
// keep OTA bundles working; env vars still override them for local dev.
const DEFAULTS = {
  apiKey: "AIzaSyD_l5it1cjOwmkxUxA64FEztV3Z_JGdNWo",
  authDomain: "hisab-kitab-c777e.firebaseapp.com",
  projectId: "hisab-kitab-c777e",
  storageBucket: "hisab-kitab-c777e.firebasestorage.app",
  messagingSenderId: "623533267328",
  appId: "1:623533267328:android:13c6e100ab2035c0b40965",
  webClientId: "623533267328-bfjl8qbevkl3om46v9s6scocmmv6977h.apps.googleusercontent.com",
};

function readConfig() {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || DEFAULTS.apiKey,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || DEFAULTS.authDomain,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || DEFAULTS.projectId,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || DEFAULTS.storageBucket,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || DEFAULTS.messagingSenderId,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || DEFAULTS.appId,
  };
}

export function isFirebaseConfigured(): boolean {
  const c = readConfig();
  return Boolean(c.apiKey && c.projectId && c.appId);
}

export function getGoogleClientIds() {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || DEFAULTS.webClientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "",
  };
}

let authSingleton: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase config missing. frontend/.env me EXPO_PUBLIC_FIREBASE_* keys daalo.");
  }
  if (getApps().length) return getApp();
  return initializeApp(readConfig());
}

export function getFirebaseAuth(): Auth {
  if (authSingleton) return authSingleton;
  const app = getFirebaseApp();
  if (Platform.OS === "web") {
    authSingleton = getAuth(app);
    return authSingleton;
  }
  try {
    authSingleton = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    authSingleton = getAuth(app);
  }
  return authSingleton;
}
