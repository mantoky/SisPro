/* Autenticação operacional — Firebase Auth + modo campo offline */

import { loadSession, saveSession, clearSession, nowIso } from "./storage.js";
import {
  firebaseReady,
  firebaseSignIn,
  firebaseSignOut,
  getFirebaseAuth,
  getFirebaseApp,
  waitForAuthReady,
} from "./firebase-bridge.js";
import { isFirebaseConfigReady } from "./firebase-config.js";

let _session = null;

export function getSession() {
  return _session;
}

export async function restoreSession() {
  _session = await loadSession();
  // Sessão "online" sem Firebase Auth ativo não sincroniza — força novo login.
  if (_session?.modo === "online" && isFirebaseConfigured()) {
    const user = await waitForAuthReady();
    if (!user) {
      _session = null;
      await clearSession();
    }
  }
  return _session;
}

export function isFirebaseConfigured() {
  return isFirebaseConfigReady() && firebaseReady();
}

/** Pode gravar no Firestore? (não basta sessão local — precisa Auth Firebase). */
export function canSyncToPlatform() {
  if (!isFirebaseConfigured()) return false;
  if (!_session || _session.modo === "campo") return false;
  getFirebaseApp();
  return Boolean(getFirebaseAuth()?.currentUser);
}

export function syncBlockReason() {
  if (!isFirebaseConfigured()) {
    return "Firebase não configurado. Verifique js/firebase-config.js.";
  }
  if (!_session) return "Faça login para sincronizar.";
  if (_session.modo === "campo") {
    return "Modo campo (offline) não sincroniza. Saia e entre com e-mail e senha Firebase.";
  }
  getFirebaseApp();
  if (!getFirebaseAuth()?.currentUser) {
    return "Sessão expirada. Faça login novamente com e-mail e senha.";
  }
  return "";
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
