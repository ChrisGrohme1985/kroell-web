import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function isAdminUid(uid: string, decoded: any) {
  if (decoded?.admin === true || decoded?.role === "admin") return true;
  const snap = await adminDb.collection("users").doc(uid).get();
  return String(snap.data()?.role ?? "") === "admin";
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const ok = await isAdminUid(decoded.uid, decoded);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const uid = String(body?.uid ?? "").trim();
    if (!uid) return NextResponse.json({ error: "Missing uid" }, { status: 400 });

    if (uid === decoded.uid) {
      return NextResponse.json({ error: "You cannot delete yourself" }, { status: 400 });
    }

    // Auth-User löschen
    await adminAuth.deleteUser(uid);

    // Firestore-Dokument optional löschen oder „soft“ markieren
    await adminDb.collection("users").doc(uid).delete().catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
