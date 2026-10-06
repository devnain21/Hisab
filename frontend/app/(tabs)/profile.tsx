import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, Switch, ActivityIndicator, Platform, Linking } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, semantic } from "@/src/theme";
import { IconButton } from "@/src/components/ui";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import * as Application from "expo-application";
import { useAeps, useCustomers, useEntries, useJobs } from "@/src/lib/data";
import { formatINR, todayISO, formatPhone } from "@/src/lib/format";
import { LOCK_CHOICES, daysSinceBackup, savePrefs, usePrefs } from "@/src/lib/prefs";
import { GuideSheet, ReceiptSettingsSheet, ReminderTextSheet } from "@/src/components/settings-sheets";
import { Pressable } from "@/src/components/tap";
import { ShopProfileSheet } from "@/src/components/sheets";
import { CloseShopSheet } from "@/src/components/close-shop-sheet";
import { PinSetupModal, PinVerifyModal, useAppLock } from "@/src/components/app-lock";
import { biometricAvailable, disableLock, lockSupported, setBiometric, setPin } from "@/src/lib/app-lock";
import { exportFullLedgerCsv } from "@/src/lib/export-data";
import { flush, usePendingCount } from "@/src/lib/store";
import { confirmAction, showNotice } from "@/src/lib/confirm";
import { applyRestore, exportBackupJson, pickBackup } from "@/src/lib/backup";
import { accountName, usePersona } from "@/src/lib/persona";
import { RecycleBinModal } from "@/src/components/recycle-bin-sheet";
import { getTrashList, subscribeTrash } from "@/src/lib/trash";
import { shareMessage } from "@/src/lib/share-text";
import { computeFlows, pocketNet, useMoneyBook } from "@/src/lib/wallet";
import { router } from "expo-router";
import { copyText, QrCodeModal } from "@/src/components/profile/qr-code-modal";
import { styles } from "@/src/components/profile/styles";

