import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, useEntries, useJobs, computeBalance } from "@/src/lib/data";
import { formatINR } from "@/src/lib/format";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const customersQ = useCustomers();
  const entriesQ = useEntries();
  const jobsQ = useJobs();
  const customers = customersQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const jobs = jobsQ.data ?? [];
  const totalDue = computeBalance(entries);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg }}>
      <Text style={styles.h1}>खाता</Text>

      <View style={styles.userCard}>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }]}>
            <MaterialIcon name="account" size={32} color={colors.onBrandTertiary} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{user?.name || "User"}</Text>
          <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
        </View>
      </View>

      <View style={styles.syncCard}>
        <MaterialIcon name="cloud-check-outline" size={20} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={styles.syncTitle}>ऑनलाइन सिंक चालू</Text>
          <Text style={styles.syncSub}>डेटा Google खाते के साथ सुरक्षित है</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
        <StatBox label="ग्राहक" value={String(customers.length)} />
        <StatBox label="एंट्री" value={String(entries.length)} />
        <StatBox label="पेंडिंग काम" value={String(jobs.filter((j) => j.status !== "done").length)} />
      </View>
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>कुल बकाया</Text>
        <Text style={styles.totalValue}>{formatINR(Math.max(totalDue, 0))}</Text>
      </View>

      <Pressable style={styles.logoutBtn} onPress={signOut} testID="logout-btn">
        <MaterialIcon name="logout" size={20} color={colors.error} />
        <Text style={styles.logoutText}>साइन आउट</Text>
      </Pressable>

      <Text style={styles.footer}>Nain Photo State — हिसाब · v1.0</Text>
    </View>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.lg },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  name: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  email: { fontSize: 13, color: colors.muted, marginTop: 2 },
  syncCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, backgroundColor: colors.successSoft, borderRadius: radius.md, marginTop: spacing.md },
  syncTitle: { fontSize: 13, fontWeight: "700", color: colors.success },
  syncSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  totalBox: { marginTop: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  totalValue: { fontSize: 26, fontWeight: "700", color: colors.error, marginTop: spacing.xs },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.border },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: "700" },
  footer: { textAlign: "center", color: colors.muted, fontSize: 11, marginTop: spacing.xl },
});
