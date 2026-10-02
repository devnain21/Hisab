import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/context/AuthContext";

export type Persona = "business" | "personal";

const KEY = "hisab_persona_v1";

export function usePersona() {
  const { user, setShop } = useAuth();
  const [stored, setStored] = useState<Persona | null>(null);

  useEffect(() => {
    if (user?.persona) return;
    AsyncStorage.getItem(KEY).then((val) => {
      if (val === "personal" || val === "business") setStored(val);
    }).catch(() => {});
  }, [user?.persona]);

  const persona: Persona = (user?.persona as Persona) || stored || "business";

  const setPersona = useCallback(
    async (next: Persona) => {
      setStored(next);
      await AsyncStorage.setItem(KEY, next).catch(() => {});
      if (user) {
        await setShop({
          shop_name: user.shop_name || "",
          shop_phone: user.shop_phone || "",
          shop_address: user.shop_address || "",
          shop_gst: user.shop_gst || "",
          shop_upi: user.shop_upi || "",
          owner_name: user.owner_name || "",
          persona: next,
        }).catch(() => {});
      }
    },
    [user, setShop]
  );

  const isPersonal = persona === "personal";

  return {
    persona,
    isPersonal,
    setPersona,
    labels: {
      customer: isPersonal ? "व्यक्ति" : "ग्राहक",
      customers: isPersonal ? "लोग" : "ग्राहक",
      newCustomer: isPersonal ? "नया व्यक्ति जोड़ें" : "नया ग्राहक जोड़ें",
      work: isPersonal ? "लेन-देन" : "काम",
      newWork: isPersonal ? "हिसाब लिखें" : "काम लिखें",
      profileHeading: isPersonal ? "मेरी जानकारी" : "दुकान की जानकारी",
      advance: isPersonal ? "देने हैं" : "एडवांस",
      shopName: isPersonal ? "आपका नाम" : "दुकान का नाम",
      shopAddress: isPersonal ? "पता (वैकल्पिक)" : "दुकान का पता (वैकल्पिक)",
      shopPhone: isPersonal ? "फ़ोन नंबर" : "दुकान का फ़ोन",
    },
  };
}

/** The name to show and print for this account: the shop in business mode, the person in personal mode. */
export function accountName(user: { name?: string; shop_name?: string; owner_name?: string; persona?: string } | null | undefined): string {
  if (!user) return "";
  if (user.persona === "personal") return user.owner_name || user.name || "";
  return user.shop_name || "";
}
