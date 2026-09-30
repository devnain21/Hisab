import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { colors, spacing, radius } from "@/src/theme";
import { Pressable } from "@/src/components/tap";

export function SlowServerHint({ afterMs = 5000 }: { afterMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(t);
  }, [afterMs]);
  if (!show) return null;
  return (
    <Text style={{ marginTop: spacing.md, color: colors.muted, fontSize: 13, textAlign: "center", paddingHorizontal: spacing.xl }}>
      सर्वर चालू हो रहा है, पहली बार में 30–60 सेकंड लग सकते हैं…
    </Text>
  );
}

/** A failed fetch must not look like an empty khata. */
export function DataLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ marginTop: spacing.xl, alignItems: "center", padding: spacing.lg }}>
      <Text style={{ color: colors.onSurface, fontSize: 16, fontWeight: "700", textAlign: "center" }}>हिसाब नहीं खुल पाया</Text>
      <Text style={{ marginTop: spacing.sm, color: colors.muted, fontSize: 13, textAlign: "center" }}>
        डेटा मिटा नहीं है। सर्वर जवाब नहीं दे रहा, पहली बार में आधा मिनट लग सकता है।
      </Text>
      <Pressable onPress={onRetry} style={{ marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md }}>
        <Text style={{ color: colors.onBrandPrimary, fontWeight: "700" }}>दोबारा कोशिश करें</Text>
      </Pressable>
    </View>
  );
}
