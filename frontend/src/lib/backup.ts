// Full JSON copy of the khata that this app can read back, unlike the CSV which is only for viewing.
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { queryClient } from "@/src/query-client";
import { store, type Coll } from "@/src/lib/store";
import { todayISO } from "@/src/lib/format";

const COLLS: Coll[] = ["customers", "entries", "jobs", "aeps", "expenses", "moves"];
const FORMAT = "hisab-backup";

type Row = Record<string, unknown> & { id: string };
type BackupFile = { format: typeof FORMAT; version: 1; exportedAt: string; data: Record<Coll, Row[]> };

const rowsOf = (coll: Coll) => queryClient.getQueryData<Row[]>([coll]) ?? [];

export async function exportBackupJson(shopName: string): Promise<void> {
  const data = Object.fromEntries(COLLS.map((c) => [c, rowsOf(c)])) as Record<Coll, Row[]>;
  const body: BackupFile = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), data };
  const json = JSON.stringify(body);
  const fileName = `Hisab_Backup_${todayISO()}.json`;

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: `${shopName} का बैकअप` });
  }
}

export type RestorePlan = { rows: { coll: Coll; item: Row }[]; counts: Record<Coll, number> };

function parse(text: string): BackupFile {
  const body = JSON.parse(text) as Partial<BackupFile>;
  if (body?.format !== FORMAT || !body.data || typeof body.data !== "object") throw new Error("not-backup");
  return body as BackupFile;
}

/** Only rows missing from the app are added back; nothing current is changed or removed. */
function plan(backup: BackupFile): RestorePlan {
  const counts = Object.fromEntries(COLLS.map((c) => [c, 0])) as Record<Coll, number>;
  const rows: RestorePlan["rows"] = [];
  const valid = (r: unknown): r is Row => !!r && typeof r === "object" && typeof (r as Row).id === "string" && !!(r as Row).id;
  const incoming = (c: Coll) => (Array.isArray(backup.data[c]) ? backup.data[c].filter(valid) : []);
  const customerIds = new Set([...rowsOf("customers"), ...incoming("customers")].map((c) => c.id));
  const aepsIds = new Set([...rowsOf("aeps"), ...incoming("aeps")].map((t) => t.id));
  for (const coll of COLLS) {
    const have = new Set(rowsOf(coll).map((r) => r.id));
    for (const item of incoming(coll)) {
      if (have.has(item.id)) continue;
      // Khata rows need their customer; counter rows keep their money and just lose the link.
      const cid = typeof item.customerId === "string" ? item.customerId : "";
      if (coll === "entries" && !customerIds.has(cid)) continue;
      // A job without a customer is the shopkeeper's own task.
      if (coll === "jobs" && cid && !customerIds.has(cid)) continue;
      if (coll === "entries" && item.type === "aeps" && !aepsIds.has(String(item.linkId ?? ""))) continue;
      const row = coll === "aeps" && cid && !customerIds.has(cid) ? { ...item, customerId: "" } : item;
      rows.push({ coll, item: row });
      counts[coll]++;
    }
  }
  return { rows, counts };
}

/** Opens the file picker and reads a backup; null when the user backed out. */
export async function pickBackup(): Promise<RestorePlan | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ["application/json", "text/plain", "application/octet-stream"] });
  if (picked.canceled || !picked.result) return null;
  return plan(parse(await picked.result.text()));
}

export function applyRestore(p: RestorePlan) {
  return store.restoreMany(p.rows);
}
