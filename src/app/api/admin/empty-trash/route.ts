import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Unauthorized");

  const decoded = await adminAuth.verifyIdToken(token);
  const uid = decoded.uid;

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const role = (userSnap.exists ? (userSnap.data() as any)?.role : null) ?? "user";
  if (role !== "admin") throw new Error("Forbidden");

  return uid;
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);

    const snap = await adminDb
      .collection("appointments")
      .where("deletedAt", "!=", null)
      .limit(5000)
      .get();

    const batch = adminDb.batch();
    let count = 0;

    snap.docs.forEach((d) => {
      batch.delete(d.ref);
      count += 1;
    });

    if (count > 0) await batch.commit();

    return NextResponse.json({ ok: true, deleted: count });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
