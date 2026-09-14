// AsyncStorage for Node: an in-memory map mirrored to a JSON file, so one
// "device" keeps its storage across separate process runs (DEVICE_STATE).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.env.DEVICE_STATE;
const data = new Map(file && existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8'))) : []);
const save = () => {
  if (file) writeFileSync(file, JSON.stringify(Object.fromEntries(data)));
};

const AsyncStorage = {
  getItem: async (k) => (data.has(k) ? data.get(k) : null),
  setItem: async (k, v) => {
    data.set(k, String(v));
    save();
  },
  removeItem: async (k) => {
    data.delete(k);
    save();
  },
  getAllKeys: async () => [...data.keys()],
  multiRemove: async (keys) => {
    for (const k of keys) data.delete(k);
    save();
  },
  clear: async () => {
    data.clear();
    save();
  },
};

export default AsyncStorage;
