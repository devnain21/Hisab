import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const PIN_KEY = "hisab_applock_pin";
const BIO_KEY = "hisab_applock_bio";
const FAIL_KEY = "hisab_applock_fails";

export const lockSupported = Platform.OS !== "web";

export type LockConfig = { enabled: boolean; biometric: boolean };

const hash = (pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `hisab-pin:${pin}`);

export async function getLockConfig(): Promise<LockConfig> {
  if (!lockSupported) return { enabled: false, biometric: false };
  const [pin, bio] = await Promise.all([SecureStore.getItemAsync(PIN_KEY), SecureStore.getItemAsync(BIO_KEY)]);
  return { enabled: !!pin, biometric: !!pin && bio === "1" };
}

export async function setPin(pin: string) {
  await SecureStore.setItemAsync(PIN_KEY, await hash(pin));
  await resetPinFails();
}

async function verifyPin(pin: string) {
  const saved = await SecureStore.getItemAsync(PIN_KEY);
  return !!saved && saved === (await hash(pin));
}

// A 4-digit PIN has only 10,000 values, so wrong tries are slowed down (kept across app restarts).
const FREE_TRIES = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;
type Fails = { count: number; until: number };

async function readFails(): Promise<Fails> {
  try {
    const raw = await SecureStore.getItemAsync(FAIL_KEY);
    const f = raw ? (JSON.parse(raw) as Fails) : null;
    return f && typeof f.count === "number" ? f : { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

export async function resetPinFails() {
  if (!lockSupported) return;
  await SecureStore.deleteItemAsync(FAIL_KEY).catch(() => {});
}

/** Milliseconds left before another PIN may be tried (0 = allowed now). */
export async function pinWaitMs() {
  const f = await readFails();
  return Math.max(0, f.until - Date.now());
}

export async function checkPin(pin: string): Promise<{ ok: boolean; waitMs: number }> {
  const f = await readFails();
  const now = Date.now();
  if (f.until > now) return { ok: false, waitMs: f.until - now };
  if (await verifyPin(pin)) {
    await resetPinFails();
    return { ok: true, waitMs: 0 };
  }
  const count = f.count + 1;
  const waitMs = count >= FREE_TRIES ? Math.min(FIRST_WAIT_MS * 2 ** (count - FREE_TRIES), MAX_WAIT_MS) : 0;
  await SecureStore.setItemAsync(FAIL_KEY, JSON.stringify({ count, until: now + waitMs })).catch(() => {});
  return { ok: false, waitMs };
}

export async function setBiometric(on: boolean) {
  await SecureStore.setItemAsync(BIO_KEY, on ? "1" : "0");
}

export async function disableLock() {
  if (!lockSupported) return;
  await Promise.all([SecureStore.deleteItemAsync(PIN_KEY), SecureStore.deleteItemAsync(BIO_KEY), resetPinFails()]);
}

export async function biometricAvailable() {
  if (!lockSupported) return false;
  const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  return hw && enrolled;
}

export async function authenticateBiometric() {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: "हिसाब खोलें",
    cancelLabel: "PIN डालें",
    disableDeviceFallback: true,
  });
  return r.success;
}
