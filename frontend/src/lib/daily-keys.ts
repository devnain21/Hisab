import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayISO } from "@/src/lib/format";

const DAILY_KEY = /^hisab_(?:counted_cash_[a-z]+|portal_bank)_(\d{4}-\d{2}-\d{2})$/;
const KEEP_DAYS = 60;

/** Counted-cash and portal-balance notes are saved per day; drop the ones nobody will look at again. */
export async function pruneDailyKeys(): Promise<void> {
  try {
    const cutoff = todayISO(-KEEP_DAYS);
    const keys = await AsyncStorage.getAllKeys();
    const old = keys.filter((k) => {
      const m = DAILY_KEY.exec(k);
      return !!m && m[1] < cutoff;
    });
    if (old.length) await AsyncStorage.multiRemove(old);
  } catch {}
}
