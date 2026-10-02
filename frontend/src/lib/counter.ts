import { usePersona } from "@/src/lib/persona";

/** Counter services (AEPS, cash drawer) belong to a shop; a personal ledger has none. */
export function useCounterMode() {
  const { isPersonal } = usePersona();
  return { on: !isPersonal };
}
