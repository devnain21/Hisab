import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { api, clearToken, getToken, saveToken, setInMemoryToken } from "@/src/lib/api";

WebBrowser.maybeCompleteAuthSession();

type User = { user_id: string; email: string; name: string; picture?: string | null };
type AuthState = { status: "loading" | "authenticated" | "unauthenticated"; user: User | null };

type Ctx = AuthState & {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);
const processedSessionIds = new Set<string>();

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const exchange = useCallback(async (sid: string) => {
    if (!sid || processedSessionIds.has(sid)) return;
    processedSessionIds.add(sid);
    try {
      const data = await api.exchangeSession(sid);
      await saveToken(data.session_token);
      setInMemoryToken(data.session_token);
      setState({ status: "authenticated", user: data.user });
    } catch (e) {
      console.log("exchange failed", e);
    }
  }, []);

  // Bootstrap: check existing token & handle deep link session_id
  useEffect(() => {
    let unsub: any;
    let capturedUrl: string | null = null;

    const boot = async () => {
      // Web: parse session_id from URL first
      if (Platform.OS === "web") {
        const url = typeof window !== "undefined" ? window.location.href : "";
        const sid = extractSessionId(url);
        if (sid) {
          await exchange(sid);
          try {
            const clean = window.location.origin + window.location.pathname;
            window.history.replaceState(window.history.state, "", clean);
          } catch {}
          return;
        }
      } else {
        // Mobile: register listener BEFORE any deep-link source
        unsub = Linking.addEventListener("url", (evt) => {
          capturedUrl = evt.url;
          const sid = extractSessionId(evt.url);
          if (sid) void exchange(sid);
        });
        const initial = await Linking.getInitialURL();
        const sid = extractSessionId(initial);
        if (sid) {
          await exchange(sid);
          return;
        }
      }

      // Check existing token
      const token = await getToken();
      if (token) {
        setInMemoryToken(token);
        try {
          const user = await api.me();
          setState({ status: "authenticated", user });
          return;
        } catch {
          await clearToken();
          setInMemoryToken(null);
        }
      }
      setState({ status: "unauthenticated", user: null });
    };
    void boot();
    return () => {
      if (unsub && typeof unsub.remove === "function") unsub.remove();
    };
  }, [exchange]);

  const signIn = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? typeof window !== "undefined"
          ? window.location.origin + "/"
          : "/"
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }

    // Mobile: register listener before opening browser
    let captured: string | null = null;
    const sub = Linking.addEventListener("url", (evt) => {
      captured = evt.url;
    });
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let url: string | null = null;
      if (result.type === "success" && (result as any).url) {
        url = (result as any).url;
      }
      if (!url && captured) url = captured;
      if (!url) url = await Linking.getInitialURL();
      const sid = extractSessionId(url);
      if (sid) await exchange(sid);
    } finally {
      sub.remove();
    }
  }, [exchange]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    setInMemoryToken(null);
    await clearToken();
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
