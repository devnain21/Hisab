import { Platform, Share } from "react-native";

/** Opens the phone share sheet. WhatsApp is one of the apps there; nothing launches it on its own. */
export async function shareMessage(message: string): Promise<"shared" | "copied"> {
  if (Platform.OS === "web") {
    const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ text: message });
        return "shared";
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "shared";
    }
    await navigator.clipboard.writeText(message);
    return "copied";
  }
  await Share.share({ message });
  return "shared";
}
