import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Linking } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, semantic, type } from "@/src/theme";
import { entryDelta, isVendor, useCustomers, useEntries, type Customer } from "@/src/lib/data";
import { cleanAmountInput, formatINR, formatPhone, parseAmount, roundMoney } from "@/src/lib/format";
import { reminderDoc } from "@/src/lib/receipt";
import { useAuth } from "@/src/context/AuthContext";
import { usePersona } from "@/src/lib/persona";
import { Pressable } from "@/src/components/tap";
import { Amount, Button, EmptyState, ScreenHeader } from "@/src/components/ui";

const phone10 = (p: string) => p.replace(/\D/g, "").slice(-10);

/** Sends the payment reminder to many customers, one WhatsApp chat at a time with each one's own amount. */
export default function BulkRemindScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isPersonal } = usePersona();
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const [min, setMin] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const owing = useMemo(() => {
    const due = new Map<string, number>();
    for (const e of entries) due.set(e.customerId, (due.get(e.customerId) ?? 0) + entryDelta(e));
    return customers
      .filter((c) => (isPersonal ? c.persona === "personal" : c.persona !== "personal" && !isVendor(c)))
      .map((c) => ({ c, due: roundMoney(due.get(c.id) ?? 0) }))
      .filter((r) => r.due > 0)
      .sort((a, b) => b.due - a.due);
  }, [customers, entries, isPersonal]);

  const minNum = parseAmount(min) || 0;
  const rows = owing.filter((r) => r.due >= minNum);
  const reachable = rows.filter((r) => phone10(r.c.phone || "").length === 10);
  // Everyone reachable is ticked until the list is touched.
  const selected = picked ?? new Set(reachable.map((r) => r.c.id));
  const chosen = reachable.filter((r) => selected.has(r.c.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const allOn = chosen.length === reachable.length && reachable.length > 0;

  const send = (c: Customer, due: number) => {
    const msg = reminderDoc(c, due, user ?? {}, entries).message;
    void Linking.openURL(`https://wa.me/91${phone10(c.phone)}?text=${encodeURIComponent(msg)}`).catch(() => {});
    setSent((s) => new Set(s).add(c.id));
  };

  if (queue) {
    const done = at >= queue.length;
    const row = done ? null : owing.find((r) => r.c.id === queue[at]);
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <ScreenHeader title="तगादा भेजें" subtitle={`${Math.min(at + 1, queue.length)} / ${queue.length}`} onBack={() => setQueue(null)} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((Math.min(at, queue.length) / queue.length) * 100)}%` }]} />
          </View>
          {done || !row ? (
            <EmptyState
              icon="check-all"
              title="सबको भेज दिया"
              message={`${sent.size} लोगों को WhatsApp खुला`}
              action={{ label: "वापस सूची पर", onPress: () => setQueue(null), testID: "bulk-done" }}
            />
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardName}>{row.c.name}</Text>
                <Text style={styles.cardSub}>{formatPhone(row.c.phone)}</Text>
                <Amount value={row.due} tone="due" size="display" style={{ marginTop: spacing.sm }} revealed />
                {sent.has(row.c.id) ? <Text style={[styles.cardSub, { color: semantic.received }]}>WhatsApp खुल चुका</Text> : null}
              </View>
              <Button
                label="WhatsApp पर भेजें"
                icon="whatsapp"
                onPress={() => {
                  send(row.c, row.due);
                  setAt((i) => i + 1);
                }}
                style={{ backgroundColor: semantic.whatsapp }}
                testID="bulk-send"
              />
              <Button label="इसे छोड़ें" variant="ghost" onPress={() => setAt((i) => i + 1)} testID="bulk-skip" />
              <Text style={styles.hint}>भेज कर ऐप पर वापस आएँ — अगला नाम तैयार मिलेगा</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScreenHeader title="सबको तगादा" subtitle="WhatsApp पर एक-एक करके, सही रकम के साथ" />
      <View style={styles.filter}>
        <Text style={styles.filterLabel}>इससे ज़्यादा बाकी</Text>
        <View style={styles.minWrap}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.minInput}
            value={min}
            onChangeText={(v) => { setMin(cleanAmountInput(v)); setPicked(null); }}
            placeholder="0"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
            testID="bulk-min"
          />
        </View>
      </View>
      {reachable.length > 0 ? (
        <Pressable style={styles.allRow} onPress={() => setPicked(allOn ? new Set() : new Set(reachable.map((r) => r.c.id)))} testID="bulk-all">
          <MaterialIcon name={allOn ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.brandPrimary} />
          <Text style={styles.allText}>सभी चुनें ({reachable.length})</Text>
          <Text style={styles.allSum}>{formatINR(chosen.reduce((s, r) => s + r.due, 0))}</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.c.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 + insets.bottom }}
        ListEmptyComponent={<EmptyState icon="account-check-outline" title={owing.length ? "इतनी रकम से ज़्यादा किसी पर बाकी नहीं" : "किसी पर कुछ बाकी नहीं"} />}
        renderItem={({ item: r }) => {
          const ok = phone10(r.c.phone || "").length === 10;
          const on = ok && selected.has(r.c.id);
          return (
            <Pressable style={[styles.row, !ok && { opacity: 0.5 }]} onPress={() => ok && toggle(r.c.id)} disabled={!ok} testID={`bulk-row-${r.c.id}`}>
              <MaterialIcon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={ok ? colors.brandPrimary : colors.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{r.c.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{ok ? formatPhone(r.c.phone) : "फ़ोन नंबर नहीं"}{sent.has(r.c.id) ? " · भेजा" : ""}</Text>
              </View>
              <Amount value={r.due} tone="due" size="bodyLg" revealed />
            </Pressable>
          );
        }}
      />
      <View style={[styles.bar, { paddingBottom: spacing.sm + insets.bottom }]}>
        <Button
          label={chosen.length ? `${chosen.length} लोगों को भेजना शुरू करें` : "किसी को चुनें"}
          icon="whatsapp"
          disabled={!chosen.length}
          onPress={() => { setQueue(chosen.map((r) => r.c.id)); setAt(0); }}
          style={{ flex: 1 }}
          testID="bulk-start"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filter: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  filterLabel: { flex: 1, ...type.body, fontWeight: "700", color: colors.onSurface },
  minWrap: { flexDirection: "row", alignItems: "center", width: 140, height: 44, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandPrimary },
  rupee: { fontSize: 16, fontWeight: "700", color: colors.muted },
  minInput: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onSurface, textAlign: "right" },
  allRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  allText: { flex: 1, ...type.body, fontWeight: "700", color: colors.onSurface },
  allSum: { ...type.body, fontWeight: "800", color: semantic.due },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { ...type.body, fontWeight: "700", color: colors.onSurface },
  sub: { ...type.caption, color: colors.muted },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: semantic.whatsapp },
  card: { alignItems: "center", padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  cardName: { ...type.title, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  cardSub: { ...type.caption, color: colors.muted, marginTop: 2 },
  hint: { ...type.caption, color: colors.muted, textAlign: "center" },
});
