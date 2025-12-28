import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Erwartete ENV Variablen:
 * - FIREBASE_ADMIN_PROJECT_ID
 * - FIREBASE_ADMIN_CLIENT_EMAIL
 * - FIREBASE_ADMIN_PRIVATE_KEY   (mit \n im String)
 * - FIREBASE_ADMIN_STORAGE_BUCKET (z.B. "kroell-app.firebasestorage.app" oder "dein-projekt.appspot.com")
 */
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
const storageBucket = process.env.FIREBASE_ADMIN_STORAGE_BUCKET;

if (!projectId || !clientEmail || !privateKeyRaw) {
  throw new Error(
    "Firebase Admin ENV fehlt. Bitte setze FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY."
  );
}

if (!storageBucket) {
  throw new Error(
    "Firebase Admin ENV fehlt: FIREBASE_ADMIN_STORAGE_BUCKET (z.B. kroell-app.firebasestorage.app)."
  );
}

const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        storageBucket, // ✅ hier korrekt gesetzt
      });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

export const adminStorage = getStorage(adminApp);
export const adminBucket = adminStorage.bucket(); // ✅ nutzt default bucket aus storageBucket
