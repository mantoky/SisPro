/**
 * Firebase Web SDK — projeto sispro-e068c
 */

import { PILOT_ORG_ID } from "./site-contract.js";

export const ORG_ID = PILOT_ORG_ID;

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBhsLnn95ZWnTK8aTrv9iyBq4baasycSuM",
  authDomain: "sispro-e068c.firebaseapp.com",
  projectId: "sispro-e068c",
  storageBucket: "sispro-e068c.firebasestorage.app",
  messagingSenderId: "1082936787649",
  appId: "1:1082936787649:web:1c2b9e8c6fe1000f7b8a40",
};

export function isFirebaseConfigReady() {
  const c = FIREBASE_CONFIG;
  return Boolean(c.apiKey && c.projectId && c.appId);
}
