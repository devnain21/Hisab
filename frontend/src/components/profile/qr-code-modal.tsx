import { useState } from "react";
import { View, Text, StyleSheet, Modal } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, spacing, radius } from "@/src/theme";
import * as Clipboard from "expo-clipboard";
import { Pressable } from "@/src/components/tap";
import { upiLink } from "@/src/lib/qr";
import { QrCode } from "@/src/components/qr-code";

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * High-Class QR Code & Payment Modal
 */
export function QrCodeModal({
  visible,
  onClose,
  shopName,
  title,
  upiId,
  onSetupUpi,
}: {
  visible: boolean;
  onClose: () => void;
  shopName: string;
  title: string;
  upiId: string;
  onSetupUpi: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const upiUrl = upiId ? upiLink(upiId, shopName) : "";

  const handleCopy = async () => {
    if (!upiId) return;
    if (await copyText(upiId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={qrStyles.overlay}>
        <View style={qrStyles.card}>
          <View style={qrStyles.header}>
            <Text style={qrStyles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="qr-close-btn">
              <MaterialIcon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          {upiId ? (
            <View style={qrStyles.content}>
              <Text style={qrStyles.shopName}>{shopName}</Text>
              <Text style={qrStyles.subtitle}>
                किसी भी UPI ऐप (PhonePe, GPay, Paytm) से स्कैन करें
              </Text>

              <View style={qrStyles.qrFrame}>
                <QrCode value={upiUrl} size={200} />
              </View>

              <View style={qrStyles.upiBox}>
                <Text style={qrStyles.upiLabel}>UPI ID: </Text>
                <Text style={qrStyles.upiVal} numberOfLines={1}>{upiId}</Text>
                <Pressable style={qrStyles.copyPill} onPress={handleCopy} hitSlop={10} accessibilityRole="button" accessibilityLabel="UPI ID कॉपी करें" testID="qr-copy-btn">
                  <Text style={qrStyles.copyPillText}>{copied ? "कॉपी हुआ" : "कॉपी"}</Text>
                </Pressable>
              </View>

              <Pressable style={qrStyles.doneBtn} onPress={onClose} testID="qr-done-btn">
                <Text style={qrStyles.doneBtnText}>ठीक है</Text>
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

export const qrStyles = StyleSheet.create({
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
    paddingHorizontal: spacing.md,
    minHeight: 28,
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  copyPillText: {
    fontSize: 12,
    lineHeight: 18,
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
