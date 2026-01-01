"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Appointment, AppointmentStatus, Role } from "@/lib/types";
import { startOfToday, startOfTomorrow, startOfDayPlus, fmtDate, fmtTime } from "@/lib/date";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
  limit,
  doc,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { apiHardDeleteAppointment } from "@/lib/functionsClient";

/** ---------- local types ---------- */

type ApptRow = Appointment & {
  updatedAt?: Date | null;

  // recurrence markers (falls vorhanden)
  isRecurring?: boolean;
  seriesId?: string | null;

  // ✅ Terminart
  appointmentType?: string;
};

type StatusKey = "open" | "documented" | "done";
type QuickRangeKey = "past" | "today" | "tomorrow" | "week" | "month" | "all" | null;

type UserMini = { firstName?: string; lastName?: string; displayName?: string };
type UserOption = { uid: string; name: string };

type TypeOption = { key: string; label: string };

/** ---------- typography ---------- */

const FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const FW_REG = 500;
const FW_MED = 550;
const FW_SEMI = 600;

/** ---------- helpers ---------- */

function tsToDate(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (x instanceof Timestamp) return x.toDate();
  if (x?.toDate) return x.toDate();
  if (x?.seconds) return new Date(x.seconds * 1000);
  return null;
}

function fromDoc(docu: any): ApptRow {
  const d = docu.data();
  return {
    id: docu.id,
    title: d.title ?? "",
    description: d.description ?? "",
    startDate: (d.startDate as Timestamp).toDate(),
    endDate: (d.endDate as Timestamp).toDate(),
    status: d.status,
    createdByUserId: d.createdByUserId,
    documentationText: d.documentationText ?? "",
    photoCount: d.photoCount ?? 0,
    adminNote: d.adminNote ?? "",
    deletedAt: d.deletedAt ? (d.deletedAt as Timestamp).toDate() : null,
    locked: d.locked ?? false,
    documentedByUserId: d.documentedByUserId ?? null,
    documentedAt: d.documentedAt ? (d.documentedAt as Timestamp).toDate() : null,
    doneAt: d.doneAt ? (d.doneAt as Timestamp).toDate() : null,
    updatedAt: tsToDate(d.updatedAt),

    isRecurring: !!d.isRecurring,
    seriesId: d.seriesId ?? null,

    appointmentType: String(d.appointmentType ?? "").trim(),
  };
}

function statusLabel(s: string) {
  switch (s) {
    case "open":
      return "Offen";
    case "documented":
      return "Dokumentiert";
    case "done":
      return "Erledigt";
    case "deleted":
      return "Gelöscht";
    default:
      return s;
  }
}

function roleLabel(r?: Role | string) {
  const x = String(r ?? "").toLowerCase();
  if (x === "admin") return "Admin";
  if (x === "user") return "User";
  return r ? String(r) : "—";
}

