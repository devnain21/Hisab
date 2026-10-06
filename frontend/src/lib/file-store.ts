// Large JSON blobs (offline khata copy, recycle bin) live in app files: AsyncStorage on Android
// caps a single value at ~2 MB, which a few months of entries can cross.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const DIR_NAME = "hisab-data";
const native = Platform.OS !== "web";
const queues = new Map<string, Promise<unknown>>();

function makeStore(dirName: string) {
  const dir = () => {
    const d = new Directory(Paths.document, dirName);
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  };
  const mainFile = (key: string) => new File(dir(), `${key}.json`);
  const tmpFile = (key: string) => new File(dir(), `${key}.json.tmp`);

  /** Runs file work for one key in order, so a slow write never lands after a newer one. */
  const serial = <T,>(key: string, job: () => Promise<T>): Promise<T> => {
    const qk = `${dirName}/${key}`;
    const prev = queues.get(qk) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    queues.set(qk, next);
    return next;
  };

  const writeFile = async (key: string, value: string) => {
    const tmp = tmpFile(key);
    tmp.create({ intermediates: true, overwrite: true });
    tmp.write(value);
    await tmp.move(mainFile(key), { overwrite: true });
  };

  return { mainFile, tmpFile, serial, writeFile };
}

const data = makeStore(DIR_NAME);
const keep = makeStore("hisab-kept");

export const fileStore = {
  getItem(key: string): Promise<string | null> {
    if (!native) return AsyncStorage.getItem(key);
    return data.serial(key, async () => {
      try {
        const main = data.mainFile(key);
        if (main.exists) return await main.text();
        // A crash between writing and renaming leaves only the finished temp file.
        const tmp = data.tmpFile(key);
        if (tmp.exists) return await tmp.text();
      } catch {}
      // Older app versions kept this value in AsyncStorage; move it over once.
      const legacy = await AsyncStorage.getItem(key).catch(() => null);
      if (legacy != null) {
        try {
          await data.writeFile(key, legacy);
          await AsyncStorage.removeItem(key);
        } catch {}
      }
      return legacy;
    });
  },
  setItem(key: string, value: string): Promise<void> {
    if (!native) return AsyncStorage.setItem(key, value);
    return data.serial(key, () => data.writeFile(key, value));
  },
  removeItem(key: string): Promise<void> {
    if (!native) return AsyncStorage.removeItem(key);
    return data.serial(key, async () => {
      for (const f of [data.mainFile(key), data.tmpFile(key)]) if (f.exists) f.delete();
      await AsyncStorage.removeItem(key).catch(() => {});
    });
  },
};

/** Survives sign-out (clearFileStore): changes parked for an account until it signs in again. Errors are thrown. */
export const keepStore = {
  async getItem(key: string): Promise<string | null> {
    if (!native) return AsyncStorage.getItem(key);
    return keep.serial(key, async () => {
      const main = keep.mainFile(key);
      if (main.exists) return await main.text();
      const tmp = keep.tmpFile(key);
      return tmp.exists ? await tmp.text() : null;
    });
  },
  setItem(key: string, value: string): Promise<void> {
    if (!native) return AsyncStorage.setItem(key, value);
    return keep.serial(key, () => keep.writeFile(key, value));
  },
  removeItem(key: string): Promise<void> {
    if (!native) return AsyncStorage.removeItem(key);
    return keep.serial(key, async () => {
      for (const f of [keep.mainFile(key), keep.tmpFile(key)]) if (f.exists) f.delete();
    });
  },
};

/** Sign-out: nothing of this account may stay on the device. */
export async function clearFileStore() {
  await Promise.all([...queues.values()].map((p) => p.catch(() => {})));
  queues.clear();
  if (!native) return;
  try {
    const d = new Directory(Paths.document, DIR_NAME);
    if (d.exists) d.delete();
  } catch {}
}
