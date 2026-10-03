import { useMemo } from "react";
import { View } from "react-native";
import { qrRows } from "@/src/lib/qr";

export function QrCode({ value, size }: { value: string; size: number }) {
  const qr = useMemo(() => qrRows(value), [value]);
  const cell = size / qr.size;
  return (
    <View style={{ width: size, height: size, backgroundColor: "#fff" }}>
      {qr.rows.map((runs, r) =>
        runs.map(([c, len]) => (
          <View key={`${r}-${c}`} style={{ position: "absolute", left: c * cell, top: r * cell, width: len * cell + 0.5, height: cell + 0.5, backgroundColor: "#000" }} />
        )),
      )}
    </View>
  );
}
