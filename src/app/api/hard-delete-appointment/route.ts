import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.replace(/\/+$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "Missing NEXT_PUBLIC_FUNCTIONS_BASE_URL" }, { status: 500 });

  const auth = req.headers.get("authorization") || "";
  const body = await req.text();

  const r = await fetch(`${base}/apiHardDeleteAppointment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body,
  });

  const text = await r.text();
  return new NextResponse(text, { status: r.status, headers: { "Content-Type": "application/json" } });
}
