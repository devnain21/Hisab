import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Modal } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { clearAllTrash, getTrashList, restoreTrashItem, subscribeTrash, type TrashItem } from "@/src/lib/trash";
import { formatDateShort } from "@/src/lib/format";
import { confirmAction, showNotice } from "@/src/lib/confirm";

export function RecycleBinModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);

  const load = () => {
    getTrashList().then(setItems);
  };

  useEffect(() => {
    if (visible) {
      load();
      return subscribeTrash(load);
    }
  }, [visible]);

  const handleRestore = async (id: string) => {
    const result = await restoreTrashItem(id);
    if (result === "no-customer") showNotice("पहले खाता वापस लाएं", "जिस खाते की यह एंट्री है वह हटाया जा चुका है। पहले उस खाते को वापस लाएं।");
    load();
  };

  const handleClear = () =>
    confirmAction("कचरा पेटी खाली करें?", `${items.length} रिकॉर्ड हमेशा के लिए मिट जाएँगे।`, "खाली करें", async () => {
      await clearAllTrash();
      load();
    });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>🗑️ कचरा पेटी (Recycle Bin)</Text>
              <Text style={styles.subtitle}>हाल में हटाए गए आख़िरी 50 रिकॉर्ड (इसी फ़ोन पर)</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="trash-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

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
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              renderItem={({ item }) => {
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
                    ? { label: "गल्ला / बैंक", color: "#0E7490" }
                    : { label: "काउंटर", color: "#6D28D9" };

                return (
                  <View style={styles.card}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <View style={[styles.badge, { backgroundColor: collBadge.color + "18" }]}>
                          <Text style={[styles.badgeText, { color: collBadge.color }]}>{collBadge.label}</Text>
                        </View>
                        <Text style={styles.dateText}>{formatDateShort(item.deletedAt.slice(0, 10))}</Text>
                      </View>
                      <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                      {item.subtitle ? <Text style={styles.itemSub}>{item.subtitle}</Text> : null}
                    </View>

                    <Pressable
                      style={styles.restoreBtn}
                      onPress={() => handleRestore(item.id)}
                      testID={`trash-restore-${item.id}`}
                    >
                      <MaterialIcon name="backup-restore" size={18} color={colors.brandPrimary} />
                      <Text style={styles.restoreText}>वापस लाएं</Text>
                    </Pressable>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
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
    fontSize: 10,
    fontWeight: "700",
  },
  dateText: {
    fontSize: 10,
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
