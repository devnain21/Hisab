import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const PIN_KEY = "hisab_applock_pin";
const BIO_KEY = "hisab_applock_bio";

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
}

export async function verifyPin(pin: string) {
  const saved = await SecureStore.getItemAsync(PIN_KEY);
  return !!saved && saved === (await hash(pin));
}

export async function setBiometric(on: boolean) {
  await SecureStore.setItemAsync(BIO_KEY, on ? "1" : "0");
}

export async function disableLock() {
  if (!lockSupported) return;
  await Promise.all([SecureStore.deleteItemAsync(PIN_KEY), SecureStore.deleteItemAsync(BIO_KEY)]);
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
