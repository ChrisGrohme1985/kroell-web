import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termin-App",
  description: "Termine, Dokumentation, Admin-Workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", margin: 0, background: "#f9fafb" }}>
        {children}
      </body>
    </html>
  );
}
