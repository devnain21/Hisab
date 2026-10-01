import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hisab_counter_v1";

/** Counter services (cash drawer) are on unless the person turns them off. A home ledger does not need them. */
export function useCounterMode() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (v === "0") setOn(false); }).catch(() => {});
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setOn(next);
    await AsyncStorage.setItem(KEY, next ? "1" : "0");
  }, []);

  return { on, toggle };
}
