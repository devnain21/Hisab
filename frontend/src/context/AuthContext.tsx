import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { api, setTokenProvider } from "@/src/lib/api";
import { getFirebaseAuth, getGoogleClientIds, isFirebaseConfigured } from "@/src/lib/firebase";
import { clearOutbox, flush, parkOutbox, unparkOutbox } from "@/src/lib/store";
import { clearFileStore } from "@/src/lib/file-store";
import { resetTrashMemory } from "@/src/lib/trash";
import { resetRecentCustomers } from "@/src/lib/recent";
import { disableLock } from "@/src/lib/app-lock";
import { queryClient } from "@/src/query-client";

if (Platform.OS !== "web") {
  const { webClientId } = getGoogleClientIds();
  if (webClientId) GoogleSignin.configure({ webClientId });
}

export type ShopProfile = {
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  shop_gst: string;
  shop_upi?: string;
  owner_name?: string;
  persona?: "business" | "personal";
};
type User = { user_id: string; email: string; name: string; picture?: string | null } & Partial<ShopProfile>;
type AuthState = { status: "loading" | "authenticated" | "unauthenticated"; user: User | null };

type Ctx = AuthState & {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setShop: (shop: ShopProfile) => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

const PROFILE_KEY = "hisab_profile_v1";

async function readCachedProfile(uid: string): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    const saved = raw ? (JSON.parse(raw) as { uid: string; user: User }) : null;
    return saved?.uid === uid ? saved.user : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(uid: string, user: User) {
  AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ uid, user })).catch(() => {});
}

function mapFirebaseUser(u: { uid: string; email: string | null; displayName: string | null; photoURL: string | null }): User {
  return {
    user_id: u.uid,
    email: u.email || "",
    name: u.displayName || u.email || "User",
    picture: u.photoURL,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const userRef = useRef<User | null>(null);
  userRef.current = state.user;

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setTokenProvider(null);
      setState({ status: "unauthenticated", user: null });
      return;
    }

    const auth = getFirebaseAuth();
    setTokenProvider(async () => {
      const current = auth.currentUser;
      if (!current) return null;
      return current.getIdToken();
    });

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ status: "unauthenticated", user: null });
        return;
      }
      // The free backend can take up to a minute to wake up (or we may be offline), so don't block on it.
      const cached = await readCachedProfile(fbUser.uid);
      await unparkOutbox(fbUser.uid);
      setState({ status: "authenticated", user: cached ?? mapFirebaseUser(fbUser) });
      void flush();
      try {
        const token = await fbUser.getIdToken();
        const me = await api.login(token);
        if (me.user && auth.currentUser?.uid === fbUser.uid) {
          const user: User = { ...(cached ?? {}), ...me.user };
          setState({ status: "authenticated", user });
          writeCachedProfile(fbUser.uid, user);
        }
      } catch {}
    });

    return () => {
      unsub();
      setTokenProvider(null);
    };
  }, []);

  const signIn = useCallback(async () => {
    if (Platform.OS === "web") {
      if (!isFirebaseConfigured()) {
        throw new Error("Firebase config set nahi hai. frontend/.env dekho.");
      }
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(getFirebaseAuth(), provider);
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
        if (code === "auth/popup-blocked") {
          throw new Error("Browser ne login popup block kar diya. Is site ke liye popups allow karo aur dobara try karo.");
        }
        throw e;
      }
      return;
    }
    if (!isFirebaseConfigured() || !getGoogleClientIds().webClientId) {
      throw new Error("Firebase / Google Client ID set nahi hai. frontend/.env dekho.");
    }
    let idToken: string | null = null;
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result.type !== "success") return;
      idToken = result.data.idToken;
    } catch (e: unknown) {
      if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return;
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Is phone me Google Play Services nahi hai ya purana hai.");
      }
      throw e;
    }
    if (!idToken) {
      throw new Error("Google se ID token nahi mila");
    }
    await signInWithCredential(getFirebaseAuth(), GoogleAuthProvider.credential(idToken));
  }, []);

  const signOut = useCallback(async () => {
    const uid = isFirebaseConfigured() ? getFirebaseAuth().currentUser?.uid : undefined;
    // Changes not yet on the server would otherwise be lost; they come back when this account signs in again.
    if (uid) await parkOutbox(uid);
    try {
      await api.logout();
    } catch {}
    if (Platform.OS !== "web") {
      try {
        await GoogleSignin.signOut();
      } catch {}
    }
    try {
      if (isFirebaseConfigured()) {
        await firebaseSignOut(getFirebaseAuth());
      }
    } catch {}
    // The next person to sign in on this device must not see this khata or inherit its PIN.
    await clearOutbox();
    queryClient.clear();
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
    // Recycle bin, recent customers, mode, counted cash and old local copies all belong to this account.
    try {
      const keys = await AsyncStorage.getAllKeys();
      const mine = keys.filter((k) => k.startsWith("hisab_") && !k.startsWith("hisab_applock_"));
      if (mine.length) await AsyncStorage.multiRemove(mine);
    } catch {}
    await clearFileStore();
    resetTrashMemory();
    resetRecentCustomers();
    await disableLock().catch(() => {});
    setState({ status: "unauthenticated", user: null });
  }, []);

  // Applied locally first so every screen switches mode/name at once, even before the server answers.
  const setShop = useCallback(async (shop: ShopProfile) => {
    const uid = getFirebaseAuth().currentUser?.uid;
    const current = userRef.current;
    if (!current) return;
    const local: User = { ...current, ...shop };
    userRef.current = local;
    setState((s) => (s.user ? { ...s, user: local } : s));
    if (uid) writeCachedProfile(uid, local);
    const me = await api.updateMe(shop);
    // An older server may not echo every field back; keep what was just saved.
    const saved: User = { ...local, ...me, ...shop };
    userRef.current = saved;
    setState((s) => (s.user ? { ...s, user: saved } : s));
    if (uid) writeCachedProfile(uid, saved);
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut, setShop }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
