import { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Modal,
  Platform,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import * as Contacts from "expo-contacts/legacy";
import { colors, radius, spacing } from "@/src/theme";
import { Pressable } from "@/src/components/tap";
import { formatPhone } from "@/src/lib/format";

const cleanPhoneNumber = (raw: string): string => {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

/** System contact picker. null = cancelled / no permission, undefined = this phone has no picker. */
async function pickNativeContact(): Promise<{ name: string; phone: string } | null | undefined> {
  if (Platform.OS === "web") return undefined;
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Contacts की अनुमति दें", "सेटिंग्स में जाकर Contacts चालू करें।");
      return null;
    }
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return null;
    const name = [picked.firstName, picked.lastName].filter(Boolean).join(" ") || picked.name || "";
    const phone = cleanPhoneNumber(picked.phoneNumbers?.[0]?.number || "");
    return name || phone ? { name, phone } : null;
  } catch {
    return undefined;
  }
}

/** One tap: opens the phone's contact picker straight away, the in-app list only as a fallback. */
export function useContactPicker(onSelect: (name: string, phone: string) => void) {
  const [listOpen, setListOpen] = useState(false);
  const open = async () => {
    const res = await pickNativeContact();
    if (res === undefined) setListOpen(true);
    else if (res) onSelect(res.name, res.phone);
  };
  const modal = <ContactPickerModal visible={listOpen} onClose={() => setListOpen(false)} onSelect={onSelect} autoList />;
  return { open, modal };
}

