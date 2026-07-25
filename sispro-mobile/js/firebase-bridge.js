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

/**
 * Upsert sites no Firestore (motor de injeção SisPro).
 * @param {object[]} bundle — payloads toDesktopSitePayload()
 */
export async function pushSitesToFirestore(bundle) {
  if (!firebaseReady()) {
    throw new Error("Firebase config incompleta.");
  }
  const db = getDb();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid || "anonymous";
  const list = Array.isArray(bundle) ? bundle : [];
  if (!list.length) return { ok: true, enviados: 0 };

  for (const site of list) {
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
  }

  // registra dispositivo
  if (uid && uid !== "anonymous") {
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

  return { ok: true, enviados: list.length };
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
  const uid = auth?.currentUser?.uid || "campo";
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
