// src/app/api/admin/users/password/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { requireAdmin } from "../../_auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: guard.message }, { status: guard.status });

  const body = await req.json().catch(() => null);
  const uid = String(body?.uid ?? "").trim();
  const password = String(body?.password ?? "").trim();

  if (!uid || !password) {
    return NextResponse.json({ error: "uid + password required" }, { status: 400 });
  }

  try {
    await adminAuth.updateUser(uid, { password });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "updateUser password failed" },
      { status: 500 }
    );
  }
}
