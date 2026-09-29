import { useEffect, useState } from "react";
import { Text } from "react-native";
import { colors, spacing } from "@/src/theme";

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
