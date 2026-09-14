// Imported FIRST by the device, before the Supabase client captures fetch:
// a switch the scenarios flip to take this "device" offline.
const realFetch = globalThis.fetch;
globalThis.__offline = false;
globalThis.fetch = (...args) =>
  globalThis.__offline ? Promise.reject(new TypeError('fetch failed')) : realFetch(...args);
