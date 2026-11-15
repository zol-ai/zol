import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function getMissingAdminEnv() {
  const missing: string[] = [];
  if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");

  const hasClientEmail = Boolean(process.env.FIREBASE_CLIENT_EMAIL);
  const hasPrivateKey = Boolean(process.env.FIREBASE_PRIVATE_KEY);
  if (hasClientEmail !== hasPrivateKey) {
    missing.push(hasClientEmail ? "FIREBASE_PRIVATE_KEY" : "FIREBASE_CLIENT_EMAIL");
  }
  return missing;
}

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const missing = getMissingAdminEnv();
  if (missing.length) {
    throw new Error(`Missing Firebase Admin environment variables: ${missing.join(", ")}`);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const credential =
    clientEmail && privateKey
      ? cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        })
      : applicationDefault();

  return initializeApp({ credential, projectId });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}