function niceName(u: UserMini | undefined) {
  if (!u) return "";
  const fn = (u.firstName ?? "").trim();
  const ln = (u.lastName ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  return full || (u.displayName ?? "").trim();
}

function getUpdatedAtLike(a: ApptRow) {
  return a.updatedAt || a.documentedAt || a.doneAt || a.startDate;
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** ---------- ✅ Dashboard date/time display helpers (Mehrtag + Ganztag) ---------- */

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Wenn Endzeit exakt 00:00 ist (typisch für "end exclusive"), nehmen wir 1 Minute zurück,
 * damit die Anzeige "Enduhrzeit des letzten Tages" korrekt ist.
 */
function adjustedEndForDisplay(start: Date, end: Date) {
  const e = new Date(end);
  if (e.getTime() > start.getTime() && e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0) {
    e.setMinutes(e.getMinutes() - 1);
  }
  return e;
}

function isAllDayLike(start: Date, endAdjusted: Date) {
  const s0 = start.getHours() === 0 && start.getMinutes() === 0;
  const eLast = endAdjusted.getHours() === 23 && endAdjusted.getMinutes() === 59;
  return s0 && eLast;
}

function displayDateLabel(a: ApptRow) {
  const endAdj = adjustedEndForDisplay(a.startDate, a.endDate);
  if (isSameDay(a.startDate, endAdj)) return fmtDate(a.startDate);
  return `${fmtDate(a.startDate)} - ${fmtDate(endAdj)}`;
}

function displayTimeLabel(a: ApptRow) {
  const endAdj = adjustedEndForDisplay(a.startDate, a.endDate);
  const allDay = isAllDayLike(a.startDate, endAdj);

  const startTime = allDay ? "00:01" : fmtTime(a.startDate);
  const endTime = allDay ? "23:59" : fmtTime(endAdj);

  return `${startTime} – ${endTime}`;
}

/** ---------- UI ---------- */

function Btn({
  children,
  onClick,
  variant = "secondary",
  disabled,
  compact,
  style,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  compact?: boolean;
  style?: React.CSSProperties;
  title?: string;
}) {
  const base: React.CSSProperties = {
    borderRadius: 999,
    padding: compact ? "7px 11px" : "9px 13px",
    border: "1px solid rgba(0,0,0,0.12)",
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    fontSize: compact ? 12.5 : 13.5,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease, border-color 120ms ease",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "linear-gradient(#1e3a8a, #1d4ed8)",
      color: "white",
      border: "1px solid rgba(29,78,216,0.65)",
    },
    secondary: { background: "linear-gradient(#ffffff, #f3f4f6)", color: "#111827" },
    danger: {
      background: "linear-gradient(#ef4444, #dc2626)",
      color: "white",
      border: "1px solid rgba(220,38,38,0.6)",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...base, ...styles[variant], ...(style ?? {}) }}
      onMouseDown={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"))}
      onMouseUp={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
      onMouseLeave={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 36,
        height: 32,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(#fff,#f3f4f6)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: "0 1px 1px rgba(0,0,0,0.05), 0 10px 18px rgba(0,0,0,0.06)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        color: "#111827",
        transition: "transform 80ms ease, box-shadow 120ms ease, border-color 120ms ease",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseDown={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"))}
      onMouseUp={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
      onMouseLeave={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
    >
      {children}
    </button>
  );
}

/** ✅ dezent: nur +/- zum Ein-/Ausklappen (ohne "Button-Optik") */
function FoldBtn({
  open,
  onClick,
  title,
}: {
  open: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (open ? "Einklappen" : "Ausklappen")}
      aria-label={title ?? (open ? "Einklappen" : "Ausklappen")}
      style={{
        width: 28,
        height: 28,
        borderRadius: 10,
        border: "1px solid rgba(229,231,235,0.9)",
        background: "transparent",
        color: "#6b7280",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        transition: "background 120ms ease, border-color 120ms ease, transform 80ms ease",
        userSelect: "none",
      }}
      onMouseDown={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"))}
      onMouseUp={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
      onMouseLeave={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
    >
      {open ? "−" : "+"}
    </button>
  );
}

function Thumb({ url }: { url?: string }) {
  if (!url) {
    return (
      <div
        style={{
          width: 44,
          height: 32,
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#f3f4f6",
        }}
        aria-label="Kein Bild"
        title="Kein Bild"
      />
    );
  }
  return (
    <img
      src={url}
      alt="Dokumentationsbild"
      style={{
        width: 44,
        height: 32,
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        objectFit: "cover",
        display: "block",
      }}
    />
  );
}

function PhotoCell({ url, count }: { url?: string; count: number }) {
  // Web: show "—" placeholder when no photos
  // Mobile: placeholder will be hidden via CSS
  if (!count || count <= 0) {
    return (
      <span className="photoPlaceholder" aria-hidden="true">—</span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
      <Thumb url={url} />
      <span
        title={`${count} Foto(s)`}
        style={{
          minWidth: 28,
          height: 22,
          padding: "0 8px",
          borderRadius: 999,
          border: "1px solid #e5e7eb",
          background: "linear-gradient(#ffffff, #f3f4f6)",
          fontFamily: FONT_FAMILY,
          fontWeight: FW_SEMI,
          fontSize: 12,
          color: "#111827",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {count}
      </span>
    </div>
  );
}

function StatusPill({
  status,
  clickable,
  title,
  onClick,
}: {
  status: string;
  clickable?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const s = String(status ?? "");
  const map: Record<string, { bg: string; border: string; text: string }> = {
    open: { bg: "linear-gradient(#dbeafe, #bfdbfe)", border: "1px solid #93c5fd", text: "#1e3a8a" },
    documented: { bg: "linear-gradient(#fefce8, #fef9c3)", border: "1px solid #facc15", text: "#854d0e" },
    done: { bg: "linear-gradient(#ecfdf5, #d1fae5)", border: "1px solid #34d399", text: "#065f46" },
    deleted: { bg: "linear-gradient(#fee2e2, #fecaca)", border: "1px solid #fca5a5", text: "#991b1b" },
  };
  const t =
    map[s] ?? { bg: "linear-gradient(#ffffff, #f3f4f6)", border: "1px solid #e5e7eb", text: "#111827" };

  const baseStyle: React.CSSProperties = {
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 999,
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    whiteSpace: "nowrap",
    background: t.bg,
    border: t.border,
    color: t.text,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 18px rgba(0,0,0,0.06)",
  };

  if (!clickable)
    return (
      <span style={baseStyle} title={title ?? statusLabel(s)}>
        {statusLabel(s)}
      </span>
    );

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? statusLabel(s)}
      style={{
        ...baseStyle,
        cursor: "pointer",
        transition: "transform 80ms ease, box-shadow 120ms ease",
      }}
      onMouseDown={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"))}
      onMouseUp={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
      onMouseLeave={(e) => (((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"))}
    >
      {statusLabel(s)}
    </button>
  );
}

function Chip({
  active,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone: "neutral" | "open" | "documented" | "done" | "trash" | "quick" | "series";
}) {
  const inactive = {
    bg: "linear-gradient(#ffffff, #f3f4f6)",
    border: "1px solid #e5e7eb",
    text: "#111827",
    badge: "#9ca3af",
  };

  const tones: Record<string, { bgActive: string; borderActive: string; textActive: string; badge: string }> = {
    neutral: {
      bgActive: "linear-gradient(#1e3a8a, #1d4ed8)",
      borderActive: "1px solid rgba(29,78,216,0.65)",
      textActive: "white",
      badge: "#93c5fd",
    },
    open: {
      bgActive: "linear-gradient(#dbeafe, #bfdbfe)",
      borderActive: "1px solid #93c5fd",
      textActive: "#1e3a8a",
      badge: "#1d4ed8",
    },
    documented: {
      bgActive: "linear-gradient(#fefce8, #fef9c3)",
      borderActive: "1px solid #facc15",
      textActive: "#854d0e",
      badge: "#854d0e",
    },
    done: {
      bgActive: "linear-gradient(#ecfdf5, #d1fae5)",
      borderActive: "1px solid #34d399",
      textActive: "#065f46",
      badge: "#065f46",
    },
    trash: {
      bgActive: "linear-gradient(#fee2e2, #fecaca)",
      borderActive: "1px solid #fca5a5",
      textActive: "#991b1b",
      badge: "#991b1b",
    },
    quick: {
      bgActive: "linear-gradient(#1e3a8a, #1d4ed8)",
      borderActive: "1px solid rgba(29,78,216,0.65)",
      textActive: "white",
      badge: "#93c5fd",
    },
    series: {
      bgActive: "linear-gradient(#dbeafe, #bfdbfe)",
      borderActive: "1px solid rgba(147,197,253,0.95)",
      textActive: "#1e3a8a",
      badge: "#1d4ed8",
    },
  };

  const t = tones[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        padding: "7px 11px",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12.5,
        cursor: "pointer",
        background: active ? t.bgActive : inactive.bg,
        border: active ? t.borderActive : inactive.border,
        color: active ? t.textActive : inactive.text,
        boxShadow: active
          ? "0 1px 1px rgba(0,0,0,0.06), 0 12px 26px rgba(0,0,0,0.08)"
          : "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        lineHeight: 1,
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {active && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: t.badge,
            boxShadow: "0 0 0 2px rgba(255,255,255,0.55)",
          }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
function CountPill({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "open" | "documented" | "done" | "trash";
}) {
  const tones: Record<
    string,
    { wrapBg: string; wrapBorder: string; text: string; badgeBg: string; badgeBorder: string; badgeText: string }
  > = {
    open: {
      wrapBg: "rgba(219,234,254,0.55)",
      wrapBorder: "1px solid rgba(147,197,253,0.9)",
      text: "#1e3a8a",
      badgeBg: "rgba(29,78,216,0.12)",
      badgeBorder: "1px solid rgba(29,78,216,0.25)",
      badgeText: "#1d4ed8",
    },
    documented: {
      wrapBg: "rgba(254,249,195,0.60)",
      wrapBorder: "1px solid rgba(250,204,21,0.9)",
      text: "#854d0e",
      badgeBg: "rgba(133,77,14,0.12)",
      badgeBorder: "1px solid rgba(133,77,14,0.25)",
      badgeText: "#854d0e",
    },
    done: {
      wrapBg: "rgba(209,250,229,0.60)",
      wrapBorder: "1px solid rgba(52,211,153,0.9)",
      text: "#065f46",
      badgeBg: "rgba(6,95,70,0.12)",
      badgeBorder: "1px solid rgba(6,95,70,0.25)",
      badgeText: "#065f46",
    },
    trash: {
      wrapBg: "rgba(254,202,202,0.55)",
      wrapBorder: "1px solid rgba(252,165,165,0.95)",
      text: "#991b1b",
      badgeBg: "rgba(153,27,27,0.12)",
      badgeBorder: "1px solid rgba(153,27,27,0.25)",
      badgeText: "#991b1b",
    },
  };

  const t = tones[tone];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 999,
        background: t.wrapBg,
        border: t.wrapBorder,
        color: t.text,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        lineHeight: 1,
        userSelect: "none",
        boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
      }}
      title={`${count} ${label}`}
      aria-label={`${count} ${label}`}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: 20,
          minWidth: 28,
          padding: "0 7px",
          borderRadius: 999,
          background: t.badgeBg,
          border: t.badgeBorder,
          color: t.badgeText,
          fontFamily: FONT_FAMILY,
          fontWeight: FW_SEMI,
          fontSize: 12,
          letterSpacing: 0.1,
        }}
      >
        {count}
      </span>

      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/** ---------- sorting ---------- */

type SortKey = "status" | "date" | "time" | "description" | "type" | "updated";
type SortDir = "asc" | "desc";

/** Papierkorb: ohne Status/User/Fotos Sortierung */
type TrashSortKey = "date" | "time" | "description" | "type" | "updated";

function sortArrow(active: boolean, dir: SortDir) {
  if (!active) return "↕";
  return dir === "asc" ? "↑" : "↓";
}

/** ---------- localStorage ---------- */

const LS_KEY = "dashboard_filters_v13"; // ✅ bump (wegen Search/Filter Fold-States)

/** ---------- small dropdown ---------- */

function PickerButton({
  labelLeft,
  valueLabel,
  onToggle,
  size = "filter",
}: {
  labelLeft: string;
  valueLabel: string;
  onToggle: () => void;
  size?: "filter" | "header";
}) {
  const isHeader = size === "header";

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isHeader ? 8 : 10,
        padding: isHeader ? "6px 10px" : "10px 12px",
        height: isHeader ? 30 : 40,
        borderRadius: isHeader ? 12 : 14,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(#fff,#f7f7fb)",
        boxShadow: isHeader
          ? "0 1px 0 rgba(0,0,0,0.02)"
          : "0 1px 1px rgba(0,0,0,0.05), 0 10px 18px rgba(0,0,0,0.06)",
        cursor: "pointer",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: isHeader ? 12.5 : 13,
        whiteSpace: "nowrap",
        maxWidth: isHeader ? 260 : undefined,
        width: isHeader ? "100%" : undefined,
      }}
      title={`${labelLeft}: ${valueLabel}`}
    >
      <span style={{ color: "#6b7280" }}>{labelLeft}</span>
      <span
        className="clamp1"
        style={{
          color: "#111827",
          minWidth: 0,
          maxWidth: isHeader ? 150 : 220,
        }}
      >
        {valueLabel}
      </span>
      <span style={{ color: "#6b7280" }}>▾</span>
    </button>
  );
}

function PickerPanel({
  title,
  items,
  selectedKeys,
  onToggleKey,
  onClear,
  onClose,
  width = 320,
  showSelectAll = false,
  hideClearButton = false,
}: {
  title: string;
  items: { key: string; label: string }[];
  selectedKeys: string[];
  onToggleKey: (k: string) => void;
  onClear: () => void;
  onClose: () => void;
  width?: number;
  showSelectAll?: boolean;
  hideClearButton?: boolean;
}) {
  const allKeys = useMemo(() => items.map((i) => i.key), [items]);
  const allSelected = useMemo(
    () => items.length > 0 && allKeys.every((k) => selectedKeys.includes(k)),
    [allKeys, selectedKeys, items.length]
  );

  function toggleAll() {
    if (allSelected) onClear();
    else allKeys.forEach((k) => !selectedKeys.includes(k) && onToggleKey(k));
  }

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 10px)",
        left: 0,
        width,
        maxWidth: "min(92vw, 420px)",
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        boxShadow: "0 18px 55px rgba(0,0,0,0.18)",
        padding: 12,
        zIndex: 9999,
      }}
      role="dialog"
      aria-label={title}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>{title}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {!hideClearButton && (
            <Btn compact variant="secondary" onClick={onClear}>
              Leeren
            </Btn>
          )}
          <Btn compact variant="secondary" onClick={onClose}>
            Schließen
          </Btn>
        </div>
      </div>

      {showSelectAll && (
        <button
          type="button"
          onClick={toggleAll}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            border: "1px solid #f1f5f9",
            background: allSelected ? "rgba(29,78,216,0.08)" : "white",
            color: "#111827",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 12,
            marginTop: 10,
            fontFamily: FONT_FAMILY,
            fontWeight: FW_SEMI,
            fontSize: 13,
          }}
        >
          <input type="checkbox" readOnly checked={allSelected} style={{ width: 16, height: 16 }} />
          <span>Alle</span>
        </button>
      )}

      <div
        style={{
          marginTop: 10,
          maxHeight: 320,
          overflow: "auto",
          borderRadius: 12,
          border: "1px solid #f1f5f9",
        }}
      >
        {items.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
            Keine Einträge.
          </div>
        ) : (
          items.map((it) => {
            const active = selectedKeys.includes(it.key);
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => onToggleKey(it.key)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: active ? "rgba(29,78,216,0.08)" : "white",
                  color: "#111827",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                  fontSize: 13,
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <input type="checkbox" readOnly checked={active} style={{ width: 16, height: 16 }} />
                <span className="clamp1" style={{ minWidth: 0 }}>
                  {it.label}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** ---------- page ---------- */

export default function DashboardPage() {
  const router = useRouter();

  const t0 = useMemo(() => startOfToday(), []);
  const t1 = useMemo(() => startOfTomorrow(), []);
  const tYesterday = useMemo(() => startOfDayPlus(-1), []);

  const [role, setRole] = useState<Role>("user");
  const [displayName, setDisplayName] = useState<string>("");

  // ✅ UID separat halten
  const [uid, setUid] = useState<string>("");

  const [roleLoaded, setRoleLoaded] = useState(false);
  const isAdmin = roleLoaded && role === "admin";

  const [allRaw, setAllRaw] = useState<ApptRow[]>([]);
  const [trashRaw, setTrashRaw] = useState<ApptRow[]>([]);

  const [thumbs, setThumbs] = useState<Record<string, string | undefined>>({});
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

  const [usersById, setUsersById] = useState<Record<string, UserMini>>({});
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);

  const [search, setSearch] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [statusSel, setStatusSel] = useState<Record<StatusKey, boolean>>({
    open: false,
    documented: false,
    done: false,
  });

  const [quickRange, setQuickRange] = useState<QuickRangeKey>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [showTrash, setShowTrash] = useState<boolean>(false);
  const [selectedTrashIds, setSelectedTrashIds] = useState<Record<string, boolean>>({});

  const [trashSortKey, setTrashSortKey] = useState<TrashSortKey>("updated");
  const [trashSortDir, setTrashSortDir] = useState<SortDir>("desc");

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const userPickerRef = useRef<HTMLDivElement | null>(null);

  const [selectedTypeKeys, setSelectedTypeKeys] = useState<string[]>([]);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const typePickerRef = useRef<HTMLDivElement | null>(null);

  const [hideRecurring, setHideRecurring] = useState<boolean>(false);

  const [perPage, setPerPage] = useState<number>(50);
  const [page, setPage] = useState<number>(1);

  /** ✅ NEW: Search/Filter einklappen (nur +/- dezent) */
  const [showSearch, setShowSearch] = useState<boolean>(true);
  const [showFilters, setShowFilters] = useState<boolean>(true);

  /** ---------- ✅ column alignment (match header padding) ---------- */
  const CELL_PAD: React.CSSProperties = useMemo(() => ({ padding: "3px 6px" }), []);

  /** ---------- restore filters once ---------- */

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = safeParseJSON<{
      search?: string;
      fromDate?: string;
      toDate?: string;
      statusSel?: Record<StatusKey, boolean>;
      sortKey?: SortKey;
      sortDir?: SortDir;
      quickRange?: QuickRangeKey;
      selectedUserIds?: string[];
      selectedTypeKeys?: string[];
      showTrash?: boolean;
      trashSortKey?: TrashSortKey;
      trashSortDir?: SortDir;
      perPage?: number;
      page?: number;
      hideRecurring?: boolean;
      showSearch?: boolean;
      showFilters?: boolean;
    }>(typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null);

    if (!saved) return;

    if (typeof saved.search === "string") setSearch(saved.search);
    if (typeof saved.fromDate === "string") setFromDate(saved.fromDate);
    if (typeof saved.toDate === "string") setToDate(saved.toDate);
    if (saved.statusSel) setStatusSel(saved.statusSel);
    if (saved.sortKey) setSortKey(saved.sortKey);
    if (saved.sortDir) setSortDir(saved.sortDir);
    if (typeof saved.quickRange !== "undefined") setQuickRange(saved.quickRange ?? null);
    if (Array.isArray(saved.selectedUserIds)) setSelectedUserIds(saved.selectedUserIds);
    if (Array.isArray(saved.selectedTypeKeys)) setSelectedTypeKeys(saved.selectedTypeKeys);
    if (typeof saved.showTrash === "boolean") setShowTrash(saved.showTrash);
    if (saved.trashSortKey) setTrashSortKey(saved.trashSortKey);
    if (saved.trashSortDir) setTrashSortDir(saved.trashSortDir);

    if (typeof saved.perPage === "number" && [20, 50, 100, 200].includes(saved.perPage)) setPerPage(saved.perPage);
    if (typeof saved.page === "number" && saved.page >= 1) setPage(saved.page);

    if (typeof saved.hideRecurring === "boolean") setHideRecurring(saved.hideRecurring);

    if (typeof saved.showSearch === "boolean") setShowSearch(saved.showSearch);
    if (typeof saved.showFilters === "boolean") setShowFilters(saved.showFilters);
  }, []);

  /** ---------- save filters debounced ---------- */

  const saveTimerRef = useRef<any>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          search,
          fromDate,
          toDate,
          statusSel,
          sortKey,
          sortDir,
          quickRange,
          selectedUserIds,
          selectedTypeKeys,
          showTrash,
          trashSortKey,
          trashSortDir,
          perPage,
          page,
          hideRecurring,
          showSearch,
          showFilters,
        })
      );
    }, 250);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    search,
    fromDate,
    toDate,
    statusSel,
    sortKey,
    sortDir,
    quickRange,
    selectedUserIds,
    selectedTypeKeys,
    showTrash,
    trashSortKey,
    trashSortDir,
    perPage,
    page,
    hideRecurring,
    showSearch,
    showFilters,
  ]);

  function resetFilters() {
    setSearch("");
    setFromDate("");
    setToDate("");
    setStatusSel({ open: false, documented: false, done: false });
    setSortKey("date");
    setSortDir("desc");
    setQuickRange(null);
    setSelectedUserIds([]);
    setSelectedTypeKeys([]);
    setSelectedTrashIds({});
    setShowTrash(false);
    setUserPickerOpen(false);
    setTypePickerOpen(false);
    setTrashSortKey("updated");
    setTrashSortDir("desc");
    setPerPage(50);
    setPage(1);
    setHideRecurring(false);
    setShowSearch(true);
    setShowFilters(true);
    if (typeof window !== "undefined") localStorage.removeItem(LS_KEY);
  }
  /** ---------- date helpers + quickrange detection ---------- */

  function toISODate(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const yyyy = x.getFullYear();
    const mm = String(x.getMonth() + 1).padStart(2, "0");
    const dd = String(x.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const PAST_FROM = "1970-01-01";

  function detectQuickRange(nextFrom: string, nextTo: string): QuickRangeKey {
    if (!nextFrom && !nextTo) return "all";
    if (!nextFrom || !nextTo) return null;

    const yesterday = toISODate(tYesterday);
    const today = toISODate(t0);
    const tomorrow = toISODate(t1);
    const weekFrom = toISODate(t0);
    const weekTo = toISODate(startOfDayPlus(6));
    const monthFrom = toISODate(t0);
    const monthTo = toISODate(startOfDayPlus(29));

    if (nextFrom === PAST_FROM && nextTo === yesterday) return "past";
    if (nextFrom === today && nextTo === today) return "today";
    if (nextFrom === tomorrow && nextTo === tomorrow) return "tomorrow";
    if (nextFrom === weekFrom && nextTo === weekTo) return "week";
    if (nextFrom === monthFrom && nextTo === monthTo) return "month";

    return null;
  }

  function applyQuickRange(from: Date, to: Date, key: Exclude<QuickRangeKey, null | "all">) {
    const f = toISODate(from);
    const t = toISODate(to);
    setFromDate(f);
    setToDate(t);
    setQuickRange(key);
  }

  function applyPastRange() {
    const to = toISODate(tYesterday);
    setFromDate(PAST_FROM);
    setToDate(to);
    setQuickRange("past");
  }

  function applyAllRange() {
    setFromDate("");
    setToDate("");
    setQuickRange("all");
  }

  /** ---------- auth ---------- */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRoleLoaded(false);
        setUid("");
        router.push("/login");
        return;
      }

      setUid(user.uid);

      try {
        const tokenResult = await user.getIdTokenResult(true);
        console.log("🔥 UID:", user.uid);
        console.log("🔥 CLAIMS:", tokenResult.claims);

        const prof = await getOrCreateUserProfile(user);

        const fn = String((prof as any).firstName ?? "").trim();
        const ln = String((prof as any).lastName ?? "").trim();
        const fullName = `${fn} ${ln}`.trim();

        setDisplayName(
          fullName ||
            String((prof as any).displayName ?? "").trim() ||
            String(user.displayName ?? "").trim() ||
            String(user.email ?? "").trim()
        );

        setRole(prof.role);
        setRoleLoaded(true);
      } catch (err) {
        console.error("🔥 Auth/Profile Init FAILED:", err);
        alert("Login fehlgeschlagen: fehlende Berechtigungen.");
        setRoleLoaded(false);
      }
    });

    return () => unsub();
  }, [router]);

  /**
   * ✅ FIX: Normaler User soll offene Termine sehen.
   * Zusätzlich Papierkorb für User aus.
   */
  useEffect(() => {
    if (!roleLoaded) return;

    if (role !== "admin") {
      setStatusSel({ open: true, documented: false, done: false });
      setShowTrash(false);

      // ✅ Terminart für User komplett deaktivieren (UI/Filter)
      setSelectedTypeKeys([]);
      setTypePickerOpen(false);
    }
  }, [roleLoaded, role]);

  /** ---------- load appointments (not deleted) ---------- */

  useEffect(() => {
    if (!roleLoaded) return;
    if (!uid) return;

    const base = collection(db, "appointments");

    const qAppts =
      role === "admin"
        ? query(base, where("deletedAt", "==", null), orderBy("startDate", "desc"), limit(1200))
        : query(
            base,
            where("deletedAt", "==", null),
            where("status", "==", "open"),
            where("createdByUserId", "==", uid),
            orderBy("startDate", "desc"),
            limit(900)
          );

    const unsub = onSnapshot(
      qAppts,
      (snap) => setAllRaw(snap.docs.map(fromDoc)),
      (e) => console.error("APPTS query error:", e)
    );

    return () => unsub();
  }, [roleLoaded, role, uid]);

  /** ---------- load trash (admin only) ---------- */

  useEffect(() => {
    if (!roleLoaded) return;
    if (role !== "admin") {
      setTrashRaw([]);
      return;
    }

    const epochTs = Timestamp.fromDate(new Date(1970, 0, 1));
    const qTrash = query(
      collection(db, "appointments"),
      where("deletedAt", ">", epochTs),
      orderBy("deletedAt", "desc"),
      limit(900)
    );

    const unsub = onSnapshot(
      qTrash,
      (snap) => setTrashRaw(snap.docs.map(fromDoc)),
      (e) => console.error("TRASH query error:", e)
    );

    return () => unsub();
  }, [roleLoaded, role]);

  /** ---------- users ---------- */

  useEffect(() => {
    if (!roleLoaded) return;
    if (role !== "admin") {
      setUserOptions([]);
      setSelectedUserIds([]);
      return;
    }

    const qUsers = query(collection(db, "users"), limit(2000));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const nextUsers: Record<string, UserMini> = {};
        const options: UserOption[] = [];

        for (const d of snap.docs) {
          const x = d.data() as any;
          const mini: UserMini = {
            firstName: x.firstName ?? "",
            lastName: x.lastName ?? "",
            displayName: x.displayName ?? "",
          };
          nextUsers[d.id] = mini;
          options.push({ uid: d.id, name: niceName(mini) || "—" });
        }

        options.sort((a, b) => a.name.localeCompare(b.name, "de"));
        setUsersById((prev) => ({ ...prev, ...nextUsers }));
        setUserOptions(options);
      },
      (e) => console.error("USERS query error:", e)
    );

    return () => unsub();
  }, [roleLoaded, role]);

  function userFullName(uid?: string | null) {
    if (!uid) return "";
    return niceName(usersById[uid]) || "";
  }

  /** ---------- Terminart options ---------- */

  const typeOptions: TypeOption[] = useMemo(() => {
    const set = new Set<string>();
    [...allRaw, ...trashRaw].forEach((a) => {
      const v = String(a.appointmentType ?? "").trim();
      if (v) set.add(v);
    });
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
    return arr.map((x) => ({ key: x, label: x }));
  }, [allRaw, trashRaw]);

  function typeLabelForKey(k: string) {
    return typeOptions.find((x) => x.key === k)?.label ?? k;
  }

  const selectedTypeLabel = useMemo(() => {
    if (!selectedTypeKeys.length) return "Alle";
    const labels = selectedTypeKeys.map(typeLabelForKey).filter(Boolean);
    if (labels.length <= 2) return labels.join(", ");
    return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
  }, [selectedTypeKeys, typeOptions]);

  function toggleType(k: string) {
    setSelectedTypeKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  function clearTypes() {
    setSelectedTypeKeys([]);
  }

  /** ---------- close pickers (outside click + ESC) ---------- */

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const u = userPickerRef.current;
      const t = typePickerRef.current;

      if (userPickerOpen && u && !u.contains(e.target as Node)) setUserPickerOpen(false);
      if (typePickerOpen && t && !t.contains(e.target as Node)) setTypePickerOpen(false);
    }

    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setUserPickerOpen(false);
        setTypePickerOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [userPickerOpen, typePickerOpen]);

  /** ---------- thumbs incremental subscriptions ---------- */

  const thumbMapRef = useRef<Record<string, string | undefined>>({});
  const thumbUnsubsRef = useRef<Record<string, () => void>>({});
  const photoCountMapRef = useRef<Record<string, number>>({});

  function ensureThumbSubscription(id: string) {
    if (thumbUnsubsRef.current[id]) return;

    const qPhotos = query(collection(db, "appointments", id, "photos"), orderBy("uploadedAt", "asc"));
    const unsub = onSnapshot(
      qPhotos,
      (snap) => {
        const first = snap.docs[0]?.data() as any;
        const url = first?.url as string | undefined;
        const count = snap.size ?? 0;

        let changed = false;

        if (thumbMapRef.current[id] !== url) {
          thumbMapRef.current = { ...thumbMapRef.current, [id]: url };
          setThumbs(thumbMapRef.current);
          changed = true;
        }

        if (photoCountMapRef.current[id] !== count) {
          photoCountMapRef.current = { ...photoCountMapRef.current, [id]: count };
          setPhotoCounts(photoCountMapRef.current);
          changed = true;
        }

        if (!changed) return;
      },
      () => {}
    );

    thumbUnsubsRef.current[id] = unsub;
  }

  function dropThumbSubscription(id: string) {
    const u = thumbUnsubsRef.current[id];
    if (u) u();
    delete thumbUnsubsRef.current[id];

    if (id in thumbMapRef.current) {
      const next = { ...thumbMapRef.current };
      delete next[id];
      thumbMapRef.current = next;
      setThumbs(next);
    }

    if (id in photoCountMapRef.current) {
      const next = { ...photoCountMapRef.current };
      delete next[id];
      photoCountMapRef.current = next;
      setPhotoCounts(next);
    }
  }

  useEffect(() => {
    return () => {
      Object.values(thumbUnsubsRef.current).forEach((u) => u());
      thumbUnsubsRef.current = {};
      thumbMapRef.current = {};
      photoCountMapRef.current = {};
    };
  }, []);

  /** ---------- filtering ---------- */

  const selectedStatuses = useMemo(() => {
    return (Object.keys(statusSel) as StatusKey[]).filter((k) => statusSel[k]);
  }, [statusSel]);

  function matchesBaseFilters(a: ApptRow, isTrash: boolean) {
    if (!isTrash && hideRecurring) {
      if (a.isRecurring || a.seriesId) return false;
    }

    if (role === "admin" && selectedUserIds.length > 0) {
      if (!selectedUserIds.includes(a.createdByUserId)) return false;
    }

    // ✅ Terminart-Filter nur für Admin (User: Terminart UI ist ausgeblendet)
    if (role === "admin" && selectedTypeKeys.length > 0) {
      const t = String(a.appointmentType ?? "").trim();
      if (!selectedTypeKeys.includes(t)) return false;
    }

    // ✅ Mehrtägige Termine: Overlap statt Starttag
    if (fromDate || toDate) {
      const rangeStart = fromDate ? new Date(fromDate) : new Date(1970, 0, 1);
      rangeStart.setHours(0, 0, 0, 0);

      const rangeEnd = toDate ? new Date(toDate) : new Date(2999, 11, 31);
      rangeEnd.setHours(23, 59, 59, 999);

      const apptEndAdj = adjustedEndForDisplay(a.startDate, a.endDate);

      if (a.startDate > rangeEnd) return false;
      if (apptEndAdj < rangeStart) return false;
    }

    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [
        a.id,
        a.title,
        a.description,
        a.status,
        a.documentationText,
        a.adminNote,
        a.createdByUserId,
        a.documentedByUserId ?? "",
        userFullName(a.createdByUserId),
        userFullName(a.documentedByUserId ?? null),

        // ✅ Terminart nur für Admin in der Suche (User sieht/benutzt es nicht)
        role === "admin" ? a.appointmentType ?? "" : "",

        isTrash ? "papierkorb gelöscht" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!hay.includes(q)) return false;
    }

    if (isTrash) return !!a.deletedAt;
    return !a.deletedAt;
  }

  function matchesFilters(a: ApptRow, isTrash: boolean) {
    if (!matchesBaseFilters(a, isTrash)) return false;

    if (!isTrash) {
      if (role !== "admin") return a.status === "open";

      if (selectedStatuses.length === 0) return false;
      if (!selectedStatuses.includes(a.status as StatusKey)) return false;
    }

    return true;
  }

  const allFiltered = useMemo(() => allRaw.filter((a) => matchesFilters(a, false)), [
    allRaw,
    search,
    fromDate,
    toDate,
    role,
    selectedStatuses.join("|"),
    usersById,
    selectedUserIds.join("|"),
    selectedTypeKeys.join("|"),
    hideRecurring,
  ]);

  const trashFiltered = useMemo(() => trashRaw.filter((a) => matchesFilters(a, true)), [
    trashRaw,
    search,
    fromDate,
    toDate,
    role,
    usersById,
    selectedUserIds.join("|"),
    selectedTypeKeys.join("|"),
  ]);

  const mainCounts = useMemo(() => {
    const base = allRaw.filter((a) => matchesBaseFilters(a, false));
    let open = 0,
      documented = 0,
      done = 0;
    for (const a of base) {
      if (a.status === "open") open++;
      else if (a.status === "documented") documented++;
      else if (a.status === "done") done++;
    }
    return { open, documented, done };
  }, [
    allRaw,
    search,
    fromDate,
    toDate,
    role,
    usersById,
    selectedUserIds.join("|"),
    selectedTypeKeys.join("|"),
    hideRecurring,
  ]);

  const activeStatusOrder = useMemo(() => {
    const order: StatusKey[] = ["open", "documented", "done"];
    return order.filter((k) => !!statusSel[k]);
  }, [statusSel]);

  /** ---------- sorting main list only ---------- */

  function toggleSort(nextKey: SortKey, defaultDir: SortDir) {
    if (sortKey !== nextKey) {
      setSortKey(nextKey);
      setSortDir(defaultDir);
      return;
    }
    setSortDir((cur) => (cur === "asc" ? "desc" : "asc"));
  }

  const topList = useMemo(() => {
    const list = [...allFiltered];
    const dirMul = sortDir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      const aUpdated = getUpdatedAtLike(a).getTime();
      const bUpdated = getUpdatedAtLike(b).getTime();

      const cmpStr = (x: string, y: string) => x.localeCompare(y, "de");
      const cmpNum = (x: number, y: number) => x - y;

      switch (sortKey) {
        case "status":
          return cmpStr(statusLabel(a.status), statusLabel(b.status)) * dirMul;

        case "date": {
          const ad = new Date(a.startDate.getFullYear(), a.startDate.getMonth(), a.startDate.getDate()).getTime();
          const bd = new Date(b.startDate.getFullYear(), b.startDate.getMonth(), b.startDate.getDate()).getTime();
          return cmpNum(ad, bd) * dirMul;
        }

        case "time":
          return cmpNum(a.startDate.getTime(), b.startDate.getTime()) * dirMul;

        case "description":
          return (
            cmpStr(`${a.title ?? ""} ${a.description ?? ""}`.trim(), `${b.title ?? ""} ${b.description ?? ""}`.trim()) *
            dirMul
          );

        case "type":
          // ✅ für User wird "type" nie als Header angeboten, aber safe lassen
          return cmpStr(String(a.appointmentType ?? ""), String(b.appointmentType ?? "")) * dirMul;

        case "updated":
          return cmpNum(aUpdated, bUpdated) * dirMul;

        default:
          return 0;
      }
    });

    return list;
  }, [allFiltered, sortKey, sortDir]);

  /** ---------- sorting trash list ---------- */

  function toggleTrashSort(nextKey: TrashSortKey, defaultDir: SortDir) {
    if (trashSortKey !== nextKey) {
      setTrashSortKey(nextKey);
      setTrashSortDir(defaultDir);
      return;
    }
    setTrashSortDir((cur) => (cur === "asc" ? "desc" : "asc"));
  }

  const trashList = useMemo(() => {
    const list = [...trashFiltered];
    const dirMul = trashSortDir === "asc" ? 1 : -1;

    const cmpStr = (x: string, y: string) => x.localeCompare(y, "de");
    const cmpNum = (x: number, y: number) => x - y;

    list.sort((a, b) => {
      const aUpdated = getUpdatedAtLike(a).getTime();
      const bUpdated = getUpdatedAtLike(b).getTime();

      switch (trashSortKey) {
        case "date": {
          const ad = new Date(a.startDate.getFullYear(), a.startDate.getMonth(), a.startDate.getDate()).getTime();
          const bd = new Date(b.startDate.getFullYear(), b.startDate.getMonth(), b.startDate.getDate()).getTime();
          return cmpNum(ad, bd) * dirMul;
        }

        case "time":
          return cmpNum(a.startDate.getTime(), b.startDate.getTime()) * dirMul;

        case "description":
          return (
            cmpStr(`${a.title ?? ""} ${a.description ?? ""}`.trim(), `${b.title ?? ""} ${b.description ?? ""}`.trim()) *
            dirMul
          );

        case "type":
          return cmpStr(String(a.appointmentType ?? ""), String(b.appointmentType ?? "")) * dirMul;

        case "updated":
          return cmpNum(aUpdated, bUpdated) * dirMul;

        default:
          return 0;
      }
    });

    return list;
  }, [trashFiltered, trashSortKey, trashSortDir]);

  /** ---------- pagination derived (Termine) ---------- */

  const totalPages = useMemo(() => Math.max(1, Math.ceil(topList.length / perPage)), [topList.length, perPage]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    fromDate,
    toDate,
    quickRange,
    sortKey,
    sortDir,
    selectedStatuses.join("|"),
    selectedUserIds.join("|"),
    selectedTypeKeys.join("|"),
    perPage,
    hideRecurring,
  ]);

  const pagedTop = useMemo(() => {
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return topList.slice(start, end);
  }, [topList, page, perPage]);

  const shownFrom = useMemo(() => (topList.length === 0 ? 0 : (page - 1) * perPage + 1), [
    topList.length,
    page,
    perPage,
  ]);
  const shownTo = useMemo(() => Math.min(page * perPage, topList.length), [page, perPage, topList.length]);

  const pageWindow = useMemo(() => {
    const maxBtns = 5;
    if (totalPages <= maxBtns) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const half = Math.floor(maxBtns / 2);
    let start = Math.max(1, page - half);
    let end = Math.min(totalPages, start + maxBtns - 1);
    start = Math.max(1, end - maxBtns + 1);
    const arr: number[] = [];
    for (let p = start; p <= end; p++) arr.push(p);
    return arr;
  }, [page, totalPages]);

  const showPagination = useMemo(() => topList.length >= 20, [topList.length]);
  const showPagerControls = useMemo(() => totalPages > 1, [totalPages]);

  /** ---------- thumbs for visible rows (both lists) ---------- */

  useEffect(() => {
    if (!roleLoaded) return;

    const visibleIds = new Set<string>();
    pagedTop.slice(0, 180).forEach((a) => visibleIds.add(a.id));
    if (showTrash) trashList.slice(0, 180).forEach((a) => visibleIds.add(a.id));

    for (const id of visibleIds) ensureThumbSubscription(id);

    for (const id of Object.keys(thumbUnsubsRef.current)) {
      if (!visibleIds.has(id)) dropThumbSubscription(id);
    }
  }, [roleLoaded, pagedTop, trashList, showTrash]);

  /** ---------- logout ---------- */

  async function logout() {
    await signOut(auth);
    router.push("/login");
  }

  /** ---------- status click ---------- */

  const statusCycle: AppointmentStatus[] = ["open", "documented", "done"];

  function nextStatus(cur: AppointmentStatus): AppointmentStatus {
    const idx = statusCycle.indexOf(cur);
    if (idx === -1) return "open";
    return statusCycle[(idx + 1) % statusCycle.length];
  }

  async function handleStatusClick(e: React.MouseEvent, appt: ApptRow) {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin) return;

    const current = appt.status as AppointmentStatus;
    const nxt = nextStatus(current);

    try {
      const now = Timestamp.now();
      const meUid = auth.currentUser?.uid ?? null;

      const patch: any = { status: nxt, updatedAt: now };

      if (nxt === "done") patch.doneAt = now;
      else patch.doneAt = null;

      if (nxt === "documented") {
        patch.documentedAt = now;
        patch.documentedByUserId = meUid;
      } else {
        patch.documentedAt = null;
        patch.documentedByUserId = null;
      }

      await updateDoc(doc(db, "appointments", appt.id), patch);
    } catch (err) {
      console.error(err);
      alert("Status ändern fehlgeschlagen.");
    }
  }

  /** ---------- trash selection + actions ---------- */

  function clearTrashSelection() {
    setSelectedTrashIds({});
  }

  const selectedTrashIdsList = useMemo(
    () => Object.keys(selectedTrashIds).filter((k) => selectedTrashIds[k]),
    [selectedTrashIds]
  );

  async function restoreOne(id: string) {
    if (!isAdmin) return;

    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, "appointments", id), { deletedAt: null, status: "open", updatedAt: now });
      setSelectedTrashIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error(err);
      alert("Wiederherstellen fehlgeschlagen.");
    }
  }

  async function restoreMany(ids: string[]) {
    if (!isAdmin) return;
    if (ids.length === 0) return;

    try {
      const now = Timestamp.now();
      await Promise.all(
        ids.map((id) => updateDoc(doc(db, "appointments", id), { deletedAt: null, status: "open", updatedAt: now }))
      );
      clearTrashSelection();
    } catch (err) {
      console.error(err);
      alert("Mehrfach-Wiederherstellung fehlgeschlagen.");
    }
  }

  async function restoreAllInTrash() {
    if (!isAdmin) return;
    const ids = trashFiltered.map((a) => a.id);
    if (ids.length === 0) return;
    await restoreMany(ids);
  }

  async function deleteMany(ids: string[]) {
    if (!isAdmin) return;
    if (ids.length === 0) return;

    const ok = confirm(
      `Wirklich ${ids.length} Termin(e) endgültig löschen?\n\nDabei werden auch Fotos/Links vollständig entfernt.\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`
    );
    if (!ok) return;

    try {
      for (const id of ids) {
        await apiHardDeleteAppointment(id);
      }
      clearTrashSelection();
      alert("✅ Endgültig gelöscht.");
    } catch (err) {
      console.error(err);
      alert("Endgültiges Löschen fehlgeschlagen.");
    }
  }

  const allTrashSelected = useMemo(() => {
    if (!trashFiltered.length) return false;
    for (const a of trashFiltered) if (!selectedTrashIds[a.id]) return false;
    return true;
  }, [trashFiltered, selectedTrashIds]);

  function toggleSelectAllTrash() {
    if (!trashFiltered.length) return;

    if (allTrashSelected) {
      setSelectedTrashIds((prev) => {
        const next = { ...prev };
        for (const a of trashFiltered) delete next[a.id];
        return next;
      });
    } else {
      setSelectedTrashIds((prev) => {
        const next = { ...prev };
        for (const a of trashFiltered) next[a.id] = true;
        return next;
      });
    }
  }

  /** ---------- columns ---------- */

  // ✅ Terminart-Spalte für User ausblenden
  const colsHeaderMain = useMemo(() => {
    if (isAdmin) return "130px 110px 140px 2.4fr 220px 260px 170px 140px"; // Status, Datum, Uhrzeit, Beschr, Typ, User, Updated, Fotos
    return "130px 110px 140px 2.9fr 170px 140px"; // Status, Datum, Uhrzeit, Beschr, Updated, Fotos (ohne Typ)
  }, [isAdmin]);

  const colsHeaderTrash = useMemo(() => {
    if (isAdmin) return "280px 110px 140px 2.4fr 140px 180px 170px 140px";
    return "280px 110px 140px 2.7fr 140px 170px 140px";
  }, [isAdmin]);

  function SortHeader({ label, k, defaultDir }: { label: string; k: SortKey; defaultDir: SortDir }) {
    const active = sortKey === k;

    return (
      <button
        type="button"
        onClick={() => toggleSort(k, defaultDir)}
        title={`Sortieren nach ${label}`}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 6px",
          borderRadius: 10,
          border: active ? "1px solid rgba(59,130,246,0.35)" : "1px solid transparent",
          background: active ? "rgba(59,130,246,0.08)" : "transparent",
          transition: "background 120ms ease, border-color 120ms ease",
          fontFamily: FONT_FAMILY,
          fontWeight: FW_SEMI,
          fontSize: 12.5,
        }}
      >
        <span>{label}</span>
        <span style={{ color: active ? "#1d4ed8" : "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>
          {sortArrow(active, sortDir)}
        </span>
      </button>
    );
  }

  function TrashSortHeader({ label, k, defaultDir }: { label: string; k: TrashSortKey; defaultDir: SortDir }) {
    const active = trashSortKey === k;

    return (
      <button
        type="button"
        onClick={() => toggleTrashSort(k, defaultDir)}
        title={`Sortieren nach ${label}`}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 6px",
          borderRadius: 10,
          border: active ? "1px solid rgba(59,130,246,0.35)" : "1px solid transparent",
          background: active ? "rgba(59,130,246,0.08)" : "transparent",
          transition: "background 120ms ease, border-color 120ms ease",
          fontFamily: FONT_FAMILY,
          fontWeight: FW_SEMI,
          fontSize: 12.5,
        }}
      >
        <span>{label}</span>
        <span style={{ color: active ? "#1d4ed8" : "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>
          {sortArrow(active, trashSortDir)}
        </span>
      </button>
    );
  }

  /** ---------- chips ---------- */

  const allStatusActive = statusSel.open && statusSel.documented && statusSel.done;
  const allChipActive = isAdmin && allStatusActive && showTrash;

  function onClickAllChip() {
    if (!isAdmin) return;

    if (allChipActive) {
      setStatusSel({ open: false, documented: false, done: false });
      setShowTrash(false);
      return;
    }

    setStatusSel({ open: true, documented: true, done: true });
    setShowTrash(true);
  }

  function onClickStatusChip(k: StatusKey) {
    setStatusSel((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function onClickTrashChip() {
    if (!isAdmin) return;

    setSelectedTrashIds({});
    setUserPickerOpen(false);
    setTypePickerOpen(false);
    setShowTrash((v) => !v);
    setPage(1);
  }

  /** ---------- user picker ---------- */

  function toggleUser(uid: string) {
    setSelectedUserIds((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  function clearUsers() {
    setSelectedUserIds([]);
  }

  const selectedUserLabel = useMemo(() => {
    if (!userOptions.length) return "Alle";
    if (!selectedUserIds.length) return "Alle";

    const allUids = userOptions.map((u) => u.uid);
    const allSelected = allUids.every((id) => selectedUserIds.includes(id));
    if (allSelected) return "Alle";

    const names = selectedUserIds
      .map((id) => userOptions.find((u) => u.uid === id)?.name ?? "—")
      .filter(Boolean);

    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [selectedUserIds, userOptions]);

  /** ---------- row nav ---------- */

  const isTrashViewOnly = useMemo(
    () => isAdmin && showTrash && selectedStatuses.length === 0,
    [isAdmin, showTrash, selectedStatuses.length]
  );

  const seriesChipLabel = useMemo(() => `Serientermine: ${hideRecurring ? "Aus" : "An"}`, [hideRecurring]);

  return (
    <main
      style={{
        maxWidth: 1600,
        margin: "24px auto",
        padding: 16,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_REG,
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 auto" }}>
          <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <img src="/web/logo.svg" alt="Logo" style={{ height: 110, width: "auto", display: "block", margin: 0 }} />
            <p style={{ color: "#6b7280", margin: 0, fontFamily: FONT_FAMILY, fontWeight: FW_MED, fontSize: 13 }}>
              {displayName} • Rolle: <span style={{ fontWeight: FW_SEMI }}>{roleLoaded ? roleLabel(role) : "…"}</span>
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Btn onClick={() => router.push("/appointments/new")} variant="primary">
            + Termin
          </Btn>
          <Btn onClick={() => router.push("/profile")} variant="secondary">
            Profil
          </Btn>
          <Btn onClick={logout} variant="secondary">
            Logout
          </Btn>
        </div>
      </header>

      {/* ✅ Suche (oben) — einklappbar nur mit +/- */}
      <section
        style={{
          marginTop: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          background: "white",
          padding: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Suche</div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {search.trim().length > 0 && !isTrashViewOnly && (
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: "linear-gradient(#fff,#f7f7fb)",
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                  fontSize: 12.5,
                  color: "#111827",
                  whiteSpace: "nowrap",
                }}
                title="Anzahl Treffer (Termine oben)"
              >
                {topList.length} Treffer
              </div>
            )}
            <FoldBtn open={showSearch} onClick={() => setShowSearch((v) => !v)} title={showSearch ? "Suche einklappen" : "Suche ausklappen"} />
          </div>
        </div>

        {showSearch && (
          <div style={{ marginTop: 10 }}>
            <input
              className="searchInput"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                isAdmin
                  ? "Suche (Titel, Beschreibung, Terminart, Doku-Text, Admin-Notiz, Status, Username …)"
                  : "Suche (Titel, Beschreibung, Doku-Text …)"
              }
              style={{
  width: "100%",
  maxWidth: 920,        // ⬅️ DAS ist der Fix
  margin: "0 auto",     // ⬅️ zentriert im weißen Kasten
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  fontFamily: FONT_FAMILY,
  fontWeight: FW_MED,
  fontSize: 13.5,
  outline: "none",
  boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
}}

            />
          </div>
        )}
      </section>

      {/* ✅ Filter — einklappbar nur mit +/- */}
      <section style={{ marginTop: 12, padding: 14, border: "1px solid #e5e7eb", borderRadius: 18, background: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Filter</div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {showFilters && (
  <Btn variant="secondary" compact onClick={resetFilters} title="Alle Filter & Sortierung zurücksetzen">
    Zurücksetzen
  </Btn>
)}

            <FoldBtn open={showFilters} onClick={() => setShowFilters((v) => !v)} title={showFilters ? "Filter einklappen" : "Filter ausklappen"} />
          </div>
        </div>

        {showFilters && (
          <>
            {isAdmin && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                <Chip active={allChipActive} label="Alle" tone="neutral" onClick={onClickAllChip} />
                <Chip active={!!statusSel.open} label={statusLabel("open")} tone="open" onClick={() => onClickStatusChip("open")} />
                <Chip
                  active={!!statusSel.documented}
                  label={statusLabel("documented")}
                  tone="documented"
                  onClick={() => onClickStatusChip("documented")}
                />
                <Chip active={!!statusSel.done} label={statusLabel("done")} tone="done" onClick={() => onClickStatusChip("done")} />
                <Chip active={showTrash} label="Papierkorb" tone="trash" onClick={onClickTrashChip} />
              </div>
            )}

            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
                position: "relative",
                overflow: "visible",
                zIndex: 50,
              }}
            >
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  color: "#111827",
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                  fontSize: 13,
                }}
              >
                Von
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    const nf = e.target.value;
                    setFromDate(nf);
                    setQuickRange(detectQuickRange(nf, toDate));
                  }}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_MED,
                    fontSize: 13,
                  }}
                />
              </label>

              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  color: "#111827",
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                  fontSize: 13,
                }}
              >
                Bis
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    const nt = e.target.value;
                    setToDate(nt);
                    setQuickRange(detectQuickRange(fromDate, nt));
                  }}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_MED,
                    fontSize: 13,
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Chip active={quickRange === "past"} label="Vergangene" tone="quick" onClick={applyPastRange} />
                <Chip active={quickRange === "today"} label="Heute" tone="quick" onClick={() => applyQuickRange(t0, t0, "today")} />
                <Chip
                  active={quickRange === "tomorrow"}
                  label="Morgen"
                  tone="quick"
                  onClick={() => applyQuickRange(t1, t1, "tomorrow")}
                />
                <Chip active={quickRange === "week"} label="Woche" tone="quick" onClick={() => applyQuickRange(t0, startOfDayPlus(6), "week")} />
                <Chip
                  active={quickRange === "month"}
                  label="Monat"
                  tone="quick"
                  onClick={() => applyQuickRange(t0, startOfDayPlus(29), "month")}
                />
                <Chip active={quickRange === "all"} label="Alle" tone="quick" onClick={applyAllRange} />
              </div>
            </div>
          </>
        )}
      </section>

      {/* OBERE LISTE */}
      {!isTrashViewOnly && (
        <section style={{ marginTop: 12, padding: 16, border: "1px solid #e5e7eb", borderRadius: 18, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 17, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>Termine</h2>

            {isAdmin && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {activeStatusOrder.map((k) => {
                  const count = k === "open" ? mainCounts.open : k === "documented" ? mainCounts.documented : mainCounts.done;
                  if (!count) return null;
                  return <CountPill key={k} tone={k} count={count} label={statusLabel(k)} />;
                })}
              </div>
            )}

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Chip active={!hideRecurring} label={seriesChipLabel} tone="series" onClick={() => setHideRecurring((v) => !v)} />
            </div>
          </div>

          <>
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 14,
                border: "1px solid #eef2f7",
                background: "linear-gradient(#ffffff,#f7f7fb)",
                position: "relative",
                overflow: "visible",
                zIndex: 60,
              }}
            >
              <div className={`apptHeaderRow ${isAdmin ? "isAdmin" : "isUser"}`} style={{ display: "grid", gridTemplateColumns: colsHeaderMain, gap: 10, alignItems: "center" }}>
                <SortHeader label="Status" k="status" defaultDir="asc" />
                <SortHeader label="Datum" k="date" defaultDir="desc" />
                <SortHeader label="Uhrzeit" k="time" defaultDir="desc" />
                <SortHeader label="Beschreibung" k="description" defaultDir="asc" />

                {/* ✅ Terminart Header nur für Admin */}
                {isAdmin ? (
                  <div ref={typePickerRef} style={{ position: "relative", overflow: "visible", minWidth: 0 }}>
                    <PickerButton
                      size="header"
                      labelLeft="Terminart"
                      valueLabel={selectedTypeLabel}
                      onToggle={() => {
                        setTypePickerOpen((v) => !v);
                        setUserPickerOpen(false);
                      }}
                    />
                    {typePickerOpen && (
                      <PickerPanel
                        title="Terminart auswählen"
                        items={typeOptions.map((x) => ({ key: x.key, label: x.label }))}
                        selectedKeys={selectedTypeKeys}
                        onToggleKey={toggleType}
                        onClear={clearTypes}
                        onClose={() => setTypePickerOpen(false)}
                        width={300}
                      />
                    )}
                  </div>
                ) : null}

                {isAdmin ? (
                  <div ref={userPickerRef} style={{ position: "relative", overflow: "visible", minWidth: 0 }}>
                    <PickerButton
                      size="header"
                      labelLeft="User"
                      valueLabel={selectedUserLabel}
                      onToggle={() => {
                        setUserPickerOpen((v) => !v);
                        setTypePickerOpen(false);
                      }}
                    />
                    {userPickerOpen && (
                      <PickerPanel
                        title="User auswählen"
                        items={userOptions.map((u) => ({ key: u.uid, label: u.name }))}
                        selectedKeys={selectedUserIds}
                        onToggleKey={toggleUser}
                        onClear={clearUsers}
                        onClose={() => setUserPickerOpen(false)}
                        width={360}
                        showSelectAll
                        hideClearButton
                      />
                    )}
                  </div>
                ) : null}

                <SortHeader label="Letzte Änderung" k="updated" defaultDir="desc" />
                <div
                  style={{
                    justifySelf: "end",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_SEMI,
                    fontSize: 12.5,
                    color: "#111827",
                  }}
                >
                  Fotos
                </div>
              </div>
            </div>

            {topList.length === 0 ? (
              <p style={{ color: "#666", marginTop: 12, fontFamily: FONT_FAMILY, fontWeight: FW_REG, fontSize: 13 }}>
                Keine Termine gefunden.
              </p>
            ) : (
              <>
                <ul style={{ marginTop: 10, display: "grid", gap: 8, paddingLeft: 0, listStyle: "none" }}>
                  {pagedTop.map((a) => {
                    const updated = getUpdatedAtLike(a);
                    const isSeries = !!(a.isRecurring || a.seriesId);
                    return (
                      <li
                        key={a.id}
                        className="rowCard"
                        style={{ padding: "10px 12px", border: "1px solid #eee", borderRadius: 14 }}
                        onClick={() => router.push(`/appointments/${a.id}`)}
                      >
                        <div
                          className={`apptGridMain ${isAdmin ? "isAdmin" : "isUser"}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: colsHeaderMain,
                            gap: 10,
                            alignItems: "center",
                            minWidth: 0,
                          }}
                        >
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <StatusPill status={a.status as any} clickable={isAdmin} onClick={(e) => handleStatusClick(e, a)} />
                            {isSeries && (
                              <span
                                aria-label="Serientermin"
                                title="Serientermin"
                                style={{
                                  color: "#6b7280",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                  fontSize: 13,
                                  lineHeight: 1,
                                  userSelect: "none",
                                }}
                              >
                                ↻
                              </span>
                            )}
                          </div>

                          <div style={{ ...CELL_PAD, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                            {displayDateLabel(a)}
                          </div>

                          <div
                            style={{
                              ...CELL_PAD,
                              color: "#6b7280",
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_SEMI,
                              fontSize: 13,
                            }}
                          >
                            {displayTimeLabel(a)}
                          </div>

                          <div style={{ ...CELL_PAD, minWidth: 0 }}>
                            <div className="clamp1" style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }} title={a.title}>
                              {a.title}
                            </div>
                            {a.description?.trim() ? (
                              <div
                                className="clamp2"
                                style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED, fontSize: 12 }}
                                title={a.description}
                              >
                                {a.description}
                              </div>
                            ) : null}
                          </div>

                          {/* ✅ Terminart-Zelle nur für Admin */}
                          {isAdmin ? (
                            <div
                              className="clamp1"
                              style={{ ...CELL_PAD, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}
                              title={a.appointmentType || "—"}
                            >
                              {a.appointmentType || "—"}
                            </div>
                          ) : null}

                          {isAdmin ? (
                            <div
                              className="clamp1"
                              style={{ ...CELL_PAD, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}
                              title={userFullName(a.createdByUserId) || "—"}
                            >
                              {userFullName(a.createdByUserId) || "—"}
                            </div>
                          ) : null}

                          <div style={{ ...CELL_PAD, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                            {fmtDate(updated)} • {fmtTime(updated)}
                          </div>

                          <div style={{ justifySelf: "end" }}>
                            <PhotoCell url={thumbs[a.id]} count={photoCounts[a.id] ?? a.photoCount ?? 0} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {showPagination && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid #e5e7eb", background: "linear-gradient(#fff,#f7f7fb)" }}>
                      {shownFrom}–{shownTo} <span style={{ color: "#6b7280" }}>/ {topList.length}</span>
                    </div>

                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                      Pro Seite
                      <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} style={{ padding: "8px 10px", borderRadius: 999, border: "1px solid #e5e7eb" }}>
                        {[20, 50, 100, 200].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>

                    {showPagerControls && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 6, borderRadius: 999, border: "1px solid #e5e7eb" }}>
                        <IconBtn onClick={() => setPage(1)} disabled={page <= 1} title="Erste Seite">
                          «
                        </IconBtn>
                        <IconBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} title="Vorherige Seite">
                          ‹
                        </IconBtn>

                        {pageWindow.map((p) => {
                          const active = p === page;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setPage(p)}
                              style={{
                                minWidth: 38,
                                height: 32,
                                padding: "0 10px",
                                borderRadius: 12,
                                border: active ? "1px solid rgba(29,78,216,0.45)" : "1px solid #e5e7eb",
                                background: active ? "rgba(29,78,216,0.10)" : "linear-gradient(#fff,#f3f4f6)",
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                                color: active ? "#1d4ed8" : "#111827",
                                cursor: "pointer",
                                fontSize: 13,
                              }}
                            >
                              {p}
                            </button>
                          );
                        })}

                        <IconBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} title="Nächste Seite">
                          ›
                        </IconBtn>
                        <IconBtn onClick={() => setPage(totalPages)} disabled={page >= totalPages} title="Letzte Seite">
                          »
                        </IconBtn>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        </section>
      )}

      {/* PAPIERKORB (unverändert, nur Admin) */}
      {isAdmin && showTrash && (
        <section style={{ marginTop: 12, padding: 16, border: "1px solid #e5e7eb", borderRadius: 18, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 17, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>Papierkorb</h2>
            {trashFiltered.length > 0 ? <CountPill tone="trash" count={trashFiltered.length} label="Gelöscht" /> : null}

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="secondary" onClick={() => restoreMany(selectedTrashIdsList)} disabled={selectedTrashIdsList.length === 0}>
                Auswahl wiederherstellen ({selectedTrashIdsList.length})
              </Btn>

              <Btn variant="secondary" onClick={restoreAllInTrash} disabled={trashFiltered.length === 0}>
                Alle wiederherstellen
              </Btn>
            </div>
          </div>

          {trashList.length === 0 ? (
            <p style={{ color: "#666", marginTop: 12, fontFamily: FONT_FAMILY, fontWeight: FW_REG, fontSize: 13 }}>Papierkorb ist leer.</p>
          ) : (
            <>
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 14,
                  border: "1px solid #fce7e7",
                  background: "linear-gradient(#ffffff,#fff5f5)",
                }}
              >
                <div className={`trashHeaderGrid ${isAdmin ? "isAdmin" : "isUser"}`} style={{ display: "grid", gridTemplateColumns: colsHeaderTrash, gap: 10, alignItems: "center" }}>
                  <div className="trashActionsHeader" style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12.5, color: "#111827" }}></div>
                  <TrashSortHeader label="Datum" k="date" defaultDir="desc" />
                  <TrashSortHeader label="Uhrzeit" k="time" defaultDir="desc" />
                  <TrashSortHeader label="Beschreibung" k="description" defaultDir="asc" />
                  <TrashSortHeader label="Terminart" k="type" defaultDir="asc" />
                  <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12.5, color: "#111827" }}>User</div>
                  <TrashSortHeader label="Letzte Änderung" k="updated" defaultDir="desc" />
                  <div style={{ justifySelf: "end", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12.5, color: "#111827" }}>
                    Fotos
                  </div>
                </div>
              </div>

              <ul style={{ marginTop: 10, display: "grid", gap: 8, paddingLeft: 0, listStyle: "none" }}>
                {trashList.slice(0, 240).map((a) => {
                  const updated = getUpdatedAtLike(a);
                  const userName = userFullName(a.createdByUserId);
                  const isSeries = !!(a.isRecurring || a.seriesId);

                  return (
                    <li key={a.id} className="rowCardTrash" style={{ padding: "10px 12px", border: "1px solid #eee", borderRadius: 14 }}>
                      <div className={`apptGridTrash ${isAdmin ? "isAdmin" : "isUser"}`} style={{ display: "grid", gridTemplateColumns: colsHeaderTrash, gap: 10, alignItems: "center", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={!!selectedTrashIds[a.id]}
                            onChange={() => setSelectedTrashIds((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                            style={{ width: 16, height: 16, cursor: "pointer" }}
                          />

                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <StatusPill status={"deleted"} clickable={false} />
                            {isSeries && (
                              <span
                                aria-label="Serientermin"
                                title="Serientermin"
                                style={{
                                  color: "#6b7280",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                  fontSize: 13,
                                  lineHeight: 1,
                                  userSelect: "none",
                                }}
                              >
                                ↻
                              </span>
                            )}
                          </div>

                          <Btn compact variant="secondary" onClick={() => restoreOne(a.id)} style={{ padding: "8px 10px", borderRadius: 999 }}>
                            Wiederherstellen
                          </Btn>
                        </div>

                        <div style={{ padding: "3px 6px", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                          {displayDateLabel(a)}
                        </div>

                        <div style={{ padding: "3px 6px", color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                          {displayTimeLabel(a)}
                        </div>

                        <div style={{ padding: "3px 6px", minWidth: 0 }}>
                          <div className="clamp1" style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => router.push(`/appointments/${a.id}`)}
                              style={{
                                cursor: "pointer",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
                                textDecorationColor: "rgba(29,78,216,0.35)",
                              }}
                            >
                              {a.title}
                            </span>
                          </div>
                          {a.description?.trim() ? (
                            <div className="clamp2" style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED, fontSize: 12 }} title={a.description}>
                              {a.description}
                            </div>
                          ) : null}
                        </div>

                        <div className="clamp1" style={{ padding: "3px 6px", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }} title={a.appointmentType || "—"}>
                          {a.appointmentType || "—"}
                        </div>

                        <div className="clamp1" style={{ padding: "3px 6px", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }} title={userName || "—"}>
                          {userName || "—"}
                        </div>

                        <div style={{ padding: "3px 6px", color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13 }}>
                          {fmtDate(updated)} • {fmtTime(updated)}
                        </div>

                        <div style={{ justifySelf: "end" }}>
                          <PhotoCell url={thumbs[a.id]} count={photoCounts[a.id] ?? a.photoCount ?? 0} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="trashActions" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <div className="trashBulkBar" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Btn variant="secondary" onClick={toggleSelectAllTrash} disabled={trashFiltered.length === 0}>
                    {allTrashSelected ? "Alle abwählen" : "Alle auswählen"}
                  </Btn>

                  <Btn variant="secondary" onClick={clearTrashSelection} disabled={selectedTrashIdsList.length === 0}>
                    Auswahl löschen
                  </Btn>
                </div>

                <div className="trashBulkRight" style={{ marginLeft: "auto" }}>
                  <Btn variant="danger" onClick={() => deleteMany(selectedTrashIdsList)} disabled={selectedTrashIdsList.length === 0}>
                    Termine endgültig löschen ({selectedTrashIdsList.length})
                  </Btn>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <style jsx>{`
        :global(body) {
          font-family: ${FONT_FAMILY};
          font-weight: ${FW_REG};
        }
        :global(b),
        :global(strong) {
          font-weight: ${FW_SEMI};
        }

        .clamp1 {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .clamp2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-width: 0;
        }

        .rowCard {
          cursor: pointer;
          transition: transform 80ms ease, box-shadow 120ms ease, background 120ms ease, border-color 120ms ease;
          background: #fff;
        }
        .rowCard:hover {
          background: linear-gradient(#fbfdff, #f6faff);
          border-color: #bfdbfe;
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06), 0 14px 30px rgba(37, 99, 235, 0.08);
          transform: translateY(-1px);
        }

        .rowCardTrash {
          background: #fff;
          transition: box-shadow 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        .rowCardTrash:hover {
          background: linear-gradient(#fffafa, #fff5f5);
          border-color: #fecaca;
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06), 0 12px 26px rgba(220, 38, 38, 0.06);
        }
      

        /* Prevent search overflow on web & mobile */
        .searchInput {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Mobile layout for appointment & trash rows (no duplicates) */
        @media (max-width: 820px), (pointer: coarse) {
          /* Mobile: Header-Filter in 3 Zeilen (kein Überlauf) */
          .apptHeaderRow,
          .trashHeaderGrid {
            display: flex !important;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
          }
          .apptHeaderRow > *,
          .trashHeaderGrid > * {
            min-width: 0;
          }

          /* MAIN (Admin): 1 Status,2 Datum,3 Uhrzeit,4 Beschreibung,5 Terminart,6 User,7 Letzte Änderung,8 Fotos */
          .apptHeaderRow.isAdmin > :nth-child(3),
          .apptHeaderRow.isAdmin > :nth-child(5),
          .apptHeaderRow.isAdmin > :nth-child(8) {
            display: none !important;
          }
          .apptHeaderRow.isAdmin > :nth-child(1),
          .apptHeaderRow.isAdmin > :nth-child(2),
          .apptHeaderRow.isAdmin > :nth-child(4),
          .apptHeaderRow.isAdmin > :nth-child(6) {
            flex: 1 1 calc(50% - 10px);
          }
          .apptHeaderRow.isAdmin > :nth-child(7) {
            flex: 1 1 100%;
          }

          /* MAIN (User): 1 Status,2 Datum,3 Uhrzeit,4 Beschreibung,5 Letzte Änderung,6 Fotos */
          .apptHeaderRow.isUser > :nth-child(3),
          .apptHeaderRow.isUser > :nth-child(6) {
            display: none !important;
          }
          .apptHeaderRow.isUser > :nth-child(1),
          .apptHeaderRow.isUser > :nth-child(2) {
            flex: 1 1 calc(50% - 10px);
          }
          .apptHeaderRow.isUser > :nth-child(4) {
            flex: 1 1 calc(50% - 10px);
          }
          .apptHeaderRow.isUser > :nth-child(5) {
            flex: 1 1 100%;
          }

          /* TRASH (Admin): 1 Aktionen,2 Datum,3 Uhrzeit,4 Beschreibung,5 Terminart,6 User,7 Letzte Änderung,8 Fotos */
          .trashHeaderGrid.isAdmin > :nth-child(3),
          .trashHeaderGrid.isAdmin > :nth-child(5),
          .trashHeaderGrid.isAdmin > :nth-child(8) {
            display: none !important;
          }
          .trashHeaderGrid.isAdmin > :nth-child(1),
          .trashHeaderGrid.isAdmin > :nth-child(2),
          .trashHeaderGrid.isAdmin > :nth-child(4),
          .trashHeaderGrid.isAdmin > :nth-child(6) {
            flex: 1 1 calc(50% - 10px);
          }
          .trashHeaderGrid.isAdmin > :nth-child(7) {
            flex: 1 1 100%;
          }

          /* TRASH (User): (falls ohne Terminart/User) */
          .trashHeaderGrid.isUser > :nth-child(3),
          .trashHeaderGrid.isUser > :nth-child(8) {
            display: none !important;
          }

          .apptGridMain,
          .apptGridTrash {
            grid-template-columns: 1fr auto !important;
            gap: 8px !important;
            align-items: start !important;
          }

          /* ---- MAIN LIST ---- */
          .apptGridMain.isAdmin {
            grid-template-areas:
              "status status"
              "date time"
              "desc type"
              "user updated"
              "photos photos";
          }
          .apptGridMain.isUser {
            grid-template-areas:
              "status status"
              "date time"
              "desc desc"
              "updated updated"
              "photos photos";
          }

          .apptGridMain > :nth-child(1) { grid-area: status; }
          .apptGridMain > :nth-child(2) { grid-area: date; }
          .apptGridMain > :nth-child(3) { grid-area: time; }
          .apptGridMain > :nth-child(4) { grid-area: desc; }

          .apptGridMain.isAdmin > :nth-child(5) { grid-area: type; }
          .apptGridMain.isAdmin > :nth-child(6) { grid-area: user; }
          .apptGridMain.isAdmin > :nth-child(7) { grid-area: updated; }
          .apptGridMain.isAdmin > :nth-child(8) { grid-area: photos; justify-self: start !important; }

          .apptGridMain.isUser > :nth-child(5) { grid-area: updated; }
          .apptGridMain.isUser > :nth-child(6) { grid-area: photos; justify-self: start !important; }

          /* Photos left-aligned */
          .apptGridMain :global(.photoCell),
          .apptGridTrash :global(.photoCell) {
            justify-content: flex-start !important;
          }

          /* ---- TRASH LIST ---- */
          .apptGridTrash {
            grid-template-areas:
              "status status"
              "date time"
              "desc type"
              "user updated"
              "photos photos";
          }
          .apptGridTrash > :nth-child(1) { grid-area: status; }
          .apptGridTrash > :nth-child(2) { grid-area: date; }
          .apptGridTrash > :nth-child(3) { grid-area: time; }
          .apptGridTrash > :nth-child(4) { grid-area: desc; }
          .apptGridTrash > :nth-child(5) { grid-area: type; }
          .apptGridTrash > :nth-child(6) { grid-area: user; }
          .apptGridTrash > :nth-child(7) { grid-area: updated; }
          .apptGridTrash > :nth-child(8) { grid-area: photos; justify-self: start !important; }
        

          /* TRASH header: Aktionen label ausblenden (Mobile) */
          .trashActionsHeader {
            display: none !important;
          }

          /* Papierkorb Bulk-Buttons (Mobile) */
          .trashActions {
            flex-wrap: wrap !important;
            gap: 10px !important;
          }

          /* Links (enthält: Alle auswählen + Auswahl löschen) */
          .trashBulkBar {
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: center !important;
            gap: 10px !important;
            width: 100%;
            flex: 1 1 100%;
          }

          /* Alle auswählen (1. Button) */
          .trashBulkBar > :nth-child(1) {
            flex: 1 1 calc(50% - 6px) !important;
            min-width: 0;
          }

          /* Auswahl löschen (2. Button) -> zweite Zeile */
          .trashBulkBar > :nth-child(2) {
            flex: 1 1 100% !important;
            order: 3;
            min-width: 0;
          }

          /* Rechts (Endgültig löschen) -> erste Zeile rechts */
          .trashBulkRight {
            flex: 1 1 calc(50% - 6px) !important;
            order: 2;
            width: auto !important;
            margin-left: 0 !important;
            min-width: 0;
          }

          .trashBulkBar :global(button),
          .trashBulkRight :global(button) {
            width: 100% !important;
          }
}
        /* Photos: hide placeholder on mobile */
        @media (max-width: 820px) {
          .photoPlaceholder {
            display: none !important;
          }
        }

`}
</style>
    </main>
  );
}
