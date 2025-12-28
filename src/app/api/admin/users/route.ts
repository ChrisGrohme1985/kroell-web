// src/app/api/admin/users/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { requireAdmin } from "../_auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: guard.message }, { status: guard.status });

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "").trim();
  const displayName = String(body?.displayName ?? "").trim();

  if (!email || !password) {
    return NextResponse.json({ error: "email + password required" }, { status: 400 });
  }

  try {
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: displayName || undefined,
    });

    return NextResponse.json({ uid: userRecord.uid }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "createUser failed" },
      { status: 500 }
    );
  }
}
