import { useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Alert } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatINR, formatDate } from "@/src/lib/format";
import { shareDayCloseReport, type DaySummaryData } from "@/src/lib/day-close";

export function DayCloseModal({
  visible,
  onClose,
  data,
}: {
  visible: boolean;
  onClose: () => void;
  data: DaySummaryData;
}) {
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareDayCloseReport(data);
    } catch {
      Alert.alert("शेयर नहीं हुआ", "कृपया दोबारा कोशिश करें।");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>🌙 दुकान बंद रिपोर्ट (Day Close)</Text>
              <Text style={styles.subtitle}>{formatDate(data.date)} · आज का अंतिम हिसाब</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="day-close-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {/* Top Stat Cards */}
            <View style={styles.topStatsRow}>
              <View style={[styles.topStatCard, { backgroundColor: colors.brandTertiary }]}>
                <Text style={styles.statLabel}>कुल काम / बिक्री</Text>
                <Text style={[styles.statValue, { color: colors.brandPrimary }]}>
                  {formatINR(data.workTotal)}
                </Text>
              </View>
              <View style={[styles.topStatCard, { backgroundColor: colors.successSoft }]}>
                <Text style={styles.statLabel}>कुल वसूली (मिले)</Text>
                <Text style={[styles.statValue, { color: colors.success }]}>
                  {formatINR(data.workCash + data.workOnline + data.paymentCash + data.paymentOnline)}
                </Text>
              </View>
            </View>

            {/* Work & Profit Card */}
            <View style={styles.card}>
              <Text style={styles.cardHeading}>💼 काम, पोर्टल फीस व बचत</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>कुल काम बिल:</Text>
                <Text style={styles.rowVal}>{formatINR(data.workTotal)}</Text>
              </View>
              {data.workFees > 0 ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>पोर्टल / सरकारी फीस:</Text>
                    <Text style={[styles.rowVal, { color: colors.error }]}>-{formatINR(data.workFees)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>काम से शुद्ध बचत:</Text>
                    <Text style={[styles.rowVal, { fontWeight: "800", color: colors.brandPrimary }]}>
                      {formatINR(data.workProfit || (data.workTotal - data.workFees))}
                    </Text>
                  </View>
                </>
              ) : null}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>नकद प्राप्त:</Text>
                <Text style={[styles.rowVal, { color: colors.success }]}>{formatINR(data.workCash)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>ऑनलाइन / UPI:</Text>
                <Text style={[styles.rowVal, { color: colors.info }]}>{formatINR(data.workOnline)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>आज की नई उधारी:</Text>
                <Text style={[styles.rowVal, { color: colors.warning }]}>{formatINR(data.workUdhaar)}</Text>
              </View>
            </View>

            {/* Galla & Bank Breakdown */}
            <View style={styles.card}>
              <Text style={styles.cardHeading}>💵 नकद गल्ला स्थिति</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>सुबह का गल्ला:</Text>
                <Text style={styles.rowVal}>{formatINR(data.openingCash)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>शाम को होना चाहिए:</Text>
                <Text style={[styles.rowVal, { fontWeight: "800", color: colors.brandPrimary }]}>
                  {formatINR(data.expectedCash)}
                </Text>
              </View>
              {data.countedCash !== null ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>गिने हुए नोट:</Text>
                  <Text style={[styles.rowVal, { fontWeight: "800" }]}>{formatINR(data.countedCash)}</Text>
                </View>
              ) : null}
              {data.cashDiff !== null ? (
                <View
                  style={[
                    styles.diffBadge,
                    {
                      backgroundColor:
                        data.cashDiff === 0 ? colors.successSoft : colors.errorSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.diffText,
                      { color: data.cashDiff === 0 ? colors.success : colors.error },
                    ]}
                  >
                    {data.cashDiff === 0
                      ? "गल्ला मिलान: बिल्कुल सही ✅"
                      : data.cashDiff > 0
                      ? `अंतर: ${formatINR(data.cashDiff)} ज़्यादा हैं`
                      : `अंतर: ${formatINR(-data.cashDiff)} कम हैं`}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardHeading}>📱 ऑनलाइन बैंक / UPI खाता</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>सुबह का बैलेंस:</Text>
                <Text style={styles.rowVal}>{formatINR(data.openingBank)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>शाम को होना चाहिए:</Text>
                <Text style={[styles.rowVal, { fontWeight: "800", color: colors.info }]}>
                  {formatINR(data.expectedBank)}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardHeading}>☕ दुकान का खर्च व नई उधारी</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>कुल दुकान खर्च:</Text>
                <Text style={[styles.rowVal, { color: colors.warning }]}>
                  {formatINR(data.expenseCash + data.expenseOnline)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>आज की नई उधारी:</Text>
                <Text style={[styles.rowVal, { color: colors.error }]}>
                  {formatINR(data.workUdhaar)}
                </Text>
              </View>
            </View>

            {/* Share Button */}
            <Pressable
              style={styles.shareBtn}
              onPress={handleShare}
              disabled={sharing}
              testID="day-close-share-btn"
            >
              <MaterialIcon name="whatsapp" size={22} color="#FFFFFF" />
              <Text style={styles.shareBtnText}>
                {sharing ? "भेज रहे हैं..." : "WhatsApp पर रिपोर्ट भेजें"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "92%",
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
  topStatsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  topStatCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  statLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
  },
  rowLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  rowVal: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.onSurface,
  },
  diffBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  diffText: {
    fontSize: 12,
    fontWeight: "700",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#128C7E",
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
