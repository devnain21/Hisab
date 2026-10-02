import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  Switch,
  ActivityIndicator,
  Modal,
  Platform,
  Share,
} from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { useAeps, useCustomers, useEntries, useJobs, computeBalance } from "@/src/lib/data";
import { formatINR, todayISO, formatPhone } from "@/src/lib/format";
import { Pressable } from "@/src/components/tap";
import { ShopProfileSheet } from "@/src/components/sheets";
import { PinSetupModal, useAppLock } from "@/src/components/app-lock";
import { biometricAvailable, disableLock, lockSupported, setBiometric, setPin } from "@/src/lib/app-lock";
import { exportFullLedgerCsv } from "@/src/lib/export-data";
import { usePendingCount } from "@/src/lib/store";
import { confirmAction } from "@/src/lib/confirm";
import { useCounterMode } from "@/src/lib/counter";
import { usePersona } from "@/src/lib/persona";
import { RecycleBinModal } from "@/src/components/recycle-bin-sheet";
import { getTrashList, subscribeTrash } from "@/src/lib/trash";
import { shareMessage } from "@/src/lib/share-text";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { persona, isPersonal, setPersona, labels } = usePersona();

  // Modals & Sheets
  const [shopSheet, setShopSheet] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Data queries
  const customers = useCustomers().data ?? [];
  const entries = useEntries().data ?? [];
  const jobs = useJobs().data ?? [];
  const aeps = useAeps().data ?? [];
  const totalDue = computeBalance(entries);
  const pending = usePendingCount();
  const counter = useCounterMode();

  // App Lock
  const { config: lock, refresh: refreshLock } = useAppLock();
  const [pinSetup, setPinSetup] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Check biometric capability
  useEffect(() => {
    biometricAvailable().then(setHasBio).catch(() => setHasBio(false));
  }, []);

  // Monitor trash count
  useEffect(() => {
    const updateTrash = () => {
      getTrashList().then((list) => setTrashCount(list.length)).catch(() => {});
    };
    updateTrash();
    return subscribeTrash(updateTrash);
  }, []);

  // Financial health calculations
  const thisMonthPrefix = todayISO().slice(0, 7);
  const monthPayments = useMemo(() => {
    return entries
      .filter((e) => e.date.startsWith(thisMonthPrefix) && (e.type === "payment" || (e.paid ?? 0) > 0))
      .reduce((sum, e) => sum + (e.type === "payment" ? e.amount : (e.paid ?? 0)), 0);
  }, [entries, thisMonthPrefix]);

  const recoveryRate = useMemo(() => {
    const total = monthPayments + Math.max(totalDue, 0);
    if (total <= 0) return 100;
    return Math.min(100, Math.round((monthPayments / total) * 100));
  }, [monthPayments, totalDue]);

  // Persona toggle with haptics
  const handleSwitchPersona = (target: "business" | "personal") => {
    if (target === persona) return;
    try {
      Haptics.selectionAsync();
    } catch {}
    setPersona(target);
  };

  // Copy UPI
  const handleCopyUpi = async (upiId: string) => {
    if (!upiId) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(upiId);
      } else {
        await Share.share({ message: upiId });
      }
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    } catch {}
  };

  // Share digital visiting card
  const handleShareVisitingCard = async () => {
    const shopName = user?.shop_name || "मेरी दुकान";
    const ownerName = user?.name ? `\n👤 प्रोपराइटर: ${user.name}` : "";
    const phone = user?.shop_phone ? `\n📞 फ़ोन / संपर्क: ${formatPhone(user.shop_phone)}` : "";
    const addr = user?.shop_address ? `\n📍 पता: ${user.shop_address}` : "";
    const gst = user?.shop_gst ? `\n🏛️ GSTIN: ${user.shop_gst}` : "";
    const upi = user?.shop_upi ? `\n💳 UPI भुगतान ID: ${user.shop_upi}` : "";

    const cardMessage = `🏪 *${shopName}*${ownerName}${phone}${addr}${gst}${upi}\n\n🙏 हमारे साथ व्यापार करने के लिए धन्यवाद!\n✨ बही खाता ऐप द्वारा सुरक्षित।`;
    await shareMessage(cardMessage);
  };

  // Force sync
  const handleForceSync = async () => {
    setSyncing(true);
    try {
      await queryClient.refetchQueries();
    } catch {}
    setTimeout(() => setSyncing(false), 600);
  };

  const onPinSet = useCallback(
    async (pin: string) => {
      await setPin(pin);
      if (hasBio && !lock.enabled) await setBiometric(true);
      await refreshLock();
      setPinSetup(false);
    },
    [hasBio, lock.enabled, refreshLock]
  );

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
      await exportFullLedgerCsv({
        customers,
        entries,
        jobs,
        aeps,
        shop: user,
      });
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
        () => void signOut()
      );
      return;
    }
    void signOut();
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.md,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
    >
      {/* Header title */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.eyebrow}>प्रोफ़ाइल व सेटिंग्स</Text>
          <Text style={styles.h1}>खाता व व्यापार</Text>
        </View>
        <Pressable
          style={styles.syncIconButton}
          onPress={handleForceSync}
          disabled={syncing}
          testID="profile-force-sync"
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <MaterialIcon name="sync" size={22} color={colors.brandPrimary} />
          )}
        </Pressable>
      </View>

      {/* IMPROVEMENT 1: Executive Digital Visiting Card */}
      <LinearGradient
        colors={["#0F172A", "#1E293B", "#334155"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardContainer}
      >
        {/* Card Top Row */}
        <View style={styles.cardTopRow}>
          <View style={styles.merchantBadge}>
            <MaterialIcon
              name={isPersonal ? "account-check" : "shield-check"}
              size={13}
              color="#FCD34D"
            />
            <Text style={styles.merchantBadgeText}>
              {isPersonal ? "सत्यापित खाता" : "प्रमाणित व्यापारी"}
            </Text>
          </View>
          <Pressable
            style={styles.editCardBtn}
            onPress={() => setShopSheet(true)}
            testID="profile-edit-visiting-card"
          >
            <MaterialIcon name="pencil" size={14} color="#CBD5E1" />
            <Text style={styles.editCardBtnText}>बदलें</Text>
          </Pressable>
        </View>

        {/* Card Body */}
        <View style={styles.cardMain}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardShopName} numberOfLines={1}>
              {user?.shop_name || (isPersonal ? user?.name : "दुकान का नाम जोड़ें")}
            </Text>
            <Text style={styles.cardOwnerName} numberOfLines={1}>
              {user?.name ? `प्रोपराइटर: ${user.name}` : user?.email}
            </Text>

            {/* Phone & Address */}
            <View style={styles.cardDetailRow}>
              <MaterialIcon name="phone-outline" size={13} color="#94A3B8" />
              <Text style={styles.cardDetailText} numberOfLines={1}>
                {user?.shop_phone ? formatPhone(user.shop_phone) : "फ़ोन नंबर जोड़ें"}
              </Text>
            </View>

            {user?.shop_address ? (
              <View style={styles.cardDetailRow}>
                <MaterialIcon name="map-marker-outline" size={13} color="#94A3B8" />
                <Text style={styles.cardDetailText} numberOfLines={1}>
                  {user.shop_address}
                </Text>
              </View>
            ) : null}

            {user?.shop_gst ? (
              <View style={styles.cardDetailRow}>
                <MaterialIcon name="card-account-details-outline" size={13} color="#94A3B8" />
                <Text style={styles.cardDetailText} numberOfLines={1}>
                  GSTIN: {user.shop_gst}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Avatar / Picture */}
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.cardAvatar} />
          ) : (
            <View style={styles.cardAvatarFallback}>
              <Text style={styles.cardAvatarInitials}>
                {(user?.shop_name || user?.name || "B")[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* Quick UPI Pill */}
        {user?.shop_upi ? (
          <View style={styles.upiPill}>
            <View style={styles.upiPillLeft}>
              <MaterialIcon name="qrcode-scan" size={15} color="#38BDF8" />
              <Text style={styles.upiPillText} numberOfLines={1}>
                UPI: <Text style={styles.upiPillBold}>{user.shop_upi}</Text>
              </Text>
            </View>
            <Pressable
              style={styles.upiCopyBtn}
              onPress={() => handleCopyUpi(user.shop_upi || "")}
              testID="copy-upi-btn"
            >
              <Text style={styles.upiCopyText}>{copiedUpi ? "कॉपी हुआ ✓" : "कॉपी"}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Card Footer Actions */}
        <View style={styles.cardActionsRow}>
          <Pressable
            style={styles.cardPrimaryBtn}
            onPress={handleShareVisitingCard}
            testID="share-card-btn"
          >
            <MaterialIcon name="share-variant-outline" size={15} color="#0F172A" />
            <Text style={styles.cardPrimaryBtnText}>कार्ड शेयर करें</Text>
          </Pressable>

          <Pressable
            style={styles.cardSecondaryBtn}
            onPress={() => setQrModalOpen(true)}
            testID="view-qr-btn"
          >
            <MaterialIcon name="qrcode" size={15} color="#F8FAFC" />
            <Text style={styles.cardSecondaryBtnText}>पेमेंट QR कोड</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {/* IMPROVEMENT 2: Instant Dual Persona Switcher */}
      <View style={styles.personaContainer}>
        <Text style={styles.sectionMiniLabel}>खाता मोड (PERSONA MODE)</Text>
        <View style={styles.personaSwitchRow}>
          <Pressable
            style={[styles.personaSegment, !isPersonal && styles.personaSegmentActive]}
            onPress={() => handleSwitchPersona("business")}
            testID="persona-business-btn"
          >
            <MaterialIcon
              name="storefront"
              size={17}
              color={!isPersonal ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.personaText, !isPersonal && styles.personaTextActive]}>
              दुकान / व्यापार
            </Text>
          </Pressable>

          <Pressable
            style={[styles.personaSegment, isPersonal && styles.personaSegmentActive]}
            onPress={() => handleSwitchPersona("personal")}
            testID="persona-personal-btn"
          >
            <MaterialIcon
              name="account-tie"
              size={17}
              color={isPersonal ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.personaText, isPersonal && styles.personaTextActive]}>
              व्यक्तिगत खाता
            </Text>
          </Pressable>
        </View>

        <Text style={styles.personaHelper}>
          {isPersonal
            ? "💡 व्यक्तिगत मोड सक्रिय: दोस्तों और रिश्तेदारों का निजी लेन-देन, सरल हिसाब।"
            : "💡 व्यापार मोड सक्रिय: ग्राहकों का उधारी बही खाता, बिलिंग, डिलीवरी तारीखें व काउंटर चालू।"}
        </Text>
      </View>

      {/* IMPROVEMENT 3: Business & Ledger Health Analytics */}
      <View style={styles.analyticsSection}>
        <View style={styles.analyticsHeader}>
          <Text style={styles.sectionHead}>
            {isPersonal ? "व्यक्तिगत वित्तीय स्थिति" : "व्यापार स्वास्थ्य व वसूली रिपोर्ट"}
          </Text>
          <View
            style={[
              styles.healthChip,
              recoveryRate >= 75
                ? styles.healthChipGood
                : recoveryRate >= 50
                ? styles.healthChipAvg
                : styles.healthChipLow,
            ]}
          >
            <Text
              style={[
                styles.healthChipText,
                recoveryRate >= 75
                  ? styles.healthTextGood
                  : recoveryRate >= 50
                  ? styles.healthTextAvg
                  : styles.healthTextLow,
              ]}
            >
              {recoveryRate >= 75 ? "उत्कृष्ट" : recoveryRate >= 50 ? "सामान्य" : "ध्यान दें"}
            </Text>
          </View>
        </View>

        <View style={styles.analyticsGrid}>
          <View style={styles.analyticsCard}>
            <View style={styles.analyticsCardTop}>
              <Text style={styles.analyticsLabel}>सक्रिय खाते</Text>
              <MaterialIcon name="account-group-outline" size={17} color={colors.brandPrimary} />
            </View>
            <Text style={styles.analyticsVal}>{customers.length}</Text>
            <Text style={styles.analyticsSub}>कुल दर्ज लोग</Text>
          </View>

          <View style={styles.analyticsCard}>
            <View style={styles.analyticsCardTop}>
              <Text style={styles.analyticsLabel}>बाज़ार में उधारी</Text>
              <MaterialIcon name="cash-remove" size={17} color={colors.error} />
            </View>
            <Text style={[styles.analyticsVal, { color: colors.error }]}>
              {formatINR(Math.max(totalDue, 0))}
            </Text>
            <Text style={styles.analyticsSub}>लेने बाकी हैं</Text>
          </View>

          <View style={styles.analyticsCard}>
            <View style={styles.analyticsCardTop}>
              <Text style={styles.analyticsLabel}>इस माह वसूली</Text>
              <MaterialIcon name="cash-check" size={17} color={colors.success} />
            </View>
            <Text style={[styles.analyticsVal, { color: colors.success }]}>
              {formatINR(monthPayments)}
            </Text>
            <Text style={styles.analyticsSub}>चालू कैलेंडर माह</Text>
          </View>

          <View style={styles.analyticsCard}>
            <View style={styles.analyticsCardTop}>
              <Text style={styles.analyticsLabel}>वसूली दर</Text>
              <MaterialIcon name="chart-pie" size={17} color={colors.brandSecondary} />
            </View>
            <Text style={[styles.analyticsVal, { color: colors.brandSecondary }]}>
              {recoveryRate}%
            </Text>
            <Text style={styles.analyticsSub}>रिकवरी प्रतिशत</Text>
          </View>
        </View>

        {/* Recovery Progress Bar */}
        <View style={styles.progressBarWrapper}>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${recoveryRate}%` }]} />
          </View>
          <View style={styles.progressTextRow}>
            <Text style={styles.progressSubText}>बाज़ार से रिकवरी: {recoveryRate}%</Text>
            <Text style={styles.progressSubText}>
              शेष उधारी: {formatINR(Math.max(totalDue, 0))}
            </Text>
          </View>
        </View>
      </View>

      {/* IMPROVEMENT 5 (Top): Real-time Cloud Sync Card */}
      {pending > 0 ? (
        <View style={[styles.syncCard, { backgroundColor: colors.errorSoft }]} testID="sync-pending">
          <MaterialIcon name="cloud-upload-outline" size={22} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.syncTitle, { color: colors.warning }]}>
              {pending} बदलाव सिंक होने बाकी
            </Text>
            <Text style={styles.syncSub}>
              फ़ोन में सुरक्षित रूप से सेव हैं, इंटरनेट मिलते ही अपने आप सर्वर पर चले जाएँगे
            </Text>
          </View>
          <Pressable style={styles.syncBtnSmall} onPress={handleForceSync} disabled={syncing}>
            <Text style={styles.syncBtnSmallText}>सिंक करें</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.syncCard}>
          <MaterialIcon name="cloud-check-outline" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.syncTitle}>Google क्लाउड बैकअप सुरक्षित है</Text>
            <Text style={styles.syncSub}>
              सारा डेटा रीयल-टाइम सुरक्षित है। बिना इंटरनेट भी ऐप बिना रुके चलेगा।
            </Text>
          </View>
          <MaterialIcon name="check-circle" size={18} color={colors.success} />
        </View>
      )}

      {/* IMPROVEMENT 4: Grouped Professional Settings */}
      {/* Category 1: दुकान व बिलिंग सेटिंग्स */}
      <Text style={styles.groupHead}>दुकान व बिलिंग सेटिंग्स</Text>
      <View style={styles.card}>
        <Pressable
          style={styles.settingRow}
          onPress={() => setShopSheet(true)}
          testID="profile-shop-settings"
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.brandTertiary }]}>
            <MaterialIcon name="storefront-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>{labels.profileHeading}</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {user?.shop_name
                ? `${user.shop_name} · ${user.shop_phone || "फ़ोन"}`
                : "नाम, फ़ोन, पता व बिल फुटर सेट करें"}
            </Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <Pressable
          style={[styles.settingRow, styles.rowBorder]}
          onPress={() => setQrModalOpen(true)}
          testID="profile-qr-settings"
        >
          <View style={[styles.iconCircle, { backgroundColor: "#EFF6FF" }]}>
            <MaterialIcon name="qrcode" size={20} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>दुकान का पेमेंट QR कोड</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {user?.shop_upi ? `UPI: ${user.shop_upi}` : "ग्राहक से पेमेंट लेने के लिए QR कोड देखें"}
            </Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        {!isPersonal ? (
          <View style={[styles.settingRow, styles.rowBorder]}>
            <View style={[styles.iconCircle, { backgroundColor: "#FDF4FF" }]}>
              <MaterialIcon name="fingerprint" size={20} color="#9333EA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue}>काउंटर सेवा (AEPS / नकद / UPI)</Text>
              <Text style={styles.rowLabel} numberOfLines={1}>
                आधार निकासी, मनी ट्रांसफर व काउंटर गल्ला ट्रैकिंग
              </Text>
            </View>
            <Switch
              value={counter.on}
              onValueChange={counter.toggle}
              trackColor={{ true: colors.brandPrimary, false: colors.border }}
              testID="counter-toggle"
            />
          </View>
        ) : null}
      </View>

      {/* Category 2: सुरक्षा व गोपनीयता */}
      <Text style={styles.groupHead}>सुरक्षा व गोपनीयता</Text>
      <View style={styles.card}>
        {lockSupported && (
          <>
            <View style={styles.settingRow}>
              <View style={[styles.iconCircle, { backgroundColor: "#FEF2F2" }]}>
                <MaterialIcon name="shield-lock-outline" size={20} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowValue}>ऐप लॉक (PIN)</Text>
                <Text style={styles.rowLabel}>ऐप खोलते समय 4-अंकों का PIN माँगे</Text>
              </View>
              <Switch
                value={lock.enabled}
                onValueChange={toggleLock}
                trackColor={{ true: colors.brandPrimary }}
                testID="toggle-lock"
              />
            </View>

            {lock.enabled && hasBio && (
              <View style={[styles.settingRow, styles.rowBorder]}>
                <View style={[styles.iconCircle, { backgroundColor: "#F0FDF4" }]}>
                  <MaterialIcon name="fingerprint" size={20} color={colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>बायोमेट्रिक / फिंगरप्रिंट</Text>
                  <Text style={styles.rowLabel}>उंगली लगाकर तुरंत ऐप अनलॉक करें</Text>
                </View>
                <Switch
                  value={lock.biometric}
                  onValueChange={toggleBio}
                  trackColor={{ true: colors.brandPrimary }}
                  testID="toggle-bio"
                />
              </View>
            )}

            {lock.enabled && (
              <Pressable
                style={[styles.settingRow, styles.rowBorder]}
                onPress={() => setPinSetup(true)}
                testID="change-pin"
              >
                <View style={[styles.iconCircle, { backgroundColor: colors.brandTertiary }]}>
                  <MaterialIcon name="form-textbox-password" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>PIN बदलें</Text>
                  <Text style={styles.rowLabel}>नया 4-अंकों का सुरक्षा कोड बनाएँ</Text>
                </View>
                <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* Category 3: डेटा वॉल्ट व रीसायकल बिन */}
      <Text style={styles.groupHead}>डेटा वॉल्ट व बैकअप</Text>
      <View style={styles.card}>
        <Pressable
          style={styles.settingRow}
          onPress={() => setTrashOpen(true)}
          testID="trash-btn"
        >
          <View style={[styles.iconCircle, { backgroundColor: "#FFFBEB" }]}>
            <MaterialIcon name="delete-restore" size={20} color={colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.rowValue}>कचरा पेटी (Recycle Bin)</Text>
              {trashCount > 0 ? (
                <View style={styles.trashBadge}>
                  <Text style={styles.trashBadgeText}>{trashCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.rowLabel}>हटाए गए रिकॉर्ड 30 दिन तक सुरक्षित रहते हैं</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <Pressable
          style={[styles.settingRow, styles.rowBorder]}
          onPress={backup}
          disabled={backingUp}
          testID="backup-btn"
        >
          <View style={[styles.iconCircle, { backgroundColor: "#F0FDF4" }]}>
            <MaterialIcon name="file-excel-outline" size={20} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>सम्पूर्ण खाता Excel बैकअप (.csv)</Text>
            <Text style={styles.rowLabel}>सभी ग्राहक, लेन-देन व काम की स्प्रेडशीट</Text>
          </View>
          {backingUp ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <MaterialIcon name="download" size={20} color={colors.muted} />
          )}
        </Pressable>
      </View>
      {backupError ? <Text style={styles.errorText}>{backupError}</Text> : null}

      {/* Sign Out Danger Zone */}
      <Pressable style={styles.logoutBtn} onPress={handleSignOut} testID="logout-btn">
        <MaterialIcon name="logout-variant" size={18} color={colors.error} />
        <Text style={styles.logoutText}>सुरक्षित साइन आउट</Text>
      </Pressable>

      {/* App Branding & Version Footer */}
      <View style={styles.footerWrap}>
        <Text style={styles.footerBrand}>
          {user?.shop_name || "बही खाता"} · प्रो संस्करण v1.2
        </Text>
        <Text style={styles.footerSub}>
          Nain Photo State & Khata · 100% मेड इन इंडिया 🇮🇳
        </Text>
      </View>

      {/* Modals */}
      <ShopProfileSheet visible={shopSheet} onClose={() => setShopSheet(false)} />
      <PinSetupModal visible={pinSetup} onClose={() => setPinSetup(false)} onDone={onPinSet} />
      <RecycleBinModal visible={trashOpen} onClose={() => setTrashOpen(false)} />

      {/* Payment QR Code Modal */}
      <QrCodeModal
        visible={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        shopName={user?.shop_name || user?.name || "दुकान"}
        upiId={user?.shop_upi || ""}
        onSetupUpi={() => {
          setQrModalOpen(false);
          setShopSheet(true);
        }}
      />
    </ScrollView>
  );
}

/**
 * High-Class QR Code & Payment Modal
 */
function QrCodeModal({
  visible,
  onClose,
  shopName,
  upiId,
  onSetupUpi,
}: {
  visible: boolean;
  onClose: () => void;
  shopName: string;
  upiId: string;
  onSetupUpi: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const upiUrl = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopName)}&cu=INR`
    : "";
  const qrUrl = upiUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(upiUrl)}`
    : "";

  const handleCopy = async () => {
    if (!upiId) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(upiId);
      } else {
        await Share.share({ message: upiId });
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={qrStyles.overlay}>
        <View style={qrStyles.card}>
          <View style={qrStyles.header}>
            <Text style={qrStyles.title}>दुकान का पेमेंट QR कोड</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="qr-close-btn">
              <MaterialIcon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          {upiId ? (
            <View style={qrStyles.content}>
              <Text style={qrStyles.shopName}>{shopName}</Text>
              <Text style={qrStyles.subtitle}>
                ग्राहक किसी भी UPI ऐप (PhonePe, GPay, Paytm) से स्कैन कर सकते हैं
              </Text>

              <View style={qrStyles.qrFrame}>
                <Image source={{ uri: qrUrl }} style={qrStyles.qrImage} />
              </View>

              <View style={qrStyles.upiBox}>
                <Text style={qrStyles.upiLabel}>UPI ID: </Text>
                <Text style={qrStyles.upiVal} numberOfLines={1}>{upiId}</Text>
                <Pressable style={qrStyles.copyPill} onPress={handleCopy} testID="qr-copy-btn">
                  <Text style={qrStyles.copyPillText}>{copied ? "कॉपी ✓" : "कॉपी"}</Text>
                </Pressable>
              </View>

              <Pressable style={qrStyles.doneBtn} onPress={onClose} testID="qr-done-btn">
                <Text style={qrStyles.doneBtnText}>पूर्ण (Done)</Text>
              </Pressable>
            </View>
          ) : (
            <View style={qrStyles.emptyContent}>
              <MaterialIcon name="qrcode-remove" size={48} color={colors.muted} />
              <Text style={qrStyles.emptyTitle}>UPI ID सेट नहीं है</Text>
              <Text style={qrStyles.emptySub}>
                बिल व QR कोड पर पेमेंट पाने के लिए कृपया अपनी UPI ID (उदा. 9876543210@upi) दर्ज करें।
              </Text>
              <Pressable style={qrStyles.setupBtn} onPress={onSetupUpi} testID="qr-setup-btn">
                <MaterialIcon name="plus" size={18} color={colors.onBrandPrimary} />
                <Text style={qrStyles.setupBtnText}>UPI ID अभी जोड़ें</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  eyebrow: {
    fontSize: 11,
    color: colors.brandSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  h1: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.onSurface,
    marginTop: 2,
  },
  syncIconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Visiting Card Styles
  cardContainer: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  merchantBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  merchantBadgeText: {
    color: "#F8FAFC",
    fontSize: 10,
    fontWeight: "700",
  },
  editCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  editCardBtnText: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "600",
  },
  cardMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cardShopName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  cardOwnerName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
    marginTop: 2,
  },
  cardDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  cardDetailText: {
    fontSize: 12,
    color: "#CBD5E1",
    fontWeight: "500",
  },
  cardAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#F8FAFC",
  },
  cardAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#94A3B8",
  },
  cardAvatarInitials: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  upiPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: spacing.md,
  },
  upiPillLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  upiPillText: {
    color: "#CBD5E1",
    fontSize: 12,
  },
  upiPillBold: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  upiCopyBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  upiCopyText: {
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "700",
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cardPrimaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  cardPrimaryBtnText: {
    color: "#0F172A",
    fontSize: 12,
    fontWeight: "700",
  },
  cardSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  cardSecondaryBtnText: {
    color: "#F8FAFC",
    fontSize: 12,
    fontWeight: "700",
  },

  // Persona Switcher
  personaContainer: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionMiniLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.muted,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  personaSwitchRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personaSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  personaSegmentActive: {
    backgroundColor: colors.brandTertiary,
  },
  personaText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  personaTextActive: {
    color: colors.brandPrimary,
    fontWeight: "700",
  },
  personaHelper: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 15,
  },

  // Analytics Section
  analyticsSection: {
    marginTop: spacing.xl,
  },
  analyticsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  healthChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  healthChipGood: {
    backgroundColor: colors.successSoft,
  },
  healthChipAvg: {
    backgroundColor: "#FEF3C7",
  },
  healthChipLow: {
    backgroundColor: colors.errorSoft,
  },
  healthChipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  healthTextGood: {
    color: colors.success,
  },
  healthTextAvg: {
    color: colors.warning,
  },
  healthTextLow: {
    color: colors.error,
  },
  analyticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  analyticsCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  analyticsCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  analyticsLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  analyticsVal: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.onSurface,
    marginTop: 4,
  },
  analyticsSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  progressBarWrapper: {
    marginTop: spacing.sm,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: colors.success,
    borderRadius: radius.pill,
  },
  progressTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  progressSubText: {
    fontSize: 10,
    color: colors.muted,
  },

  // Sync Card
  syncCard: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  syncTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.success,
  },
  syncSub: {
    fontSize: 11,
    color: colors.onSurfaceSecondary,
    marginTop: 2,
  },
  syncBtnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  syncBtnSmallText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.warning,
  },

  // Settings Group
  groupHead: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  sectionHead: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onSurface,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  rowLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  trashBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  trashBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.warning,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },

  // Logout
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: "700",
  },

  // Footer
  footerWrap: {
    alignItems: "center",
    marginTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
  },
  footerSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
});

const qrStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.onSurface,
  },
  content: {
    alignItems: "center",
    marginTop: spacing.md,
  },
  shopName: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.brandPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    marginTop: 4,
  },
  qrFrame: {
    marginVertical: spacing.lg,
    padding: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  qrImage: {
    width: 200,
    height: 200,
  },
  upiBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  upiLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  upiVal: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.onSurface,
    maxWidth: 160,
  },
  copyPill: {
    marginLeft: 8,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  copyPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.brandPrimary,
  },
  doneBtn: {
    marginTop: spacing.lg,
    width: "100%",
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
  },
  doneBtnText: {
    color: colors.onBrandPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyContent: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: spacing.md,
  },
  emptySub: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  setupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  setupBtnText: {
    color: colors.onBrandPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
});
