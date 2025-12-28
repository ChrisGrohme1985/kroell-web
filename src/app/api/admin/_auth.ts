// src/app/api/admin/_auth.ts
import "server-only";
import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return { ok: false as const, status: 401, message: "Missing Bearer token" };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);

    const isAdmin = decoded.admin === true || decoded.role === "admin";
    if (!isAdmin) return { ok: false as const, status: 403, message: "Not an admin" };

    return { ok: true as const, uid: decoded.uid };
  } catch (e) {
    return { ok: false as const, status: 401, message: "Invalid token" };
  }
}
