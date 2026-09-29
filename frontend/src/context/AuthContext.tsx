import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";
import { api, setTokenProvider } from "@/src/lib/api";
import { getFirebaseAuth, getGoogleClientIds, isFirebaseConfigured } from "@/src/lib/firebase";

WebBrowser.maybeCompleteAuthSession();

type User = { user_id: string; email: string; name: string; picture?: string | null };
type AuthState = { status: "loading" | "authenticated" | "unauthenticated"; user: User | null };

type Ctx = AuthState & {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

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
  const ids = getGoogleClientIds();

  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    clientId: ids.webClientId || undefined,
    iosClientId: ids.iosClientId || undefined,
    androidClientId: ids.androidClientId || undefined,
    webClientId: ids.webClientId || undefined,
  });

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
      try {
        const token = await fbUser.getIdToken();
        const me = await api.login(token);
        setState({ status: "authenticated", user: me.user ?? mapFirebaseUser(fbUser) });
      } catch {
        try {
          const me = await api.me();
          setState({ status: "authenticated", user: me });
        } catch {
          setState({ status: "authenticated", user: mapFirebaseUser(fbUser) });
        }
      }
    });

    return () => {
      unsub();
      setTokenProvider(null);
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!isFirebaseConfigured() || !ids.webClientId) {
      throw new Error("Firebase / Google Client ID set nahi hai. frontend/.env dekho.");
    }
    if (!request) {
      throw new Error("Google Sign-In ready nahi hai. App dubara start karo.");
    }
    const result = await promptAsync();
    if (result.type !== "success") {
      if (result.type === "dismiss" || result.type === "cancel") return;
      throw new Error("Google sign-in cancel ya fail ho gaya");
    }
    const idToken = result.params.id_token;
    if (!idToken) {
      throw new Error("Google se ID token nahi mila");
    }
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(getFirebaseAuth(), credential);
  }, [ids.webClientId, promptAsync, request]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    try {
      if (isFirebaseConfigured()) {
        await firebaseSignOut(getFirebaseAuth());
      }
    } catch {}
    setState({ status: "unauthenticated", user: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
