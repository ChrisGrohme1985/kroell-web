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
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const firstName = String(body?.firstName ?? "").trim();
    const lastName = String(body?.lastName ?? "").trim();
    const role = String(body?.role ?? "user").trim();

    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });
    if (password.trim().length < 6) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
    if (!firstName || !lastName) return NextResponse.json({ error: "Missing firstName/lastName" }, { status: 400 });
    if (role !== "admin" && role !== "user") return NextResponse.json({ error: "Invalid role" }, { status: 400 });

    const userRecord = await adminAuth.createUser({
      email,
      password: password.trim(),
      displayName: `${firstName} ${lastName}`.trim(),
    });

    // optional: Claims setzen (wenn du willst)
    // await adminAuth.setCustomUserClaims(userRecord.uid, { role });

    // Firestore Profil anlegen/setzen
    await adminDb.collection("users").doc(userRecord.uid).set(
      {
        email,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`.trim(),
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, uid: userRecord.uid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
