import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Modal, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearTrashItems, describeTrash, getTrashList, restoreTrashItem, subscribeTrash, trashPersona, type TrashColl, type TrashItem } from "@/src/lib/trash";
import { api } from "@/src/lib/api";
import { queryClient } from "@/src/query-client";
import { formatDateShort, localDay } from "@/src/lib/format";
import { confirmAction, showNotice } from "@/src/lib/confirm";
import { usePersona } from "@/src/lib/persona";
import { forgetSent } from "@/src/lib/store";

const TRASH_COLLS: TrashColl[] = ["customers", "entries", "jobs", "aeps", "expenses", "moves"];
const isLive = (coll: TrashColl, id: string) => (queryClient.getQueryData<{ id: string }[]>([coll]) ?? []).some((r) => r.id === id);

export function RecycleBinModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [source, setSource] = useState<"phone" | "server">("phone");
  const [server, setServer] = useState<TrashItem[] | null>(null);
  const [serverError, setServerError] = useState(false);
  const [busy, setBusy] = useState("");
  const insets = useSafeAreaInsets();
  const { persona } = usePersona();

  const load = () => {
    getTrashList().then((list) => setItems(list.filter((t) => (trashPersona(t, list) ?? persona) === persona)));
  };

  // The server keeps every delete for 30 days, also from other phones and from before this phone's bin.
  const loadServer = async () => {
    setServerError(false);
    try {
      const rows = await api.listArchive();
      const mapped: TrashItem[] = rows
        .filter((r) => (TRASH_COLLS as string[]).includes(r.coll))
        .map((r) => {
          const doc = r.doc as Record<string, any>;
          const data = r.coll === "moves" ? { ...doc, from: doc.src, to: doc.dst } : doc;
          return { id: `${r.coll}:${r.id}:${r.deletedAt}`, coll: r.coll as TrashColl, title: "", subtitle: "", deletedAt: r.deletedAt, data };
        })
        // Already back (e.g. from this phone's bin) or deleted twice: show each live-less row once.
        .filter((t, i, all) => !isLive(t.coll, t.data.id) && all.findIndex((o) => o.coll === t.coll && o.data.id === t.data.id) === i);
      setServer(mapped.filter((t) => (trashPersona(t, mapped) ?? persona) === persona));
    } catch {
      setServerError(true);
    }
  };

  useEffect(() => {
    if (visible) {
      load();
      return subscribeTrash(load);
    }
  }, [visible, persona]);

  useEffect(() => {
    if (visible && source === "server") void loadServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, source, persona]);

  const handleRestore = async (id: string) => {
    const result = await restoreTrashItem(id);
    if (result === "no-customer") showNotice("पहले खाता वापस लाएं", "जिस खाते की यह एंट्री है वह हटाया जा चुका है। पहले उस खाते को वापस लाएं।");
    load();
  };

  const handleServerRestore = async (item: TrashItem) => {
    const owner = (item.data as { customerId?: string }).customerId;
    if ((item.coll === "entries" || item.coll === "jobs") && owner && !isLive("customers", owner)) {
      showNotice("पहले खाता वापस लाएं", "जिस खाते की यह एंट्री है वह हटाया जा चुका है। पहले उस खाते को वापस लाएं।");
      return;
    }
    setBusy(item.id);
    try {
      await api.restoreArchive(item.coll, item.data.id);
      forgetSent(item.coll, item.data.id);
      await Promise.all(TRASH_COLLS.map((c) => queryClient.invalidateQueries({ queryKey: [c] })));
      setServer((list) => (list ?? []).filter((t) => t.id !== item.id));
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 422) showNotice("पहले काउंटर एंट्री वापस लाएं", "यह बाकी जिस काउंटर एंट्री का है वह हटाई जा चुकी है। पहले उस काउंटर एंट्री को वापस लाएं — उसका बाकी अपने-आप आ जाएगा।");
      else showNotice("वापस नहीं आया", status === 409 ? "यह रिकॉर्ड पहले से मौजूद है।" : "इंटरनेट / सर्वर से जुड़ नहीं पाए। थोड़ी देर बाद फिर कोशिश करें।");
    } finally {
      setBusy("");
    }
  };

  const purgeServer = (list: TrashItem[], title: string, body: string) =>
    confirmAction(title, body, "हमेशा के लिए हटाएँ", async () => {
      setBusy(list.length === 1 ? list[0].id : "all");
      try {
        const keys = list.map((t) => ({ coll: t.coll, id: t.data.id }));
        for (let i = 0; i < keys.length; i += 1000) await api.purgeArchive(keys.slice(i, i + 1000));
        const gone = new Set(list.map((t) => t.id));
        setServer((rows) => (rows ?? []).filter((t) => !gone.has(t.id)));
      } catch {
        showNotice("हटा नहीं पाए", "इंटरनेट / सर्वर से जुड़ नहीं पाए। थोड़ी देर बाद फिर कोशिश करें।");
      } finally {
        setBusy("");
      }
    });

  const handleServerPurge = (item: TrashItem) =>
    purgeServer(
      [item],
      "सर्वर से हमेशा के लिए हटाएँ?",
      item.coll === "customers" ? "यह खाता और इसके साथ हटाई गई सारी एंट्री वापस नहीं आ सकेंगी।" : "यह रिकॉर्ड फिर कभी वापस नहीं आ सकेगा।",
    );

  const handleServerPurgeAll = () =>
    purgeServer(server ?? [], "सर्वर से सब हटाएँ?", `${(server ?? []).length} रिकॉर्ड हमेशा के लिए मिट जाएँगे; फिर कभी वापस नहीं आ सकेंगे।`);

  const handleClear = () =>
    confirmAction("कचरा पेटी खाली करें?", `${items.length} रिकॉर्ड हमेशा के लिए मिट जाएँगे (सर्वर से भी)।`, "खाली करें", async () => {
      const keys = items.flatMap((t) => [
        { coll: t.coll, id: String(t.data.id) },
        ...(t.group?.entries ?? []).map((e) => ({ coll: "entries", id: e.id })),
        ...(t.group?.jobs ?? []).map((j) => ({ coll: "jobs", id: j.id })),
      ]);
      await clearTrashItems(items.map((t) => t.id));
      load();
      setServer(null);
      for (let i = 0; i < keys.length; i += 1000) await api.purgeArchive(keys.slice(i, i + 1000)).catch(() => {});
    });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>कचरा पेटी</Text>
              <Text style={styles.subtitle}>
                {source === "phone" ? "हाल में हटाए गए आख़िरी 50 रिकॉर्ड (इसी फ़ोन पर)" : "पिछले 30 दिन में हटाया गया सब कुछ (किसी भी फ़ोन से); उसके बाद अपने-आप मिट जाता है"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="बंद करें" testID="trash-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.segment}>
            {(["phone", "server"] as const).map((s) => (
              <Pressable key={s} onPress={() => setSource(s)} style={[styles.segmentBtn, source === s && styles.segmentOn]} testID={`trash-source-${s}`}>
                <MaterialIcon name={s === "phone" ? "cellphone" : "cloud-outline"} size={16} color={source === s ? colors.onBrandPrimary : colors.onSurface} />
                <Text style={[styles.segmentText, source === s && { color: colors.onBrandPrimary }]}>{s === "phone" ? "इस फ़ोन पर" : "सर्वर (30 दिन)"}</Text>
              </Pressable>
            ))}
          </View>

          {source === "server" ? (
            server === null && !serverError ? (
              <View style={styles.emptyBox}><ActivityIndicator color={colors.brandPrimary} /></View>
            ) : serverError ? (
              <View style={styles.emptyBox}>
                <MaterialIcon name="cloud-off-outline" size={44} color={colors.muted} />
                <Text style={styles.emptyTitle}>सर्वर से जुड़ नहीं पाए</Text>
                <Pressable onPress={() => void loadServer()} style={[styles.restoreBtn, { marginTop: spacing.md }]} testID="trash-server-retry">
                  <Text style={styles.restoreText}>फिर कोशिश करें</Text>
                </Pressable>
              </View>
            ) : (server ?? []).length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialIcon name="cloud-check-outline" size={44} color={colors.muted} />
                <Text style={styles.emptyTitle}>सर्वर पर कुछ हटाया हुआ नहीं</Text>
              </View>
            ) : (
              <>
                <View style={styles.clearRow}>
                  <Text style={styles.countText}>{(server ?? []).length} रिकॉर्ड सर्वर पर</Text>
                  <Pressable onPress={handleServerPurgeAll} disabled={!!busy} hitSlop={10} style={styles.clearBtn} testID="trash-server-purge-all">
                    {busy === "all" ? <ActivityIndicator size="small" color={colors.error} /> : <Text style={styles.clearBtnText}>सर्वर से सब हटाएँ</Text>}
                  </Pressable>
                </View>
                <FlatList
                  data={server}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingBottom: spacing.xl + insets.bottom }}
                  renderItem={({ item }) => (
                    <TrashCard item={item} busy={busy === item.id || busy === "all"} onRestore={() => void handleServerRestore(item)} onPurge={() => handleServerPurge(item)} />
                  )}
                />
              </>
            )
          ) : (
          <>
          {items.length > 0 ? (
            <View style={styles.clearRow}>
              <Text style={styles.countText}>{items.length} रिकॉर्ड मौजूद हैं</Text>
              <Pressable onPress={handleClear} testID="trash-clear-all">
                <Text style={styles.clearBtnText}>सब साफ़ करें</Text>
              </Pressable>
            </View>
          ) : null}

          {items.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialIcon name="delete-empty-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyTitle}>कचरा पेटी खाली है</Text>
              <Text style={styles.emptySub}>कोई भी हटाया गया रिकॉर्ड यहाँ नहीं है।</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: spacing.xl + insets.bottom }}
              renderItem={({ item }) => <TrashCard item={item} onRestore={() => handleRestore(item.id)} />}
            />
          )}
          </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TrashCard({ item, busy, onRestore, onPurge }: { item: TrashItem; busy?: boolean; onRestore: () => void; onPurge?: () => void }) {
  const label = describeTrash(item);
  const collBadge =
    item.coll === "customers"
      ? { label: "खाता", color: "#1D4ED8" }
      : item.coll === "entries"
      ? { label: "हिसाब", color: "#047857" }
      : item.coll === "jobs"
      ? { label: "काम", color: "#B45309" }
      : item.coll === "expenses"
      ? { label: "खर्च", color: "#B91C1C" }
      : item.coll === "moves"
      ? { label: "जोड़े / निकाले", color: "#0E7490" }
      : { label: "काउंटर", color: "#6D28D9" };
  return (
    <View style={styles.card}>
      <View style={{ flex: 1, minWidth: 0, marginRight: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <View style={[styles.badge, { backgroundColor: collBadge.color + "18" }]}>
            <Text style={[styles.badgeText, { color: collBadge.color }]}>{collBadge.label}</Text>
          </View>
          <Text style={styles.dateText}>{formatDateShort(localDay(item.deletedAt) ?? item.deletedAt.slice(0, 10))}</Text>
        </View>
        <Text style={styles.itemTitle} numberOfLines={1}>{label.title || "रिकॉर्ड"}</Text>
        {label.subtitle ? <Text style={styles.itemSub}>{label.subtitle}</Text> : null}
      </View>
      <Pressable style={styles.restoreBtn} onPress={onRestore} disabled={busy} testID={`trash-restore-${item.id}`}>
        {busy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <MaterialIcon name="backup-restore" size={18} color={colors.brandPrimary} />}
        <Text style={styles.restoreText}>वापस लाएं</Text>
      </Pressable>
      {onPurge ? (
        <Pressable
          style={styles.purgeBtn}
          onPress={onPurge}
          disabled={busy}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="सर्वर से हमेशा के लिए हटाएँ"
          testID={`trash-purge-${item.id}`}
        >
          <MaterialIcon name="delete-forever-outline" size={20} color={colors.error} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onSurface,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  segment: { flexDirection: "row", gap: spacing.xs, padding: 4, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.brandPrimary },
  segmentText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  clearRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  countText: {
    fontSize: 12,
    color: colors.muted,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.error,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  dateText: {
    fontSize: 12,
    color: colors.muted,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.onSurface,
  },
  itemSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  purgeBtn: {
    marginLeft: spacing.sm,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  clearBtn: { minHeight: 32, justifyContent: "center" },
  restoreText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandPrimary,
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: spacing.md,
  },
  emptySub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
});
