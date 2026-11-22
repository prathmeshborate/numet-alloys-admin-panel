import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const rawKey = process.env.FIREBASE_PRIVATE_KEY || "";
  const cleanedKey = rawKey
    .replace(/^["']|["']$/g, "") // strip accidental outer quotes
    .replace(/\\n/g, "\n");       // convert literal \n into real newlines

  return initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.replace(/^["']|["']$/g, ""),
      privateKey: cleanedKey,
    }),
  });
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());
export const adminMessaging = () => getMessaging(getAdminApp());