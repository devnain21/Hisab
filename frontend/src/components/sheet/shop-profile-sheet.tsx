import { useState, useEffect } from "react";
import { Text, TextInput } from "react-native";
import { colors } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";
import { usePersona } from "@/src/lib/persona";
import { SheetShell, Field, inputStyle, PrimaryButton, styles } from "./parts";

export function ShopProfileSheet({ visible, onClose, openShop }: { visible: boolean; onClose: () => void; openShop?: boolean }) {
  const { user, setShop } = useAuth();
  const isPersonal = usePersona().isPersonal && !openShop;
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gst, setGst] = useState("");
  const [upi, setUpi] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setShopName(user?.shop_name ?? "");
      setOwnerName(user?.owner_name || user?.name || "");
      setPhone(user?.shop_phone ?? "");
      setAddress(user?.shop_address ?? "");
      setGst(user?.shop_gst ?? "");
      setUpi(user?.shop_upi ?? "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const valid = isPersonal ? !!ownerName.trim() : !!shopName.trim();

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await setShop({
        shop_name: shopName.trim(),
        owner_name: ownerName.trim(),
        shop_phone: phone.trim(),
        shop_address: address.trim(),
        shop_gst: gst.trim().toUpperCase(),
        shop_upi: upi.trim(),
        persona: isPersonal ? "personal" : "business",
      });
      onClose();
    } catch {
      setError("सर्वर पर सेव नहीं हुआ, दोबारा कोशिश करें।");
    } finally { setSaving(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title={openShop ? "दुकान खाता खोलें" : isPersonal ? "मेरी जानकारी" : "दुकान की जानकारी"} testID="sheet-shop-name">
      {isPersonal ? null : (
        <Field label="दुकान का नाम">
          <TextInput style={inputStyle} value={shopName} onChangeText={setShopName} placeholder="दुकान का नाम" placeholderTextColor={colors.muted} maxLength={60} testID="input-shop-name" />
        </Field>
      )}
      <Field label="आपका नाम">
        <TextInput style={inputStyle} value={ownerName} onChangeText={setOwnerName} placeholder="आपका नाम" placeholderTextColor={colors.muted} maxLength={60} testID="input-owner-name" />
      </Field>
      <Field label="फ़ोन">
        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-phone" />
      </Field>
      <Field label="UPI ID">
        <TextInput style={inputStyle} value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder="9876543210@upi" placeholderTextColor={colors.muted} maxLength={50} testID="input-shop-upi" />
      </Field>
      <Field label="पता (वैकल्पिक)">
        <TextInput style={inputStyle} value={address} onChangeText={setAddress} maxLength={120} placeholderTextColor={colors.muted} testID="input-shop-address" />
      </Field>
      {isPersonal ? null : (
        <Field label="GST नंबर (वैकल्पिक)">
          <TextInput style={inputStyle} value={gst} onChangeText={setGst} autoCapitalize="characters" maxLength={20} placeholderTextColor={colors.muted} testID="input-shop-gst" />
        </Field>
      )}
      {error ? <Text style={[styles.hint, { color: colors.error }]}>{error}</Text> : null}
      <PrimaryButton label="सेव करें" onPress={save} disabled={!valid} saving={saving} testID="save-shop-name-btn" />
    </SheetShell>
  );
}
