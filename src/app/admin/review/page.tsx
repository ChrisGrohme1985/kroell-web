"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Appointment, Role } from "@/lib/types";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { adminSetDoneWithBy } from "@/lib/appointments";
import { fmtDateTime } from "@/lib/date";
import { useRouter } from "next/navigation";

function fromDoc(docu: any): Appointment {
  const d = docu.data();

  // robuster Fallback:
  // - wenn d.photoCount vorhanden ist -> nehmen
  // - sonst, wenn es ein Array "photos" gibt -> Länge
  // - sonst 0
  const photoCount =
    typeof d.photoCount === "number"
      ? d.photoCount
      : Array.isArray(d.photos)
        ? d.photos.length
        : 0;

  return {
    id: docu.id,
    title: d.title ?? "",
    description: d.description ?? "",
    startDate: (d.startDate as Timestamp).toDate(),
    endDate: (d.endDate as Timestamp).toDate(),
    status: d.status,
    createdByUserId: d.createdByUserId,
    documentationText: d.documentationText ?? "",
    documentedByUserId: d.documentedByUserId ?? null,
    documentedAt: d.documentedAt ? (d.documentedAt as Timestamp).toDate() : null,
    doneAt: d.doneAt ? (d.doneAt as Timestamp).toDate() : null,

    // ✅ FIX: Pflichtfeld aus deinem Appointment-Typ
    photoCount,
  };
}

export default function AdminReviewPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("user");
  const [items, setItems] = useState<Appointment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }
      const prof = await getOrCreateUserProfile(u);
      setRole(prof.role);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (role !== "admin") return;
    const q = query(
      collection(db, "appointments"),
      where("status", "==", "documented"),
      orderBy("documentedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => setItems(snap.docs.map(fromDoc)));
    return () => unsub();
  }, [role]);

  if (role !== "admin") {
    return (
      <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
        <p>Nur für Admin.</p>
        <Link href="/dashboard">
          <button>Dashboard</button>
        </Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "24px auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>
          Admin Review
        </h1>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/dashboard">
            <button>Dashboard</button>
          </Link>
        </div>
      </div>

      <p style={{ color: "#666", marginTop: 8 }}>
        Alle dokumentierten Termine, die geprüft und anschließend als „done“
        markiert werden sollen.
      </p>

      <ul
        style={{
          marginTop: 12,
          display: "grid",
          gap: 10,
          paddingLeft: 0,
          listStyle: "none",
        }}
      >
        {items.map((a) => (
          <li
            key={a.id}
            style={{
              padding: 12,
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              background: "white",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 900 }}>{a.title}</div>
                <div style={{ color: "#666", marginTop: 4 }}>
                  Doku-Zeit: {a.documentedAt ? fmtDateTime(a.documentedAt) : "—"}
                </div>
                <div style={{ color: "#666" }}>
                  Zeitraum: {fmtDateTime(a.startDate)} – {fmtDateTime(a.endDate)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Link href={`/appointments/${a.id}`}>
                  <button>Öffnen</button>
                </Link>
                <Link href={`/appointments/${a.id}?export=bundle`}>
                  <button>Export Bundle</button>
                </Link>
                <button
                  onClick={async () => {
                    setBusyId(a.id);
                    try {
                      await adminSetDoneWithBy({
                        apptId: a.id,
                        adminId: auth.currentUser!.uid,
                      });
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  disabled={busyId === a.id}
                >
                  {busyId === a.id ? "…" : "Als erledigt"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p style={{ color: "#666" }}>Keine dokumentierten Termine vorhanden.</p>
      )}
    </main>
  );
}
