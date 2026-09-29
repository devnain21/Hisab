import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Image, Modal, StyleSheet, Text, View } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { authenticateBiometric, disableLock, getLockConfig, lockSupported, verifyPin, type LockConfig } from "@/src/lib/app-lock";
import { confirmAction } from "@/src/lib/confirm";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";

export const PIN_LENGTH = 4;
const RELOCK_AFTER_MS = 30_000;

type LockCtx = { config: LockConfig; refresh: () => Promise<void> };
const AppLockContext = createContext<LockCtx>({ config: { enabled: false, biometric: false }, refresh: async () => {} });

export function useAppLock() {
  return useContext(AppLockContext);
}

export function PinPad({ value, onChange, onBiometric, error }: { value: string; onChange: (v: string) => void; onBiometric?: () => void; error?: string | null }) {
  const press = (d: string) => {
    if (value.length < PIN_LENGTH) onChange(value + d);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <View style={{ alignItems: "center" }}>
      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled, !!error && { borderColor: colors.error }]} />
        ))}
      </View>
      <Text style={styles.error}>{error ?? " "}</Text>
      <View style={styles.pad}>
        {keys.map((k) => (
          <Pressable key={k} style={styles.key} onPress={() => press(k)} testID={`pin-key-${k}`}>
            <Text style={styles.keyText}>{k}</Text>
          </Pressable>
        ))}
        {onBiometric ? (
          <Pressable style={styles.key} onPress={onBiometric} testID="pin-bio">
            <MaterialIcon name="fingerprint" size={30} color={colors.brandPrimary} />
          </Pressable>
        ) : (
          <View style={[styles.key, { backgroundColor: "transparent" }]} />
        )}
        <Pressable style={styles.key} onPress={() => press("0")} testID="pin-key-0">
          <Text style={styles.keyText}>0</Text>
        </Pressable>
        <Pressable style={[styles.key, { backgroundColor: "transparent" }]} onPress={() => onChange(value.slice(0, -1))} testID="pin-back">
          <MaterialIcon name="backspace-outline" size={26} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

export function PinSetupModal({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (pin: string) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPinValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setFirst(null);
      setPinValue("");
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    if (first === null) {
      setFirst(pin);
      setPinValue("");
      return;
    }
    if (pin === first) {
      void onDone(pin);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError("दोनों PIN मेल नहीं खाए, फिर से शुरू करें");
      setFirst(null);
      setPinValue("");
    }
  }, [pin, first, onDone]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.screen, { flex: 1, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg }}>
          <Pressable onPress={onClose} hitSlop={12} haptic={false} testID="pin-setup-close">
            <MaterialIcon name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>
        <View style={{ alignItems: "center" }}>
          <MaterialIcon name="lock-outline" size={40} color={colors.brandPrimary} />
          <Text style={[styles.title, { marginTop: spacing.md }]}>{first === null ? "नया 4 अंकों का PIN डालें" : "PIN दोबारा डालें"}</Text>
        </View>
        <PinPad value={pin} onChange={(v) => { setError(null); setPinValue(v); }} error={error} />
        <View style={{ height: 40 }} />
      </View>
    </Modal>
  );
}

function LockScreen({ config, onUnlock }: { config: LockConfig; onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tryBiometric = useCallback(async () => {
    if (await authenticateBiometric().catch(() => false)) onUnlock();
  }, [onUnlock]);

  useEffect(() => {
    if (config.biometric) void tryBiometric();
  }, [config.biometric, tryBiometric]);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    verifyPin(pin).then((ok) => {
      if (ok) {
        onUnlock();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError("गलत PIN, दोबारा डालें");
        setPin("");
      }
    });
  }, [pin, onUnlock]);

  const forgot = () => {
    confirmAction("PIN भूल गए?", "साइन आउट करके Google से दोबारा लॉगिन करें। लॉक हट जाएगा, डेटा सर्वर पर सुरक्षित है।", "साइन आउट", async () => {
      await disableLock();
      onUnlock();
      await signOut();
    });
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]} testID="lock-screen">
      <View style={{ alignItems: "center" }}>
        <Image source={require("@/assets/images/splash-icon.png")} style={styles.logo} />
        <Text style={styles.title}>PIN डालें</Text>
      </View>
      <PinPad value={pin} onChange={(v) => { setError(null); setPin(v); }} onBiometric={config.biometric ? tryBiometric : undefined} error={error} />
      <Pressable onPress={forgot} haptic={false} testID="pin-forgot">
        <Text style={styles.forgot}>PIN भूल गए?</Text>
      </Pressable>
    </View>
  );
}

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [config, setConfig] = useState<LockConfig>({ enabled: false, biometric: false });
  const [ready, setReady] = useState(!lockSupported);
  const [locked, setLocked] = useState(false);
  const backgroundAt = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setConfig(await getLockConfig());
  }, []);

  useEffect(() => {
    if (!lockSupported) return;
    getLockConfig().then((c) => {
      setConfig(c);
      setLocked(c.enabled);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!lockSupported) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") backgroundAt.current = Date.now();
      if (s === "active" && backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_AFTER_MS) {
        getLockConfig().then((c) => {
          setConfig(c);
          if (c.enabled) setLocked(true);
        });
      }
      if (s === "active") backgroundAt.current = null;
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(() => setLocked(false), []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  return (
    <AppLockContext.Provider value={{ config, refresh }}>
      {children}
      {locked && config.enabled && status === "authenticated" ? <LockScreen config={config} onUnlock={unlock} /> : null}
    </AppLockContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surface, justifyContent: "space-between", alignItems: "center", zIndex: 100 },
  logo: { width: 72, height: 72, marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  dots: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.brandPrimary },
  dotFilled: { backgroundColor: colors.brandPrimary },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.md, minHeight: 18 },
  pad: { flexDirection: "row", flexWrap: "wrap", width: 3 * 76 + 2 * spacing.lg, gap: spacing.lg, marginTop: spacing.md, justifyContent: "center" },
  key: { width: 76, height: 76, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 28, fontWeight: "600", color: colors.onSurface },
  forgot: { color: colors.brandPrimary, fontSize: 14, fontWeight: "600", padding: spacing.md },
});
