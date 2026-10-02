import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/context/AuthContext";

export type Persona = "business" | "personal";

const KEY = "hisab_persona_v1";

export function usePersona() {
  const { user, setShop } = useAuth();
  const [persona, setPersonaState] = useState<Persona>((user?.persona as Persona) || "business");

  useEffect(() => {
    if (user?.persona) {
      setPersonaState(user.persona as Persona);
      return;
    }
    AsyncStorage.getItem(KEY).then((val) => {
      if (val === "personal" || val === "business") {
        setPersonaState(val);
      }
    }).catch(() => {});
  }, [user?.persona]);

  const setPersona = useCallback(
    async (next: Persona) => {
      setPersonaState(next);
      await AsyncStorage.setItem(KEY, next).catch(() => {});
      if (user) {
        await setShop({
          shop_name: user.shop_name || "",
          shop_phone: user.shop_phone || "",
          shop_address: user.shop_address || "",
          shop_gst: user.shop_gst || "",
          shop_upi: user.shop_upi || "",
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
      profileHeading: isPersonal ? "मेरी प्रोफ़ाइल / जानकारी" : "बिल पर क्या छपे",
      advance: isPersonal ? "देने हैं" : "एडवांस",
      shopName: isPersonal ? "आपका नाम" : "दुकान का नाम",
      shopAddress: isPersonal ? "पता (वैकल्पिक)" : "दुकान का पता (वैकल्पिक)",
      shopPhone: isPersonal ? "फ़ोन नंबर" : "दुकान का फ़ोन",
    },
  };
}
