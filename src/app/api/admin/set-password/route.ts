import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

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
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const ok = await isAdminUid(decoded.uid, decoded);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const uid = String(body?.uid ?? "").trim();
    const password = String(body?.password ?? "");

    if (!uid) return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    if (password.trim().length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    await adminAuth.updateUser(uid, { password: password.trim() });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