const SUPPORT_PHONE = "8950101037";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { persona, isPersonal, setPersona, labels, hasShop } = usePersona();
  const [openShop, setOpenShop] = useState(false);
  const [closeShop, setCloseShop] = useState(false);

  // Modals & Sheets
  const [shopSheet, setShopSheet] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const allCustomers = useCustomers().data;
  const entriesQ = useEntries();
  const allEntries = entriesQ.data;
  const lastSync = entriesQ.dataUpdatedAt ? new Date(entriesQ.dataUpdatedAt) : null;
  const syncFailed = entriesQ.isError;
  const syncTime = (d: Date) => {
    const hm = d.toTimeString().slice(0, 5);
    return d.toDateString() === new Date().toDateString() ? `आज ${hm}` : `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
  };
  const jobs = useJobs().data ?? [];
  const aeps = useAeps().data ?? [];
  const book = useMoneyBook();
  const money = useMemo(() => computeFlows(book, persona, (d) => d <= todayISO()), [book, persona]);
  const cashBal = pocketNet(money.cash);
  const bankBal = pocketNet(money.bank);
  const pending = usePendingCount();
  const ownerName = user?.owner_name || user?.name || "";

  // App Lock
  const { config: lock, refresh: refreshLock } = useAppLock();
  const [pinSetup, setPinSetup] = useState(false);
  const [verifyFor, setVerifyFor] = useState<"off" | "change" | null>(null);
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

  const prefs = usePrefs();
  const [receiptSheet, setReceiptSheet] = useState(false);
  const [reminderSheet, setReminderSheet] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"mine" | "all">("mine");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const backupDays = daysSinceBackup(prefs);
  const sync =
    pending > 0
      ? { tone: "warn", icon: "cloud-upload-outline", color: colors.warning, text: `${pending} बदलाव फ़ोन में सेव, सर्वर पर जाने बाकी`, action: "भेजें" }
      : syncFailed
        ? { tone: "bad", icon: "cloud-off-outline", color: colors.error, text: `सर्वर से नहीं जुड़ पाया${lastSync ? ` · आख़िरी ${syncTime(lastSync)}` : ""}`, action: "दोबारा" }
        : { tone: "ok", icon: "cloud-check-outline", color: colors.success, text: `सब सेव है${lastSync ? ` · ${syncTime(lastSync)}` : ""}`, action: "ताज़ा करें" };

  // What a slip, QR and visiting card need; GSTIN is optional so it is not counted.
  const completeness = useMemo(() => {
    const checks: [boolean, string][] = [
      [!!accountName(user), isPersonal ? "नाम" : "दुकान का नाम"],
      [!!user?.shop_phone, "फ़ोन"],
      [!!user?.shop_upi, "UPI ID"],
      [!!user?.shop_address, "पता"],
      ...(isPersonal ? [] : ([[!!user?.owner_name, "मालिक का नाम"]] as [boolean, string][])),
    ];
    const done = checks.filter(([ok]) => ok).length;
    return { pct: Math.round((done / checks.length) * 100), next: checks.find(([ok]) => !ok)?.[1] ?? "" };
  }, [user, isPersonal]);

  // Version and build come from the installed APK; the OTA date tells which update runs on top of it.
  const versionText = useMemo(() => {
    const v = Application.nativeApplicationVersion || Constants.expoConfig?.version || "";
    const build = Application.nativeBuildVersion;
    let ota = "";
    try {
      if (Platform.OS === "web") ota = "वेबसाइट";
      else if (Updates.isEmbeddedLaunch || !Updates.createdAt) ota = "APK के साथ आया कोड";
      else {
        const d = Updates.createdAt;
        ota = `अपडेट ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.toTimeString().slice(0, 5)}`;
      }
    } catch {}
    return [v ? `संस्करण ${v}${build ? ` (बिल्ड ${build})` : ""}` : "", ota].filter(Boolean).join(" · ");
  }, []);

  const checkUpdate = async () => {
    if (Platform.OS === "web" || __DEV__) {
      showNotice("सब नया है", "वेबसाइट हर बार खुलने पर सबसे नया वर्ज़न ही दिखाती है।");
      return;
    }
    setCheckingUpdate(true);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        showNotice("सब नया है", "आपके फ़ोन में सबसे नया अपडेट लगा है।");
        return;
      }
      await Updates.fetchUpdateAsync();
      confirmAction("नया अपडेट तैयार", "ऐप एक बार बंद होकर खुलेगा और नया अपडेट लग जाएगा। आपका सारा हिसाब सुरक्षित रहेगा।", "अभी लगाएँ", () => {
        void Updates.reloadAsync().catch(() => {});
      });
    } catch {
      showNotice("जाँच नहीं हो पाई", "इंटरनेट चालू करके दोबारा कोशिश करें।");
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Persona toggle with haptics
  const handleSwitchPersona = (target: "business" | "personal") => {
    if (target === persona) return;
    try {
      Haptics.selectionAsync();
    } catch {}
    setPersona(target);
  };

  const handleCopyUpi = async (upiId: string) => {
    if (!upiId) return;
    if (await copyText(upiId)) {
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    }
  };

  const openSupport = () => {
    const text = `नमस्ते, हिसाब ऐप में मदद चाहिए।\n(${accountName(user) || user?.email || ""} · ${versionText})`;
    void Linking.openURL(`https://wa.me/91${SUPPORT_PHONE}?text=${encodeURIComponent(text)}`).catch(() =>
      showNotice("WhatsApp नहीं खुला", `इस नंबर पर संपर्क करें: ${formatPhone(SUPPORT_PHONE)}`),
    );
  };

  // Share digital visiting card
  const handleShareVisitingCard = async () => {
    const shopName = accountName(user) || user?.name || (isPersonal ? "मेरा नाम" : "मेरी दुकान");
    const ownerLine = !isPersonal && ownerName ? `\n👤 प्रोपराइटर: ${ownerName}` : "";
    const phone = user?.shop_phone ? `\n📞 फ़ोन / संपर्क: ${formatPhone(user.shop_phone)}` : "";
    const addr = user?.shop_address ? `\n📍 पता: ${user.shop_address}` : "";
    const gst = user?.shop_gst ? `\n🏛️ GSTIN: ${user.shop_gst}` : "";
    const upi = user?.shop_upi ? `\n💳 UPI भुगतान ID: ${user.shop_upi}` : "";

    const cardMessage = isPersonal
      ? `👤 *${shopName}*${phone}${addr}${upi}`
      : `🏪 *${shopName}*${ownerLine}${phone}${addr}${gst}${upi}\n\n🙏 धन्यवाद!`;
    await shareMessage(cardMessage);
  };

  // Force sync
  const handleForceSync = async () => {
    setSyncing(true);
    try {
      await flush();
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
    setVerifyFor("off");
  };

  const onVerified = useCallback(async () => {
    const action = verifyFor;
    setVerifyFor(null);
    if (action === "change") {
      setPinSetup(true);
      return;
    }
    await disableLock();
    await refreshLock();
  }, [verifyFor, refreshLock]);

  const toggleBio = async (on: boolean) => {
    await setBiometric(on);
    await refreshLock();
  };

  const backup = async () => {
    setBackupError(null);
    setBackingUp(true);
    try {
      await exportFullLedgerCsv({
        customers: allCustomers ?? [],
        entries: allEntries ?? [],
        jobs,
        aeps,
        expenses: book.expenses,
        moves: book.moves,
        shop: user,
        only: exportScope === "mine" || !hasShop ? persona : undefined,
      });
      void savePrefs({ lastBackupAt: new Date().toISOString() });
    } catch {
      setBackupError("बैकअप नहीं बन पाया, दोबारा कोशिश करें।");
    } finally {
      setBackingUp(false);
    }
  };

  const jsonBackup = async () => {
    setBackupError(null);
    setBackingUp(true);
    try {
      await exportBackupJson(accountName(user) || "हिसाब");
      void savePrefs({ lastBackupAt: new Date().toISOString() });
    } catch {
      setBackupError("बैकअप नहीं बन पाया, दोबारा कोशिश करें।");
    } finally {
      setBackingUp(false);
    }
  };

  const restoreBackup = async () => {
    setBackupError(null);
    let restorePlan;
    try {
      restorePlan = await pickBackup();
    } catch {
      setBackupError("यह हिसाब ऐप की बैकअप फ़ाइल नहीं है।");
      return;
    }
    if (!restorePlan) return;
    const c = restorePlan.counts;
    if (restorePlan.rows.length === 0) {
      showNotice("सब पहले से मौजूद है", "इस बैकअप का हर रिकॉर्ड ऐप में पहले से है।");
      return;
    }
    const parts = [
      c.customers && `${c.customers} खाते`,
      c.entries && `${c.entries} एंट्री`,
      c.jobs && `${c.jobs} काम`,
      c.aeps && `${c.aeps} काउंटर`,
      c.expenses && `${c.expenses} खर्च`,
      c.moves && `${c.moves} पैसे जोड़े / निकाले`,
    ].filter(Boolean);
    confirmAction("बैकअप से वापस लाएं?", `${parts.join(", ")} जो ऐप में नहीं हैं, वापस जोड़े जाएँगे। अभी का कोई रिकॉर्ड नहीं बदलेगा।`, "वापस लाएं", () => {
      void applyRestore(restorePlan);
    });
  };

  const handleSignOut = () => {
    if (pending > 0) {
      confirmAction(
        "कुछ बदलाव अभी सर्वर पर नहीं गए",
        `${pending} बदलाव सिंक होने बाकी हैं। ये इसी फ़ोन पर संभाल कर रखे जाएँगे और इसी Google खाते से दोबारा लॉगिन करने पर भेज दिए जाएँगे। बेहतर है पहले इंटरनेट चालू करके थोड़ा रुकें।`,
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
      <View style={[styles.topHeader, { alignItems: "center", gap: spacing.xs }]}>
        <IconButton icon="arrow-left" label="वापस" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ marginLeft: -spacing.sm }} testID="profile-back" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>प्रोफ़ाइल व सेटिंग्स</Text>
          <Text style={styles.h1}>{isPersonal ? "मेरा खाता" : "मेरी दुकान"}</Text>
        </View>
        <IconButton icon="chart-box-outline" label="रिपोर्ट" color={colors.brandPrimary} background={colors.brandTertiary} onPress={() => router.push("/report" as never)} testID="profile-report" />
      </View>

      {hasShop ? (
        <View style={styles.personaSwitchRow}>
          <Pressable
            style={[styles.personaSegment, isPersonal && styles.personaSegmentActive]}
            onPress={() => handleSwitchPersona("personal")}
            testID="persona-personal-btn"
          >
            <MaterialIcon name="account" size={17} color={isPersonal ? colors.brandPrimary : colors.muted} />
            <Text style={[styles.personaText, isPersonal && styles.personaTextActive]}>व्यक्तिगत</Text>
          </Pressable>
          <Pressable
            style={[styles.personaSegment, !isPersonal && styles.personaSegmentActive]}
            onPress={() => handleSwitchPersona("business")}
            testID="persona-business-btn"
          >
            <MaterialIcon name="storefront" size={17} color={!isPersonal ? colors.brandPrimary : colors.muted} />
            <Text style={[styles.personaText, !isPersonal && styles.personaTextActive]}>दुकान</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.openShopCard} onPress={() => setOpenShop(true)} testID="open-shop-btn">
          <View style={styles.openShopIcon}>
            <MaterialIcon name="storefront-outline" size={24} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.openShopTitle}>दुकान / बिज़नेस खाता बनाएँ</Text>
            <Text style={styles.openShopSub}>ग्राहक, उधारी, काम और गल्ला अलग से संभालें</Text>
          </View>
          <MaterialIcon name="chevron-right" size={22} color={colors.brandPrimary} />
        </Pressable>
      )}

      <Pressable
        style={[styles.syncLine, sync.tone === "bad" && { backgroundColor: colors.errorSoft }, sync.tone === "warn" && { backgroundColor: "#FEF3E2" }]}
        onPress={handleForceSync}
        disabled={syncing}
        testID="profile-sync-line"
      >
        <MaterialIcon name={sync.icon as any} size={18} color={sync.color} />
        <Text style={[styles.syncLineText, { color: sync.color }]} numberOfLines={1}>{sync.text}</Text>
        {syncing ? <ActivityIndicator size="small" color={sync.color} /> : <Text style={[styles.syncLineAction, { color: sync.color }]}>{sync.action}</Text>}
      </Pressable>

      <LinearGradient colors={["#004D40", "#00695C", "#00796B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardContainer}>
        <View style={styles.cardTopRow}>
          <View style={styles.merchantBadge}>
            <MaterialIcon name={isPersonal ? "account" : "storefront"} size={13} color="#FFFFFF" />
            <Text style={styles.merchantBadgeText}>{isPersonal ? "निजी खाता" : "दुकान खाता"}</Text>
          </View>
          <Pressable style={styles.editCardBtn} onPress={() => setShopSheet(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="जानकारी बदलें" testID="profile-edit-visiting-card">
            <MaterialIcon name="pencil" size={14} color="#E0F2F1" />
            <Text style={styles.editCardBtnText}>बदलें</Text>
          </Pressable>
        </View>

        <View style={styles.cardMain}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardShopName} numberOfLines={1}>
              {accountName(user) || (isPersonal ? "अपना नाम जोड़ें" : "दुकान का नाम जोड़ें")}
            </Text>
            <Text style={styles.cardOwnerName} numberOfLines={1}>
              {isPersonal ? user?.email : ownerName ? `प्रोपराइटर: ${ownerName}` : user?.email}
            </Text>
            <View style={styles.cardDetailRow}>
              <MaterialIcon name="phone-outline" size={13} color="#B2DFDB" />
              <Text style={styles.cardDetailText} numberOfLines={1}>
                {user?.shop_phone ? formatPhone(user.shop_phone) : "फ़ोन नंबर जोड़ें"}
              </Text>
            </View>
            {user?.shop_address ? (
              <View style={styles.cardDetailRow}>
                <MaterialIcon name="map-marker-outline" size={13} color="#B2DFDB" />
                <Text style={styles.cardDetailText} numberOfLines={1}>{user.shop_address}</Text>
              </View>
            ) : null}
            {!isPersonal && user?.shop_gst ? (
              <View style={styles.cardDetailRow}>
                <MaterialIcon name="card-account-details-outline" size={13} color="#B2DFDB" />
                <Text style={styles.cardDetailText} numberOfLines={1}>GSTIN: {user.shop_gst}</Text>
              </View>
            ) : null}
          </View>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.cardAvatar} />
          ) : (
            <View style={styles.cardAvatarFallback}>
              <Text style={styles.cardAvatarInitials}>{(accountName(user) || user?.name || "B")[0].toUpperCase()}</Text>
            </View>
          )}
        </View>

        {user?.shop_upi ? (
          <View style={styles.upiPill}>
            <View style={styles.upiPillLeft}>
              <MaterialIcon name="qrcode-scan" size={15} color="#FFFFFF" />
              <Text style={styles.upiPillText} numberOfLines={1}>
                UPI: <Text style={styles.upiPillBold}>{user.shop_upi}</Text>
              </Text>
            </View>
            <Pressable style={styles.upiCopyBtn} onPress={() => handleCopyUpi(user.shop_upi || "")} hitSlop={8} accessibilityRole="button" accessibilityLabel="UPI ID कॉपी करें" testID="copy-upi-btn">
              <Text style={styles.upiCopyText}>{copiedUpi ? "कॉपी हुआ" : "कॉपी"}</Text>
            </Pressable>
          </View>
        ) : null}

        {completeness.pct < 100 ? (
          <Pressable style={styles.meter} onPress={() => setShopSheet(true)} testID="profile-meter">
            <View style={styles.meterHead}>
              <Text style={styles.meterText}>प्रोफ़ाइल {completeness.pct}% पूरी</Text>
              <Text style={styles.meterAction}>{completeness.next} जोड़ें ›</Text>
            </View>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${completeness.pct}%` }]} />
            </View>
          </Pressable>
        ) : null}

        <View style={styles.cardActionsRow}>
          <Pressable style={styles.cardPrimaryBtn} onPress={handleShareVisitingCard} testID="share-card-btn">
            <MaterialIcon name="share-variant-outline" size={15} color={colors.brandSecondary} />
            <Text style={styles.cardPrimaryBtnText}>कार्ड शेयर करें</Text>
          </Pressable>
          <Pressable style={styles.cardSecondaryBtn} onPress={() => setQrModalOpen(true)} testID="view-qr-btn">
            <MaterialIcon name="qrcode" size={15} color="#F8FAFC" />
            <Text style={styles.cardSecondaryBtnText}>{isPersonal ? "मेरा QR" : "पेमेंट QR कोड"}</Text>
          </Pressable>
        </View>
      </LinearGradient>

      <Text style={styles.groupHead}>रिपोर्ट व हिसाब</Text>
      <View style={styles.card}>
        <Pressable style={styles.settingRow} onPress={() => router.push("/report" as never)} testID="profile-report">
          <View style={styles.iconCircle}>
            <MaterialIcon name="chart-box-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>रिपोर्ट</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {prefs.hideAmounts ? "पैसे आए / गए · दिन, हफ़्ता, महीना" : `${labels.cash} ${formatINR(cashBal)} · बैंक ${formatINR(bankBal)}`}
            </Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <Text style={styles.groupHead}>{isPersonal ? "मेरी सेटिंग्स" : "दुकान सेटिंग्स"}</Text>
      <View style={styles.card}>
        <Pressable style={styles.settingRow} onPress={() => setShopSheet(true)} testID="profile-shop-settings">
          <View style={styles.iconCircle}>
            <MaterialIcon name="storefront-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>{labels.profileHeading}</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {accountName(user) ? `${accountName(user)} · ${user?.shop_phone || "फ़ोन"}` : "नाम, फ़ोन, पता"}
            </Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setQrModalOpen(true)} testID="profile-qr-settings">
          <View style={styles.iconCircle}>
            <MaterialIcon name="qrcode" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>{isPersonal ? "मेरा QR कोड" : "दुकान का QR कोड"}</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>{user?.shop_upi ? `UPI: ${user.shop_upi}` : "UPI ID जोड़ें"}</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        {!isPersonal ? (
          <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setReceiptSheet(true)} testID="profile-receipt-settings">
            <View style={styles.iconCircle}>
              <MaterialIcon name="receipt-text-outline" size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue}>बिल / रसीद सेटिंग</Text>
              <Text style={styles.rowLabel} numberOfLines={1}>{prefs.receiptNote || "लोगो, रसीद के नीचे नोट, GSTIN दिखाना"}</Text>
            </View>
            <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        ) : null}

        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setReminderSheet(true)} testID="profile-reminder-text">
          <View style={styles.iconCircle}>
            <MaterialIcon name="whatsapp" size={20} color={semantic.whatsapp} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>तगादा मैसेज</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>{prefs.reminderText ? prefs.reminderText.replace(/\s+/g, " ") : "अपने शब्दों में WhatsApp याद-दिहानी"}</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <View style={[styles.settingRow, styles.rowBorder]}>
          <View style={styles.iconCircle}>
            <MaterialIcon name="cash-sync" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>पैसे अक्सर कैसे मिलते हैं</Text>
            <Text style={styles.rowLabel}>नई एंट्री में यही पहले से चुना रहेगा</Text>
          </View>
          <View style={styles.miniSeg}>
            {(["cash", "online"] as const).map((m) => (
              <Pressable key={m} onPress={() => void savePrefs({ defaultMode: m })} style={[styles.miniSegBtn, prefs.defaultMode === m && styles.miniSegOn]} testID={`default-mode-${m}`}>
                <Text style={[styles.miniSegText, prefs.defaultMode === m && styles.miniSegTextOn]}>{m === "cash" ? "नकद" : "ऑनलाइन"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.groupHead}>सुरक्षा व गोपनीयता</Text>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.iconCircle}>
            <MaterialIcon name="eye-off-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>बैलेंस छुपाएँ</Text>
            <Text style={styles.rowLabel}>होम पर कुल रकम ₹ •••• दिखेगी · होम की आँख से भी बदलें</Text>
          </View>
          <Switch value={prefs.hideAmounts} onValueChange={(v) => void savePrefs({ hideAmounts: v })} trackColor={{ true: colors.brandPrimary }} testID="toggle-hide-amounts-setting" />
        </View>

        {lockSupported ? (
          <>
            <View style={[styles.settingRow, styles.rowBorder]}>
              <View style={styles.iconCircle}>
                <MaterialIcon name="shield-lock-outline" size={20} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowValue}>ऐप लॉक (PIN)</Text>
                <Text style={styles.rowLabel}>ऐप खोलते समय 4-अंकों का PIN माँगे</Text>
              </View>
              <Switch value={lock.enabled} onValueChange={toggleLock} trackColor={{ true: colors.brandPrimary }} testID="toggle-lock" />
            </View>

            {lock.enabled ? (
              <View style={[styles.settingRow, styles.rowBorder, { flexWrap: "wrap" }]}>
                <View style={styles.iconCircle}>
                  <MaterialIcon name="timer-lock-outline" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>कितनी देर बाद लॉक हो</Text>
                  <Text style={styles.rowLabel}>ऐप से बाहर जाने के बाद</Text>
                </View>
                <View style={styles.lockChips}>
                  {LOCK_CHOICES.map((c) => (
                    <Pressable key={c.ms} onPress={() => void savePrefs({ lockAfterMs: c.ms })} style={[styles.miniSegBtn, styles.lockChip, prefs.lockAfterMs === c.ms && styles.miniSegOn]} testID={`lock-after-${c.ms}`}>
                      <Text style={[styles.miniSegText, prefs.lockAfterMs === c.ms && styles.miniSegTextOn]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {lock.enabled && hasBio ? (
              <View style={[styles.settingRow, styles.rowBorder]}>
                <View style={styles.iconCircle}>
                  <MaterialIcon name="fingerprint" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>फिंगरप्रिंट से खोलें</Text>
                  <Text style={styles.rowLabel}>उंगली लगाकर तुरंत ऐप अनलॉक करें</Text>
                </View>
                <Switch value={lock.biometric} onValueChange={toggleBio} trackColor={{ true: colors.brandPrimary }} testID="toggle-bio" />
              </View>
            ) : null}

            {lock.enabled ? (
              <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setVerifyFor("change")} testID="change-pin">
                <View style={styles.iconCircle}>
                  <MaterialIcon name="form-textbox-password" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>PIN बदलें</Text>
                  <Text style={styles.rowLabel}>नया 4-अंकों का PIN बनाएँ</Text>
                </View>
                <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      <Text style={styles.groupHead}>बैकअप व डेटा</Text>
      <View style={styles.card}>
        <View style={[styles.backupStatus, backupDays === null || backupDays > 15 ? { backgroundColor: "#FEF3E2" } : null]} testID="backup-status">
          <MaterialIcon
            name={backupDays === null || backupDays > 15 ? "alert-circle-outline" : "check-circle-outline"}
            size={18}
            color={backupDays === null || backupDays > 15 ? colors.warning : colors.success}
          />
          <Text style={[styles.backupStatusText, { color: backupDays === null || backupDays > 15 ? colors.warning : colors.success }]}>
            {backupDays === null
              ? "इस फ़ोन से अभी तक कोई बैकअप नहीं बना"
              : backupDays === 0
                ? "आख़िरी बैकअप: आज"
                : `आख़िरी बैकअप: ${backupDays} दिन पहले${backupDays > 15 ? " · नया बना लें" : ""}`}
          </Text>
        </View>

        <View style={[styles.settingRow, styles.rowBorder, { flexWrap: "wrap" }]}>
          <Pressable style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1, minWidth: 200 }} onPress={backup} disabled={backingUp} testID="backup-btn">
            <View style={styles.iconCircle}>
              <MaterialIcon name="file-excel-outline" size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue}>Excel फ़ाइल (.csv)</Text>
              <Text style={styles.rowLabel}>खाते, एंट्री, AEPS, खर्च — पढ़ने व प्रिंट के लिए</Text>
            </View>
            {backingUp ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialIcon name="download" size={20} color={colors.muted} />}
          </Pressable>
          {hasShop ? (
            <View style={[styles.miniSeg, { marginLeft: 48 }]}>
              {(["mine", "all"] as const).map((s) => (
                <Pressable key={s} onPress={() => setExportScope(s)} style={[styles.miniSegBtn, exportScope === s && styles.miniSegOn]} testID={`export-scope-${s}`}>
                  <Text style={[styles.miniSegText, exportScope === s && styles.miniSegTextOn]}>{s === "mine" ? (isPersonal ? "सिर्फ़ निजी" : "सिर्फ़ दुकान") : "दोनों खाते"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={jsonBackup} disabled={backingUp} testID="backup-json-btn">
          <View style={styles.iconCircle}>
            <MaterialIcon name="cloud-download-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>पूरा बैकअप (.json)</Text>
            <Text style={styles.rowLabel}>दोनों खातों की पूरी कॉपी, ऐप में वापस लाने लायक</Text>
          </View>
          <MaterialIcon name="download" size={20} color={colors.muted} />
        </Pressable>

        {Platform.OS !== "web" ? (
          <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={restoreBackup} testID="restore-json-btn">
            <View style={styles.iconCircle}>
              <MaterialIcon name="backup-restore" size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue}>बैकअप से वापस लाएँ</Text>
              <Text style={styles.rowLabel}>सिर्फ़ गायब रिकॉर्ड जुड़ेंगे, कुछ नहीं बदलेगा</Text>
            </View>
            <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        ) : null}

        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={() => setTrashOpen(true)} testID="trash-btn">
          <View style={styles.iconCircle}>
            <MaterialIcon name="delete-restore" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.rowValue}>हटाई गई एंट्री</Text>
              {trashCount > 0 ? (
                <View style={styles.trashBadge}>
                  <Text style={styles.trashBadgeText}>{trashCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.rowLabel}>गलती से हटी एंट्री वापस लाएँ (आख़िरी 50)</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      </View>
      {backupError ? <Text style={styles.errorText}>{backupError}</Text> : null}

      <Text style={styles.groupHead}>मदद व जानकारी</Text>
      <View style={styles.card}>
        <Pressable style={styles.settingRow} onPress={() => setGuideOpen(true)} testID="profile-guide">
          <View style={styles.iconCircle}>
            <MaterialIcon name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>ऐप कैसे चलाएँ</Text>
            <Text style={styles.rowLabel}>ज़रूरी काम, एक-एक लाइन में</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={openSupport} testID="profile-support">
          <View style={styles.iconCircle}>
            <MaterialIcon name="whatsapp" size={20} color={semantic.whatsapp} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>मदद चाहिए? WhatsApp करें</Text>
            <Text style={styles.rowLabel}>{formatPhone(SUPPORT_PHONE)}</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
        <Pressable style={[styles.settingRow, styles.rowBorder]} onPress={checkUpdate} disabled={checkingUpdate} testID="profile-check-update">
          <View style={styles.iconCircle}>
            <MaterialIcon name="cellphone-arrow-down" size={20} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowValue}>नया अपडेट जाँचें</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>{versionText}</Text>
          </View>
          {checkingUpdate ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialIcon name="chevron-right" size={20} color={colors.muted} />}
        </Pressable>
      </View>

      <Pressable style={styles.logoutBtn} onPress={handleSignOut} testID="logout-btn">
        <MaterialIcon name="logout-variant" size={18} color={colors.error} />
        <Text style={styles.logoutText}>लॉग आउट</Text>
      </Pressable>

      {hasShop ? (
        <View style={styles.dangerZone}>
          <Text style={styles.dangerHead}>खतरनाक</Text>
          <Pressable style={styles.dangerRow} onPress={() => setCloseShop(true)} testID="close-shop-btn">
            <MaterialIcon name="store-remove-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.closeShopText}>दुकान खाता हटाएँ</Text>
              <Text style={styles.rowLabel}>पहले बैकअप बनाएँ — हटाने से पहले पुष्टि माँगी जाएगी</Text>
            </View>
            <MaterialIcon name="chevron-right" size={20} color={colors.error} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.footerWrap}>
        <Text style={styles.footerBrand}>{accountName(user) || "बही खाता"}</Text>
        <Text style={styles.footerSub}>{versionText}</Text>
      </View>

      {/* Modals */}
      <ShopProfileSheet visible={shopSheet} onClose={() => setShopSheet(false)} />
      <ShopProfileSheet visible={openShop} openShop onClose={() => setOpenShop(false)} />
      <CloseShopSheet visible={closeShop} onClose={() => setCloseShop(false)} />
      <PinSetupModal visible={pinSetup} onClose={() => setPinSetup(false)} onDone={onPinSet} />
      <PinVerifyModal
        visible={verifyFor !== null}
        title={verifyFor === "change" ? "अभी वाला PIN डालें" : "लॉक बंद करने के लिए PIN डालें"}
        onClose={() => setVerifyFor(null)}
        onVerified={onVerified}
      />
      <RecycleBinModal visible={trashOpen} onClose={() => setTrashOpen(false)} />
      <ReceiptSettingsSheet visible={receiptSheet} onClose={() => setReceiptSheet(false)} hasGst={!!user?.shop_gst} />
      <ReminderTextSheet visible={reminderSheet} onClose={() => setReminderSheet(false)} shopName={accountName(user)} />
      <GuideSheet visible={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Payment QR Code Modal */}
      <QrCodeModal
        visible={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        shopName={accountName(user) || user?.name || (isPersonal ? "मेरा नाम" : "दुकान")}
        title={isPersonal ? "मेरा पेमेंट QR कोड" : "दुकान का पेमेंट QR कोड"}
        upiId={user?.shop_upi || ""}
        onSetupUpi={() => {
          setQrModalOpen(false);
          setShopSheet(true);
        }}
      />
    </ScrollView>
  );
}
