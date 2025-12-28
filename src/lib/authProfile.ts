import { db } from "@/lib/firebase";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";

export type Role = "admin" | "user";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  firstName: string;
  lastName: string;
};

function safeDisplayName(u: User) {
  return u.displayName || u.email || "User";
}

/**
 * Wichtig:
 * - User-Profil wird IMMER unter /users/{uid} gespeichert (Dokument-ID = auth.uid)
 * - Damit funktionieren die Firestore Rules (isAdmin() liest genau diesen Pfad)
 */
export async function getOrCreateUserProfile(user: User): Promise<UserProfile> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const initial: UserProfile = {
      uid: user.uid,
      email: user.email ?? "",
      displayName: safeDisplayName(user),
      role: "user",
      firstName: "",
      lastName: "",
    };

    await setDoc(ref, {
      ...initial,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return initial;
  }

  const d = snap.data() as any;

  // optional: sync displayName/email falls sich bei Firebase Auth was ändert
  const newEmail = user.email ?? "";
  const newDisplay = safeDisplayName(user);

  const needsSync = (d.email ?? "") !== newEmail || (d.displayName ?? "") !== newDisplay;
  if (needsSync) {
    await updateDoc(ref, {
      email: newEmail,
      displayName: newDisplay,
      updatedAt: serverTimestamp(),
    });
  }

  return {
    uid: user.uid,
    email: d.email ?? newEmail,
    displayName: d.displayName ?? newDisplay,
    role: (d.role ?? "user") as Role,
    firstName: d.firstName ?? "",
    lastName: d.lastName ?? "",
  };
}
