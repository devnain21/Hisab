import { useState } from "react";
import { View, Text, StyleSheet, Modal, Alert } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import * as Linking from "expo-linking";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatINR } from "@/src/lib/format";
import { shareMessage } from "@/src/lib/share-text";
import { upiLink } from "@/src/lib/qr";
import { QrCode } from "@/src/components/qr-code";

export function UpiQrModal({
  visible,
  onClose,
  upiId,
  shopName,
  amount,
  customerName,
}: {
  visible: boolean;
  onClose: () => void;
  upiId: string;
  shopName: string;
  amount: number;
  customerName: string;
}) {
  const [copied, setCopied] = useState(false);

  const cleanUpi = upiId.trim();
  const upiUrl = cleanUpi ? upiLink(cleanUpi, shopName, amount, `Hisab ${customerName}`) : "";

  const handleCopy = async () => {
    if (!cleanUpi) return;
    await shareMessage(cleanUpi);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenUpi = async () => {
    if (!upiUrl) return;
    try {
      const can = await Linking.canOpenURL(upiUrl);
      if (can) {
        await Linking.openURL(upiUrl);
      } else {
        Alert.alert("UPI ऐप नहीं मिली", "कृपया QR कोड स्कैन करें या UPI ID कॉपी करें।");
      }
    } catch {
      Alert.alert("UPI ऐप नहीं मिली", "कृपया QR कोड स्कैन करें या UPI ID कॉपी करें।");
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>📱 UPI QR कोड</Text>
              <Text style={styles.subtitle}>{shopName}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="qr-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {!cleanUpi ? (
            <View style={styles.noUpiBox}>
              <MaterialIcon name="alert-circle-outline" size={40} color={colors.warning} />
              <Text style={styles.noUpiText}>UPI ID सेट नहीं है</Text>
              <Text style={styles.noUpiSub}>
                प्रोफ़ाइल टैब में जाकर अपनी UPI ID (उदा. 9876543210@paytm) दर्ज करें ताकि पैसे भेजने वाला सीधे स्कैन कर सके।
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: "center" }}>
              <View style={styles.amountBadge}>
                <Text style={styles.amountLabel}>भुगतान रकम</Text>
                <Text style={styles.amountValue}>{formatINR(amount)}</Text>
                <Text style={styles.customerName}>{customerName}</Text>
              </View>

              <View style={styles.qrContainer}>
                {upiUrl ? <QrCode value={upiUrl} size={180} /> : null}
              </View>

              <View style={styles.upiRow}>
                <Text style={styles.upiText} numberOfLines={1}>{cleanUpi}</Text>
                <Pressable onPress={handleCopy} style={styles.copyBtn} testID="qr-copy-upi">
                  <MaterialIcon name={copied ? "check" : "content-copy"} size={16} color={colors.brandPrimary} />
                  <Text style={styles.copyBtnText}>{copied ? "कॉपी हुआ" : "कॉपी"}</Text>
                </Pressable>
              </View>

              <Text style={styles.hintText}>
                PhonePe, Google Pay, Paytm, BHIM आदि किसी भी UPI ऐप से स्कैन करें
              </Text>

              <Pressable style={styles.payAppBtn} onPress={handleOpenUpi} testID="qr-open-app">
                <MaterialIcon name="cellphone-check" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.payAppText}>UPI ऐप में खोलें</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
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
  amountBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    width: "100%",
    marginBottom: spacing.md,
  },
  amountLabel: {
    fontSize: 11,
    color: colors.muted,
  },
  amountValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.brandPrimary,
  },
  customerName: {
    fontSize: 12,
    color: colors.onSurface,
    fontWeight: "600",
    marginTop: 2,
  },
  qrContainer: {
    width: 200,
    height: 200,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    padding: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  upiRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: spacing.md,
    gap: 8,
  },
  upiText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurface,
    maxWidth: 180,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandPrimary,
  },
  hintText: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 16,
  },
  payAppBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    width: "100%",
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  payAppText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
  noUpiBox: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  noUpiText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.warning,
    marginTop: spacing.sm,
  },
  noUpiSub: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
});
