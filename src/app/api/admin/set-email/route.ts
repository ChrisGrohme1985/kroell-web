import { NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

function initAdmin() {
  if (getApps().length) return;
  // Beispiel: nutzt Service Account ENV Variablen
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export async function POST(req: Request) {
  try {
    initAdmin();

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    // Token verifizieren (optional: Admin-Check wie bei set-password)
    const decoded = await getAuth().verifyIdToken(token);

    const body = await req.json().catch(() => ({}));
    const uid = String(body?.uid || "").trim();
    const email = String(body?.email || "").trim();

    if (!uid) return NextResponse.json({ error: "uid fehlt" }, { status: 400 });
    if (!email || !email.includes("@")) return NextResponse.json({ error: "Ungültige E-Mail" }, { status: 400 });

    // OPTIONAL: hier euren Admin-Check einbauen (z.B. Firestore users/{decoded.uid}.role === "admin")

    await getAuth().updateUser(uid, { email });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Set email failed" }, { status: 500 });
  }
}
