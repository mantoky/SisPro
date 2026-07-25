/* Autenticação operacional — Firebase Auth + modo campo offline */

import { loadSession, saveSession, clearSession, nowIso } from "./storage.js";
import {
  firebaseReady,
  firebaseSignIn,
  firebaseSignOut,
} from "./firebase-bridge.js";
import { isFirebaseConfigReady } from "./firebase-config.js";

let _session = null;

export function getSession() {
  return _session;
}

export async function restoreSession() {
  _session = await loadSession();
  return _session;
}

export function isFirebaseConfigured() {
  return isFirebaseConfigReady() && firebaseReady();
}

/**
 * Login.
 * - Com Firebase configurado: Auth e-mail/senha → sessão online.
 * - Sem Firebase: sessão local de campo (demo/offline).
 */
export async function login(email, senha) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !senha) throw new Error("Informe e-mail e senha.");

  if (isFirebaseConfigured()) {
    const user = await firebaseSignIn(mail, senha);
    _session = {
      ...user,
      loggedAt: nowIso(),
    };
    await saveSession(_session);
    return _session;
  }

  _session = {
    uid: "local-" + btoa(mail).replace(/=+/g, "").slice(0, 16),
    email: mail,
    nome: mail.split("@")[0] || "Técnico",
    modo: "campo",
    loggedAt: nowIso(),
  };
  await saveSession(_session);
  return _session;
}

export async function loginDemo() {
  _session = {
    uid: "campo-offline",
    email: "campo@local",
    nome: "Técnico de campo",
    modo: "campo",
    loggedAt: nowIso(),
  };
  await saveSession(_session);
  return _session;
}

export async function logout() {
  try {
    if (isFirebaseConfigured() && _session?.modo === "online") {
      await firebaseSignOut();
    }
  } catch {
    /* ignore */
  }
  _session = null;
  await clearSession();
}