export function ContactPickerModal({
  visible,
  onClose,
  onSelect,
  autoList,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (name: string, phone: string) => void;
  /** Load the phone's contact list as soon as it opens (the system picker was not available). */
  autoList?: boolean;
}) {
  const [inputText, setInputText] = useState("");
  const [clipboardSnippet, setClipboardSnippet] = useState<{ name: string; phone: string } | null>(null);
  const [phoneContacts, setPhoneContacts] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [searchContactQuery, setSearchContactQuery] = useState("");
  const [hasLoadedDeviceContacts, setHasLoadedDeviceContacts] = useState(false);

  const parseRawContact = (text: string) => {
    if (!text.trim()) return null;
    const digitsOnly = text.replace(/[^0-9]/g, "");
    const cleanPhone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : "";
    const cleanName = text
      .replace(/(\+91|91)?\s*[\d\s-]{10,15}/g, "")
      .replace(/[0-9]/g, "")
      .replace(/[^\w\s\u0900-\u097F]/gi, "")
      .trim();

    return {
      name: cleanName,
      phone: cleanPhone,
    };
  };

  // Clipboard check
  useEffect(() => {
    if (visible && Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      navigator.clipboard
        .readText()
        .then((txt) => {
          const parsed = parseRawContact(txt);
          if (parsed && (parsed.phone || parsed.name)) {
            setClipboardSnippet(parsed);
          }
        })
        .catch(() => {});
    }
  }, [visible]);

  const loadContactList = async () => {
    try {
      setLoadingContacts(true);
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Contacts की अनुमति दें", "सेटिंग्स में जाकर Contacts चालू करें।");
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });

      if (data && data.length > 0) {
        const formatted: Array<{ id: string; name: string; phone: string }> = [];
        for (const item of data) {
          const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || item.name || "";
          const phone = cleanPhoneNumber(item.phoneNumbers?.[0]?.number || "");
          if (name || phone) {
            formatted.push({ id: item.id || String(Math.random()), name, phone });
          }
        }
        setPhoneContacts(formatted);
        setHasLoadedDeviceContacts(true);
      } else {
        Alert.alert("कोई संपर्क नहीं मिला");
      }
    } catch {
      Alert.alert("संपर्क नहीं खुले", "नीचे नंबर पेस्ट करें।");
    } finally {
      setLoadingContacts(false);
    }
  };

  useEffect(() => {
    if (visible && autoList && Platform.OS !== "web" && !hasLoadedDeviceContacts) void loadContactList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoList]);

  const handleOpenPhoneContacts = async () => {
    const res = await pickNativeContact();
    if (res === undefined) return loadContactList();
    if (res) {
      onSelect(res.name, res.phone);
      onClose();
    }
  };

  const filteredContacts = useMemo(() => {
    const q = searchContactQuery.trim().toLowerCase();
    if (!q) return phoneContacts.slice(0, 50);
    return phoneContacts
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 50);
  }, [phoneContacts, searchContactQuery]);

  const handleApply = () => {
    const parsed = parseRawContact(inputText);
    if (parsed) {
      onSelect(parsed.name, parsed.phone);
      setInputText("");
      onClose();
    }
  };

  const currentParsed = parseRawContact(inputText);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>संपर्क चुनें</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="contact-picker-close">
              <MaterialIcon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {hasLoadedDeviceContacts ? null : (
          <Pressable
            style={styles.primaryNativeBtn}
            onPress={handleOpenPhoneContacts}
            disabled={loadingContacts}
            testID="open-device-contacts-btn"
          >
            {loadingContacts ? (
              <ActivityIndicator color={colors.onBrandPrimary} size="small" />
            ) : (
              <MaterialIcon name="contacts" size={22} color={colors.onBrandPrimary} />
            )}
            <Text style={styles.primaryNativeBtnText}>
              {loadingContacts ? "खुल रहा है..." : "फ़ोन के Contacts खोलें"}
            </Text>
          </Pressable>
          )}

          {/* If device contacts loaded, show instant search bar and list */}
          {hasLoadedDeviceContacts ? (
            <View style={styles.contactsListWrap}>
              <View style={styles.searchBar}>
                <MaterialIcon name="magnify" size={18} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="नाम या नंबर खोजें"
                  placeholderTextColor={colors.muted}
                  value={searchContactQuery}
                  onChangeText={setSearchContactQuery}
                  autoFocus
                />
                {searchContactQuery ? (
                  <Pressable onPress={() => setSearchContactQuery("")} hitSlop={8}>
                    <MaterialIcon name="close-circle" size={16} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>

              <FlatList
                data={filteredContacts}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 220 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.contactItem}
                    onPress={() => {
                      onSelect(item.name, item.phone);
                      onClose();
                    }}
                  >
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactInitial}>{(item.name || "C")[0].toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.contactName} numberOfLines={1}>
                        {item.name || "अनाम"}
                      </Text>
                      {item.phone ? (
                        <Text style={styles.contactPhone}>{formatPhone(item.phone)}</Text>
                      ) : null}
                    </View>
                    <MaterialIcon name="chevron-right" size={18} color={colors.muted} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={{ padding: spacing.md, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>कोई संपर्क नहीं मिला</Text>
                  </View>
                }
              />
            </View>
          ) : null}

          {/* Clipboard detected card */}
          {clipboardSnippet && clipboardSnippet.phone ? (
            <View style={styles.clipboardBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clipLabel}>कॉपी किया हुआ</Text>
                <Text style={styles.clipVal}>
                  {clipboardSnippet.name ? `${clipboardSnippet.name} · ` : ""}
                  {formatPhone(clipboardSnippet.phone)}
                </Text>
              </View>
              <Pressable
                style={styles.clipUseBtn}
                onPress={() => {
                  onSelect(clipboardSnippet.name, clipboardSnippet.phone);
                  onClose();
                }}
                testID="use-clipboard-btn"
              >
                <Text style={styles.clipUseText}>सीधा भरें</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Quick Paste or Manual Input */}
          <View style={styles.field}>
            <Text style={styles.label}>या पेस्ट करें</Text>
            <TextInput
              style={styles.input}
              placeholder="नाम और नंबर"
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              testID="contact-paste-input"
            />
          </View>

          {/* Live Preview */}
          {currentParsed && (currentParsed.phone || currentParsed.name) ? (
            <View style={styles.previewBox}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>नाम</Text>
                <Text style={styles.previewVal}>{currentParsed.name || "—"}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>मोबाइल</Text>
                <Text style={[styles.previewVal, { color: colors.brandPrimary, fontWeight: "800" }]}>
                  {currentParsed.phone ? formatPhone(currentParsed.phone) : "—"}
                </Text>
              </View>

              <Pressable
                style={[
                  styles.applyBtn,
                  !currentParsed.phone && !currentParsed.name && { opacity: 0.5 },
                ]}
                onPress={handleApply}
                testID="apply-contact-btn"
              >
                <MaterialIcon name="check" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.applyBtnText}>भरें</Text>
              </Pressable>
            </View>
          ) : null}
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
    maxHeight: "88%",
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
  primaryNativeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 13,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    elevation: 2,
  },
  primaryNativeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
  contactsListWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  contactAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInitial: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brandPrimary,
  },
  contactName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.onSurface,
  },
  contactPhone: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  clipboardBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  clipLabel: {
    fontSize: 11,
    color: colors.brandSecondary,
    fontWeight: "700",
  },
  clipVal: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: 2,
  },
  clipUseBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  clipUseText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
  field: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.onSurface,
  },
  previewBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewHeading: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    marginBottom: 4,
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  previewLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  previewVal: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.onSurface,
  },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  applyBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onBrandPrimary,
  },
});
