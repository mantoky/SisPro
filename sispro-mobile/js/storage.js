/* Persistência local (Capacitor Preferences com fallback localStorage) */

import { Preferences } from "@capacitor/preferences";

const KEY_SESSION = "sispro_mobile_session";
const KEY_SITES = "sispro_mobile_sites";

async function prefGet(key) {
  try {
    const { value } = await Preferences.get({ key });
    return value;
  } catch {
    return localStorage.getItem(key);
  }
}

async function prefSet(key, value) {
  try {
    await Preferences.set({ key, value });
  } catch {
    localStorage.setItem(key, value);
  }
}

async function prefRemove(key) {
  try {
    await Preferences.remove({ key });
  } catch {
    localStorage.removeItem(key);
  }
}

export async function loadSession() {
  const raw = await prefGet(KEY_SESSION);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function saveSession(session) {
  await prefSet(KEY_SESSION, JSON.stringify(session));
}

export async function clearSession() {
  await prefRemove(KEY_SESSION);
}

export async function loadSites() {
  const raw = await prefGet(KEY_SITES);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveSites(sites) {
  await prefSet(KEY_SITES, JSON.stringify(sites || []));
}

export async function loadJSON(key, fallback = null) {
  const raw = await prefGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function saveJSON(key, value) {
  await prefSet(key, JSON.stringify(value));
}

export function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function nowIso() {
  return new Date().toISOString();
}
