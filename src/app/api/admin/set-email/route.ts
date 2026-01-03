import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function isAdminUid(uid: string, decoded: any) {
  // 1) Custom Claims
  if (decoded?.admin === true || decoded?.role === "admin") return true;

  // 2) Fallback: users/{uid}.role
  const snap = await adminDb.collection("users").doc(uid).get();
  const role = String(snap.data()?.role ?? "");
  return role === "admin";
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const callerUid = String(decoded?.uid ?? "");
    if (!callerUid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const okAdmin = await isAdminUid(callerUid, decoded);
    if (!okAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const uid = String(body?.uid ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!uid) return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

    // einfache Validierung (Firebase prüft sowieso nochmal hart)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Auth-E-Mail ändern
    await adminAuth.updateUser(uid, { email });

    // optional: Firestore User-Dokument synchron halten
    try {
      await adminDb.collection("users").doc(uid).set(
        {
          email,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } catch {
      // nicht fatal, Auth ist die Source of Truth
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
