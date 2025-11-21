import { Store } from "@tauri-apps/plugin-store";

export const store = await Store.load("store.bin");
