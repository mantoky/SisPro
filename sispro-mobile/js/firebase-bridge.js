/**
 * Bridge Firebase Auth + Firestore
 * Collection: orgs/{orgId}/sites/{siteId}
 * Devices:   orgs/{orgId}/devices/{uid}
 */

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { FIREBASE_CONFIG, ORG_ID, isFirebaseConfigReady } from "./firebase-config.js";

let _app = null;
let _auth = null;
let _db = null;

export function firebaseReady() {
  return isFirebaseConfigReady();
}

export function getFirebaseApp() {
  if (!firebaseReady()) return null;
  if (!_app) {
    _app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _db = getFirestore(_app);
  }
  return _app;
}

export function getFirebaseAuth() {
  getFirebaseApp();
  return _auth;
}

export function getDb() {
  getFirebaseApp();
  return _db;
}

export async function firebaseSignIn(email, password) {
  if (!firebaseReady()) {
    throw new Error("Cole a apiKey/appId em js/firebase-config.js (Console Firebase → Config).");
  }
  getFirebaseApp();
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  const user = cred.user;
  return {
    uid: user.uid,
    email: user.email || email,
    nome: (user.email || email).split("@")[0] || "Técnico",
    modo: "online",
    orgId: ORG_ID,
  };
}

export async function firebaseSignOut() {
  if (!_auth) return;
  await signOut(_auth);
}

export function watchAuth(cb) {
  if (!firebaseReady()) {
    cb(null);
    return () => {};
  }
  getFirebaseApp();
  return onAuthStateChanged(_auth, cb);
}

/** Aguarda o primeiro evento de Auth (persistência do Firebase). */
export function waitForAuthReady() {
  if (!firebaseReady()) return Promise.resolve(null);
  getFirebaseApp();
  if (_auth.currentUser) return Promise.resolve(_auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(_auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/**
 * Upsert sites no Firestore (motor de injeção SisPro).
 * @param {object[]} bundle — payloads toDesktopSitePayload()
 */
export function mapFirestoreError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  if (Array.isArray(err?.partialOk) && err.partialOk.length) {
    return `${msg || "Falha no meio do sync."} (${err.partialOk.length} site(s) já gravado(s); os restantes ficam pendentes.)`;
  }
  if (code.includes("permission-denied") || /insufficient permissions|Missing or insufficient/i.test(msg)) {
    return "Permissão insuficiente no Firestore. Use login com e-mail/senha (não modo campo) e publique as regras: firebase deploy --only firestore:rules";
  }
  if (code.includes("unauthenticated") || /unauth/i.test(msg)) {
    return "Não autenticado no Firebase. Faça login com e-mail e senha novamente.";
  }
  if (code.includes("unavailable") || /network|offline/i.test(msg)) {
    return "Firestore indisponível ou sem rede. Tente novamente quando estiver online.";
  }
  return msg || "Falha ao enviar para o Firestore.";
}

export async function pushSitesToFirestore(bundle) {
  if (!firebaseReady()) {
    throw new Error("Firebase config incompleta.");
  }
  const db = getDb();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid;
  if (!uid) {
    throw new Error("Não autenticado no Firebase. Faça login com e-mail e senha (não modo campo).");
  }
  const list = Array.isArray(bundle) ? bundle : [];
  if (!list.length) return { ok: true, enviados: 0, enviadosIds: [] };

  const enviadosIds = [];

  for (const site of list) {
    try {
      const siteId = site.id;
      const ref = doc(db, "orgs", ORG_ID, "sites", siteId);
      await setDoc(
        ref,
        {
          ...site,
          orgId: ORG_ID,
          meta: {
            ...(site.metaMobile || {}),
            origem: "sispro-mobile",
            lastSyncedBy: uid,
            orgId: ORG_ID,
          },
          sync: {
            status: "synced",
            lastSyncedAt: serverTimestamp(),
            revision: Date.now(),
          },
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      );

      // Envelope leve para o watcher/desktop (subscription)
      const inboxId = `${site.codigo || siteId}_${Date.now()}`;
      const inboxRef = doc(db, "orgs", ORG_ID, "inbox", inboxId);
      await setDoc(inboxRef, {
        orgId: ORG_ID,
        siteId,
        siteCodigo: site.codigo,
        siteNome: site.nome,
        prontuarioStatus: site.prontuarioStatus || "em_campo",
        tipo: site.prontuarioStatus === "enviado_pelo_tecnico" ? "envio_revisao" : "sync_site",
        revision: Date.now(),
        deviceUid: uid,
        itensCount: Array.isArray(site.items) ? site.items.length : 0,
        createdAt: serverTimestamp(),
        status: "pending",
        payloadRef: `orgs/${ORG_ID}/sites/${siteId}`,
      });

      enviadosIds.push(siteId);
    } catch (err) {
      const partial = new Error(
        enviadosIds.length
          ? `Sync parcial: ${enviadosIds.length} ok; falhou em ${site?.id || "?"}: ${err?.message || err}`
          : (err?.message || String(err))
      );
      partial.code = err?.code;
      partial.partialOk = enviadosIds.slice();
      partial.cause = err;
      throw partial;
    }
  }

  // registra dispositivo
  if (uid && enviadosIds.length) {
    const devRef = doc(db, "orgs", ORG_ID, "devices", uid);
    await setDoc(
      devRef,
      {
        uid,
        lastSyncAt: serverTimestamp(),
        app: "sispro-mobile",
        version: "1.0.0",
        orgId: ORG_ID,
      },
      { merge: true }
    );
  }

  return { ok: true, enviados: enviadosIds.length, enviadosIds };
}

/**
 * Grava rodada de campo (espelho futuro do SisPro).
 */
export async function pushRodadaToFirestore(rodada) {
  if (!firebaseReady()) {
    throw new Error("Firebase config incompleta.");
  }
  const db = getDb();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid;
  if (!uid) {
    throw new Error("Não autenticado no Firebase. Faça login com e-mail e senha.");
  }
  const ref = doc(db, "orgs", ORG_ID, "rodadas", rodada.id);
  await setDoc(
    ref,
    {
      ...rodada,
      orgId: ORG_ID,
      createdBy: uid,
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
}
