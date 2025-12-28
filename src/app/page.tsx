import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Termin-App</h1>
      <p style={{ color: "#555" }}>
        Webinterface für Termine: Heute, nächste 7 Tage, Dokumentation (Fotos + Kommentare) und Admin-Workflow.
      </p>
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <Link href="/login"><button>Login</button></Link>
        <Link href="/dashboard"><button>Dashboard</button></Link>
      </div>
    </main>
  );
}
