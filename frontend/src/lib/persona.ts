import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/context/AuthContext";
import { useCustomers } from "@/src/lib/data";

export type Persona = "business" | "personal";

const KEY = "hisab_persona_v1";

export function usePersona() {
  const { user, setShop } = useAuth();
  const customers = useCustomers().data;
  const [stored, setStored] = useState<Persona | null>(null);

  useEffect(() => {
    if (user?.persona) return;
    AsyncStorage.getItem(KEY).then((val) => {
      if (val === "personal" || val === "business") setStored(val);
    }).catch(() => {});
  }, [user?.persona]);

  // A shop exists once it has a name, or for older accounts that already keep shop customers.
  const hasShop = !!user?.shop_name || user?.persona === "business" || (customers ?? []).some((c) => c.persona !== "personal");
  const persona: Persona = hasShop ? (user?.persona as Persona) || stored || "business" : "personal";

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
    hasShop,
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
      cash: isPersonal ? "कैश" : "गल्ला",
    },
  };
}

/** The name to show and print for this account: the shop in business mode, the person in personal mode. */
export function accountName(user: { name?: string; shop_name?: string; owner_name?: string; persona?: string } | null | undefined): string {
  if (!user) return "";
  if (user.persona === "personal" || !user.shop_name) return user.owner_name || user.name || "";
  return user.shop_name;
}
