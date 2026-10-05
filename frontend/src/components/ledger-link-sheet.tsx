import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import type { Customer } from "@/src/lib/data";
import { api } from "@/src/lib/api";
import { formatINR } from "@/src/lib/format";
import { shareMessage } from "@/src/lib/share-text";
import { confirmAction, showNotice } from "@/src/lib/confirm";
import { colors, radius, semantic, spacing } from "@/src/theme";
import { Button } from "@/src/components/ui";
import { DangerLink, PrimaryButton, SheetShell } from "@/src/components/sheets";

/** A read-only web page of this khata that the customer opens without the app; switching it off kills the link. */
export function LedgerLinkSheet({ customer, due, shopName, visible, onClose }: { customer: Customer; due: number; shopName: string; visible: boolean; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setToken(null);
    setFailed(false);
    api.getLedgerLink(customer.id).then((r) => setToken(r.token)).catch(() => setFailed(true));
  }, [visible, customer.id]);

  const url = token ? api.ledgerUrl(token) : "";
  const message = `नमस्ते ${customer.name} जी,\n${shopName ? `${shopName} में ` : ""}आपका पूरा हिसाब यहाँ देखें${due > 0 ? ` (बाकी ${formatINR(due)})` : ""}:\n${url}`;
  const phone = customer.phone.replace(/[^0-9]/g, "").slice(-10);

  const create = async () => {
    setBusy(true);
    try {
      setToken((await api.createLedgerLink(customer.id)).token);
    } catch {
      showNotice("लिंक नहीं बना", "इंटरनेट / सर्वर से जुड़ नहीं पाए। थोड़ी देर बाद फिर कोशिश करें।");
    } finally {
      setBusy(false);
    }
  };

  const revoke = () =>
    confirmAction("लिंक बंद करें?", "पहले भेजा गया लिंक खुलना बंद हो जाएगा। चाहें तो बाद में नया लिंक बना सकते हैं।", "बंद करें", async () => {
      try {
        await api.revokeLedgerLink(customer.id);
        setToken("");
      } catch {
        showNotice("बंद नहीं हुआ", "इंटरनेट / सर्वर से जुड़ नहीं पाए।");
      }
    });

  return (
    <SheetShell visible={visible} onClose={onClose} title="हिसाब का लिंक" testID="sheet-ledger-link">
      <Text style={styles.hint}>ग्राहक बिना ऐप के अपना पूरा हिसाब देख सकेगा — सिर्फ़ देखने के लिए, बदल नहीं सकता। नई एंट्री अपने-आप दिखेगी।</Text>
      {failed ? (
        <Text style={[styles.hint, { color: colors.error }]}>सर्वर से जुड़ नहीं पाए</Text>
      ) : token === null ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />
      ) : token === "" ? (
        <PrimaryButton label="लिंक बनाएँ" onPress={create} saving={busy} testID="ledger-link-create" />
      ) : (
        <>
          <View style={styles.urlBox}>
            <Text style={styles.url} selectable numberOfLines={2}>{url}</Text>
          </View>
          {phone.length === 10 ? (
            <Button
              label="WhatsApp पर भेजें"
              icon="whatsapp"
              onPress={() => Linking.openURL(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`)}
              style={{ backgroundColor: semantic.whatsapp, marginBottom: spacing.sm }}
              testID="ledger-link-wa"
            />
          ) : null}
          <Button label="दूसरे तरीके से भेजें / कॉपी" icon="share-variant" variant="secondary" onPress={() => void shareMessage(message)} testID="ledger-link-share" />
          <DangerLink label="लिंक बंद करें" onPress={revoke} testID="ledger-link-revoke" />
        </>
      )}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, marginBottom: spacing.md, lineHeight: 19 },
  urlBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  url: { fontSize: 13, color: colors.onSurface },
});
