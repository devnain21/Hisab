import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, ScrollView, Switch, ActivityIndicator } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { useCustomers, useEntries, useJobs, computeBalance } from "@/src/lib/data";
import { formatINR } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { ShopNameSheet } from "@/src/components/sheets";
import { PinSetupModal, useAppLock } from "@/src/components/app-lock";
import { biometricAvailable, disableLock, lockSupported, setBiometric, setPin } from "@/src/lib/app-lock";
import { buildBackupCsv, shareBackup } from "@/src/lib/backup";
import { usePendingCount } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [shopSheet, setShopSheet] = useState(false);
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const totalDue = computeBalance(entries);
  const pending = usePendingCount();

  const { config: lock, refresh: refreshLock } = useAppLock();
  const [pinSetup, setPinSetup] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  useEffect(() => {
    biometricAvailable().then(setHasBio).catch(() => setHasBio(false));
  }, []);

  const onPinSet = useCallback(async (pin: string) => {
    await setPin(pin);
    if (hasBio && !lock.enabled) await setBiometric(true);
    await refreshLock();
    setPinSetup(false);
  }, [hasBio, lock.enabled, refreshLock]);

  const toggleLock = (on: boolean) => {
    if (on) {
      setPinSetup(true);
      return;
    }
    confirmAction("ऐप लॉक बंद करें?", "अब ऐप बिना PIN के खुलेगा।", "बंद करें", async () => {
      await disableLock();
      await refreshLock();
    });
  };

  const toggleBio = async (on: boolean) => {
    await setBiometric(on);
    await refreshLock();
  };

  const backup = async () => {
    setBackupError(null);
    setBackingUp(true);
    try {
      await shareBackup(buildBackupCsv(customers, entries, jobs));
    } catch {
      setBackupError("बैकअप नहीं बन पाया, दोबारा कोशिश करें।");
    } finally {
      setBackingUp(false);
    }
  };

  const handleSignOut = () => {
    if (pending > 0) {
      confirmAction(
        "कुछ बदलाव अभी सर्वर पर नहीं गए",
        `${pending} बदलाव सिंक होने बाकी हैं। अभी साइन आउट करेंगे तो ये मिट जाएँगे। पहले इंटरनेट चालू करके थोड़ा रुकें।`,
        "फिर भी साइन आउट",
        () => void signOut(),
      );
      return;
    }
    void signOut();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
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

      <Pressable style={styles.row} onPress={() => setShopSheet(true)} testID="profile-shop-name">
        <MaterialIcon name="storefront-outline" size={22} color={colors.brandPrimary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowLabel}>दुकान का नाम</Text>
          <Text style={[styles.rowValue, !user?.shop_name && { color: colors.muted }]} numberOfLines={1}>{user?.shop_name || "अभी सेट नहीं है"}</Text>
        </View>
        <MaterialIcon name="pencil-outline" size={18} color={colors.muted} />
      </Pressable>

      {pending > 0 ? (
        <View style={[styles.syncCard, { backgroundColor: colors.errorSoft }]} testID="sync-pending">
          <MaterialIcon name="cloud-upload-outline" size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.syncTitle, { color: colors.warning }]}>{pending} बदलाव सिंक होने बाकी</Text>
            <Text style={styles.syncSub}>फ़ोन में सेव हैं, इंटरनेट मिलते ही अपने आप सर्वर पर चले जाएँगे</Text>
          </View>
        </View>
      ) : (
        <View style={styles.syncCard}>
          <MaterialIcon name="cloud-check-outline" size={20} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.syncTitle}>सब कुछ सिंक है</Text>
            <Text style={styles.syncSub}>डेटा Google खाते के साथ सुरक्षित है, बिना इंटरनेट भी ऐप चलेगा</Text>
          </View>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
        <StatBox label="ग्राहक" value={String(customers.length)} />
        <StatBox label="एंट्री" value={String(entries.length)} />
        <StatBox label="पेंडिंग काम" value={String(jobs.filter((j) => j.status !== "done").length)} />
      </View>
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>कुल बकाया</Text>
        <Text style={styles.totalValue}>{formatINR(Math.max(totalDue, 0))}</Text>
      </View>

      <Text style={styles.sectionHead}>सुरक्षा और बैकअप</Text>
      <View style={styles.card}>
        {lockSupported && (
          <>
            <View style={styles.settingRow}>
              <MaterialIcon name="lock-outline" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowValue}>ऐप लॉक (PIN)</Text>
                <Text style={styles.rowLabel}>खोलते समय PIN या फिंगरप्रिंट माँगे</Text>
              </View>
              <Switch value={lock.enabled} onValueChange={toggleLock} trackColor={{ true: colors.brandPrimary }} testID="toggle-lock" />
            </View>
            {lock.enabled && hasBio && (
              <View style={[styles.settingRow, styles.rowBorder]}>
                <MaterialIcon name="fingerprint" size={22} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>फिंगरप्रिंट से खोलें</Text>
                </View>
                <Switch value={lock.biometric} onValueChange={toggleBio} trackColor={{ true: colors.brandPrimary }} testID="toggle-bio" />
              </View>
            )}
            {lock.enabled && (
              <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setPinSetup(true)} testID="change-pin">
                <MaterialIcon name="form-textbox-password" size={22} color={colors.brandPrimary} />
                <Text style={[styles.rowValue, { flex: 1 }]}>PIN बदलें</Text>
                <MaterialIcon name="chevron-right" size={22} color={colors.muted} />
              </Pressable>
            )}
          </>
        )}
        <Pressable style={[styles.settingRow, lockSupported && styles.rowBorder]} onPress={backup} disabled={backingUp} testID="backup-btn">
          <MaterialIcon name="file-excel-outline" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>बैकअप डाउनलोड करें (Excel)</Text>
            <Text style={styles.rowLabel}>पूरा खाता, ग्राहक और काम एक फ़ाइल में</Text>
          </View>
          {backingUp ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialIcon name="download" size={22} color={colors.muted} />}
        </Pressable>
      </View>
      {backupError ? <Text style={styles.errorText}>{backupError}</Text> : null}

      <Pressable style={styles.logoutBtn} onPress={handleSignOut} testID="logout-btn">
        <MaterialIcon name="logout" size={20} color={colors.error} />
        <Text style={styles.logoutText}>साइन आउट</Text>
      </Pressable>

      <Text style={styles.footer}>{user?.shop_name ? `${user.shop_name} — ` : ""}बही खाता · v1.0</Text>
      <ShopNameSheet visible={shopSheet} onClose={() => setShopSheet(false)} />
      <PinSetupModal visible={pinSetup} onClose={() => setPinSetup(false)} onDone={onPinSet} />
    </ScrollView>
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowValue: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  syncCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, backgroundColor: colors.successSoft, borderRadius: radius.md, marginTop: spacing.md },
  syncTitle: { fontSize: 13, fontWeight: "700", color: colors.success },
  syncSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  totalBox: { marginTop: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  totalLabel: { fontSize: 12, color: colors.muted, fontWeight: "600", textTransform: "uppercase" },
  totalValue: { fontSize: 26, fontWeight: "700", color: colors.error, marginTop: spacing.xs },
  sectionHead: { fontSize: 17, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.border },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: "700" },
  footer: { textAlign: "center", color: colors.muted, fontSize: 11, marginTop: spacing.xl },
});
