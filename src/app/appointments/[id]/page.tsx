"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role, AppointmentStatus } from "@/lib/types";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import JSZip from "jszip";

/** ---------- typography ---------- */
const FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
const FW_REG = 500;
const FW_MED = 550;
const FW_SEMI = 600;

/** ---------- helpers ---------- */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toTimeInputValue(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseLocalDateTime(dateStr: string, timeStr: string) {
  const [y, m, dd] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, dd ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}
function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function ceilTo5Minutes(d: Date) {
  const ms = d.getTime();
  const step = 5 * 60_000;
  const rounded = Math.ceil(ms / step) * step;
  const out = new Date(rounded);
  out.setSeconds(0, 0);
  return out;
}
function fmtDateTime(d: Date) {
  const dd = d.toLocaleDateString();
  const tt = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dd} • ${tt}`;
}

/** ✅ Header-Format: "am DD.MM.YYYY um HH:MM Uhr" */
function fmtHeaderDateTime(d: Date) {
  const dd = d.toLocaleDateString("de-DE");
  const tt = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${dd} um ${tt} Uhr`;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
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

/** ✅ duration formatting */
function formatDurationLabel(totalMinutes: number) {
  const mins = Math.max(1, Math.round(totalMinutes));
  if (mins < 60) return `${mins} Minuten`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hourLabel = h === 1 ? "Stunde" : "Stunden";
    if (m === 0) return `${h} ${hourLabel}`;
    return `${h} ${hourLabel} ${m} Minuten`;
  }
  const d = Math.floor(mins / (24 * 60));
  const rest = mins % (24 * 60);
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  const dayLabel = d === 1 ? "Tag" : "Tage";
  const parts: string[] = [`${d} ${dayLabel}`];
  if (h > 0) parts.push(`${h} ${h === 1 ? "Stunde" : "Stunden"}`);
  if (m > 0) parts.push(`${m} Minuten`);
  return parts.join(" ");
}
type DurationUnitUi = "minutes" | "hours" | "days";

function unitUiFactor(u: DurationUnitUi) {
  if (u === "minutes") return 1;
  if (u === "hours") return 60;
  return 24 * 60;
}
function toUiValueAndUnit(totalMinutes: number): { value: number; unit: DurationUnitUi } {
  const mins = Math.max(1, Math.round(totalMinutes));
  if (mins % (24 * 60) === 0) return { value: mins / (24 * 60), unit: "days" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "hours" };
  return { value: mins, unit: "minutes" };
}

/** ---------- UI ---------- */
function Btn({
  children,
  onClick,
  href,
  variant = "secondary",
  disabled,
  style,
  title,
  type = "button",
  target,
  rel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "danger" | "navy" | "mint" | "yellow" | "green";
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
  type?: "button" | "submit";
  target?: string;
  rel?: string;
}) {
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "10px 14px",
    border: "1px solid rgba(0,0,0,0.12)",
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    textDecoration: "none",
    lineHeight: 1,
  };

  const styles: Record<string, React.CSSProperties> = {
    navy: {
      background: "linear-gradient(#0f2a4a, #0b1f35)",
      color: "white",
      border: "1px solid rgba(11,31,53,0.75)",
    },
    mint: {
      background: "linear-gradient(#ecfdf5, #d1fae5)",
      color: "#065f46",
      border: "1px solid #34d399",
    },
    primary: {
      background: "linear-gradient(#f97316, #ea580c)",
      color: "white",
      border: "1px solid rgba(234,88,12,0.65)",
    },
    secondary: { background: "linear-gradient(#ffffff, #f3f4f6)", color: "#111827" },
    danger: {
      background: "linear-gradient(#ef4444, #dc2626)",
      color: "white",
      border: "1px solid rgba(220,38,38,0.6)",
    },
    yellow: {
      background: "linear-gradient(#FEF9C3, #FDE68A)",
      color: "#92400E",
      border: "1px solid rgba(251,191,36,0.9)",
    },
    green: {
      background: "linear-gradient(#DCFCE7, #BBF7D0)",
      color: "#065F46",
      border: "1px solid rgba(34,197,94,0.75)",
    },
  };

  const commonBtnProps = {
    title,
    style: { ...base, ...styles[variant], ...(style ?? {}) },
    onMouseDown: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(0.98)"),
    onMouseUp: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)"),
    onMouseLeave: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)"),
  };

  if (href) {
    if (target === "_blank") {
      return (
        <a href={href} target={target} rel={rel ?? "noreferrer"} {...commonBtnProps}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        <span {...(commonBtnProps as any)}>{children}</span>
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} {...commonBtnProps}>
      {children}
    </button>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "gray" | "yellow" | "green" | "red" | "navy";
}) {
  const map: Record<string, React.CSSProperties> = {
    gray: { background: "linear-gradient(#ffffff,#f3f4f6)", border: "1px solid #e5e7eb", color: "#111827" },
    yellow: {
      background: "linear-gradient(#FEF9C3,#FDE68A)",
      border: "1px solid rgba(251,191,36,0.9)",
      color: "#92400E",
    },
    green: {
      background: "linear-gradient(#DCFCE7,#BBF7D0)",
      border: "1px solid rgba(34,197,94,0.75)",
      color: "#065f46",
    },
    red: {
      background: "linear-gradient(#fff1f2,#ffe4e6)",
      border: "1px solid rgba(244,63,94,0.35)",
      color: "#9f1239",
    },
    navy: {
      background: "linear-gradient(#0f2a4a,#0b1f35)",
      border: "1px solid rgba(11,31,53,0.75)",
      color: "white",
    },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        ...map[tone],
      }}
    >
      {label}
    </span>
  );
}

function ChipButton({
  label,
  tone,
  onClick,
  disabled,
  title,
}: {
  label: string;
  tone: "yellow" | "green" | "red" | "blue" | "navy"; // ✅ navy ergänzt
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const map: Record<string, React.CSSProperties> = {
    yellow: {
      background: "linear-gradient(#FEF9C3,#FDE68A)",
      border: "1px solid rgba(251,191,36,0.9)",
      color: "#92400E",
    },
    green: {
      background: "linear-gradient(#DCFCE7,#BBF7D0)",
      border: "1px solid rgba(34,197,94,0.75)",
      color: "#065f46",
    },
    red: {
      background: "linear-gradient(#fff1f2,#ffe4e6)",
      border: "1px solid rgba(244,63,94,0.35)",
      color: "#9f1239",
    },
    blue: {
      background: "linear-gradient(#DBEAFE,#BFDBFE)",
      border: "1px solid rgba(147,197,253,0.95)",
      color: "#1E3A8A",
    },
    navy: {
      background: "linear-gradient(#0f2a4a, #0b1f35)",
      border: "1px solid rgba(11,31,53,0.75)",
      color: "white",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
        transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        ...map[tone],
      }}
      onMouseDown={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(0.98)")}
      onMouseUp={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)")}
      onMouseLeave={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)")}
    >
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
      style={{
        width: 54,
        height: 30,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.12)",
        background: checked ? "linear-gradient(#0f2a4a, #0b1f35)" : "linear-gradient(#ffffff, #f3f4f6)",
        boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
        display: "inline-flex",
        alignItems: "center",
        padding: 3,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 120ms ease",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_REG,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: "white",
          transform: checked ? "translateX(24px)" : "translateX(0px)",
          transition: "transform 140ms ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
        }}
      />
    </button>
  );
}

/** ---------- types ---------- */
type UserOption = { uid: string; name: string };
function niceUserName(x: any) {
  const fn = String(x?.firstName ?? "").trim();
  const ln = String(x?.lastName ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  return full || String(x?.displayName ?? "").trim() || "—";
}

type PhotoDoc = {
  id: string;
  url: string;
  path?: string;
  comment?: string;
  uploadedAt?: Date | null;
  uploadedByUserId?: string;
};

type PendingPhoto = {
  id: string;
  file: File;
  comment: string;
  previewUrl: string;
};

function uidLike() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type ApptLite = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: AppointmentStatus;
  createdByUserId?: string;
};

/** ---------- time slots ---------- */
function makeTimeSlots(stepMinutes = 5) {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += stepMinutes) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}
const TIME_SLOTS = makeTimeSlots(5);

/** -----------------------------
 * Recurrence (Serie)
 * ----------------------------- */
type RepeatUnit = "day" | "week" | "month" | "year";
type EndMode = "never" | "onDate" | "afterCount";
type RecurrenceRule = {
  enabled: boolean;
  interval: number;
  unit: RepeatUnit;
  weekdays?: number[];
  monthDay?: number;
  endMode: EndMode;
  endOnDate?: string;
  endAfterCount?: number;
};

const WEEKDAYS: { k: number; label: string }[] = [
  { k: 1, label: "Montag" },
  { k: 2, label: "Dienstag" },
  { k: 3, label: "Mittwoch" },
  { k: 4, label: "Donnerstag" },
  { k: 5, label: "Freitag" },
  { k: 6, label: "Samstag" },
  { k: 0, label: "Sonntag" },
];

function unitLabel(u: RepeatUnit) {
  if (u === "day") return "Tag";
  if (u === "week") return "Woche";
  if (u === "month") return "Monat";
  return "Jahr";
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60_000 * 60);
}
function addMonthsKeepTime(d: Date, months: number) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const hh = d.getHours();
  const mm = d.getMinutes();
  const target = new Date(y, m + months, 1, hh, mm, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}
function addYearsKeepTime(d: Date, years: number) {
  const y = d.getFullYear() + years;
  const m = d.getMonth();
  const day = d.getDate();
  const hh = d.getHours();
  const mm = d.getMinutes();
  const target = new Date(y, m, 1, hh, mm, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function generateOccurrences(params: { startDt: Date; rule: RecurrenceRule; maxCountCap: number }): Date[] {
  const { startDt, rule, maxCountCap } = params;

  let targetCount = maxCountCap;
  let endOn: Date | null = null;

  if (rule.endMode === "afterCount") {
    targetCount = clampInt(rule.endAfterCount ?? 1, 1, maxCountCap);
  } else if (rule.endMode === "onDate") {
    if (!rule.endOnDate) return [startDt];
    const [y, m, d] = rule.endOnDate.split("-").map(Number);
    endOn = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  } else {
    targetCount = maxCountCap;
  }

  const out: Date[] = [];
  const interval = clampInt(rule.interval ?? 1, 1, 999);

  const shouldStop = (candidate: Date) => {
    if (endOn && candidate.getTime() > endOn.getTime()) return true;
    if (!endOn && out.length >= targetCount) return true;
    return false;
  };

  if (rule.unit === "day") {
    let cur = new Date(startDt);
    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addDays(cur, interval);
    }
    return out;
  }

  if (rule.unit === "week") {
    const wd = (rule.weekdays?.[0] ?? startDt.getDay()) as number;
    let cur = new Date(startDt);
    const delta = (wd - cur.getDay() + 7) % 7;
    cur = addDays(cur, delta);

    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addDays(cur, interval * 7);
    }
    return out;
  }

  if (rule.unit === "month") {
    const md = clampInt(rule.monthDay ?? startDt.getDate(), 1, 27);
    let cur = new Date(startDt);
    cur = new Date(cur.getFullYear(), cur.getMonth(), md, cur.getHours(), cur.getMinutes(), 0, 0);
    if (cur.getTime() < startDt.getTime()) cur = addMonthsKeepTime(cur, interval);

    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addMonthsKeepTime(cur, interval);
      cur = new Date(cur.getFullYear(), cur.getMonth(), md, cur.getHours(), cur.getMinutes(), 0, 0);
    }
    return out;
  }

  {
    let cur = new Date(startDt);
    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addYearsKeepTime(cur, interval);
    }
    return out;
  }
}

/** batch helper for series edits */
async function commitBatches(batches: ReturnType<typeof writeBatch>[]) {
  for (const b of batches) await b.commit();
}

/** ✅ download helpers */
function filenameFromPhoto(p: PhotoDoc) {
  const fromPath = p.path ? p.path.split("/").slice(-1)[0] : "";
  if (fromPath) return fromPath;
  try {
    const u = new URL(p.url);
    const last = u.pathname.split("/").slice(-1)[0];
    return last || "foto.jpg";
  } catch {
    return "foto.jpg";
  }
}
async function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function fetchAsBlob(url: string) {
  const res = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Download fehlgeschlagen.");
  return await res.blob();
}

export default function AppointmentUnifiedPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = String((params as any)?.id ?? "");
  const isNew = rawId === "new" || !rawId;
  const id = isNew ? "" : rawId;

  /** auth/role */
  const [role, setRole] = useState<Role>("user");
  const [roleLoaded, setRoleLoaded] = useState(false);
  const isAdmin = roleLoaded && role === "admin";

  /** ✅ user name map (für Foto-Uploader + Header „Erstellt von“) */
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});

  /** loading/err/busy */
  const [ready, setReady] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** user options for admin dropdown */
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(""); // create
  const [createdByUserId, setCreatedByUserId] = useState<string>(""); // edit

  /** appointment fields */
  const APPOINTMENT_TYPES = useMemo(() => ["-", "Urlaub"] as const, []);
  const [appointmentType, setAppointmentType] = useState<(typeof APPOINTMENT_TYPES)[number]>("-");
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [durationMinutes, setDurationMinutes] = useState<number>(15);

  /** ✅ neue UX-States */
  const [durationValue, setDurationValue] = useState<number>(15);
  const [durationUnit, setDurationUnit] = useState<DurationUnitUi>("minutes");
  const [durationQuick, setDurationQuick] = useState<string>("");

  /** ✅ Ganztägig */
  const [allDay, setAllDay] = useState(false);

  /** documentation text (Admin + User) */
  const [documentationText, setDocumentationText] = useState("");

  /** status/trash info */
  const [status, setStatus] = useState<AppointmentStatus>("open");
  const [deletedAt, setDeletedAt] = useState<Date | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);

  /** ✅ created/updated for header line */
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const isTrash = !!deletedAt;
  const canEditAdmin = isAdmin && !isTrash && !isNew;
  const canEditAdminFields = isAdmin && !isTrash;

  /** photos list in edit */
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);

  /** create pending photos (new) */
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** admin edit pending photos (edit) — EXAKT wie create */
  const [adminPendingPhotos, setAdminPendingPhotos] = useState<PendingPhoto[]>([]);
  const adminFileInputRef = useRef<HTMLInputElement | null>(null);
  const [adminUploadBusy, setAdminUploadBusy] = useState(false);
  const [adminUploadErr, setAdminUploadErr] = useState<string | null>(null);

  /** ✅ user edit pending photos (edit) — EXAKT wie create */
  const [userPendingPhotos, setUserPendingPhotos] = useState<PendingPhoto[]>([]);
  const userFileInputRef = useRef<HTMLInputElement | null>(null);
  const [userDocBusy, setUserDocBusy] = useState(false);
  const [userDocErr, setUserDocErr] = useState<string | null>(null);

  /** collision UX */
  const [dayAppts, setDayAppts] = useState<ApptLite[]>([]);
  const [disabledTimes, setDisabledTimes] = useState<Set<string>>(new Set());
  const [conflictByTime, setConflictByTime] = useState<Record<string, ApptLite>>({});
  const [collisionMsgVisible, setCollisionMsgVisible] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<ApptLite | null>(null);

  /** ✅ collision: conflict open as frame */
  const [conflictFrameOpen, setConflictFrameOpen] = useState(false);

  /** SERIES (create) */
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState<number>(1);
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("week");
  const [weekdaySingle, setWeekdaySingle] = useState<number>(1);
  const [monthDay, setMonthDay] = useState<number>(1);
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [endOnDate, setEndOnDate] = useState("");
  const [endAfterCount, setEndAfterCount] = useState<number>(10);

  /** SERIES (edit) */
  const [editSeriesEnabled, setEditSeriesEnabled] = useState(false);
  const hasSeries = !!seriesId;

  /** ✅ effective duration */
  const effectiveDurationMinutes = useMemo(() => (allDay ? 24 * 60 : durationMinutes), [allDay, durationMinutes]);

  /** click outside for appointmentType dropdown */
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = typeRef.current;
      if (typeOpen && el && !el.contains(e.target as Node)) setTypeOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setTypeOpen(false);
    }
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [typeOpen]);

  useEffect(() => {
    const factor = unitUiFactor(durationUnit);
    const next = clampInt(Math.round(Number(durationValue) * factor), 1, Number.MAX_SAFE_INTEGER);
    if (next !== durationMinutes) setDurationMinutes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationValue, durationUnit]);

  /** cleanup previews */
  useEffect(() => {
    return () => {
      for (const p of pendingPhotos) URL.revokeObjectURL(p.previewUrl);
      for (const p of adminPendingPhotos) URL.revokeObjectURL(p.previewUrl);
      for (const p of userPendingPhotos) URL.revokeObjectURL(p.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** auth init */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }

      const prof = await getOrCreateUserProfile(u);
      setRole(prof.role);
      setRoleLoaded(true);

      const nowRounded = ceilTo5Minutes(new Date());
      const sDate = toDateInputValue(nowRounded);
      const sTime = toTimeInputValue(nowRounded);
      const end = addMinutes(nowRounded, 15);

      setStartDate(sDate);
      setStartTime(sTime);
      setEndDate(toDateInputValue(end));
      setEndTime(toTimeInputValue(end));
      setDurationMinutes(15);
      setDurationValue(15);
      setDurationUnit("minutes");
      setDurationQuick("");
      setAllDay(false);

      setMonthDay(clampInt(nowRounded.getDate(), 1, 27));

      setSelectedUserId(u.uid);
      setCreatedByUserId(u.uid);

      // USER default "-"
      setAppointmentType("-");

      setReady(true);
    });

    return () => unsub();
  }, [router]);

  /** ✅ load users (Name map) for EVERYONE (für Uploader/Erstellt von) */
  useEffect(() => {
    if (!roleLoaded) return;
    const qUsers = query(collection(db, "users"), limit(2000));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const map: Record<string, string> = {};
        const opts: UserOption[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const name = niceUserName(data);
          map[d.id] = name;
          opts.push({ uid: d.id, name });
        });

        opts.sort((a, b) => a.name.localeCompare(b.name, "de"));
        setUserNameById(map);

        // admin dropdown
        if (isAdmin) {
          setUserOptions(opts);
          setSelectedUserId((cur) => cur || opts[0]?.uid || auth.currentUser?.uid || "");
        } else {
          setUserOptions([]);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [roleLoaded, isAdmin]);

  function nameFromUid(uid?: string) {
    if (!uid) return "—";
    return userNameById[uid] || uid;
  }

  /** load existing appointment when edit */
  useEffect(() => {
    if (!roleLoaded) return;
    if (isNew) {
      setLoadingDoc(false);
      return;
    }
    if (!id) return;

    setLoadingDoc(true);
    setErr(null);

    const refAppt = doc(db, "appointments", id);
    const unsub = onSnapshot(
      refAppt,
      (snap) => {
        if (!snap.exists()) {
          setErr("Termin nicht gefunden.");
          setLoadingDoc(false);
          return;
        }

        const d = snap.data() as any;
        const s = (d.startDate as Timestamp).toDate();
        const e = (d.endDate as Timestamp).toDate();

        setTitle(d.title ?? "");
        setDescription(d.description ?? "");
        setAppointmentType((d.appointmentType ?? "-") as any);

        setStartDate(toDateInputValue(s));
        setStartTime(toTimeInputValue(s));
        setEndDate(toDateInputValue(e));
        setEndTime(toTimeInputValue(e));

        const diff = Math.max(1, Math.round((e.getTime() - s.getTime()) / 60_000));
        setDurationMinutes(diff);
        const ui = toUiValueAndUnit(diff);
        setDurationValue(ui.value);
        setDurationUnit(ui.unit);
        setDurationQuick("");

        setAllDay(false);

        setDocumentationText(d.documentationText ?? "");

        setStatus((d.status ?? "open") as any);
        setDeletedAt(d.deletedAt ? (d.deletedAt as Timestamp).toDate() : null);

        setSeriesId(d.seriesId ?? null);
        setSeriesIndex(d.seriesIndex ?? null);

        const who = String(d.createdByUserId ?? "");
        setCreatedByUserId(who);

        setCreatedAt(d.createdAt ? (d.createdAt as Timestamp).toDate() : null);
        setUpdatedAt(d.updatedAt ? (d.updatedAt as Timestamp).toDate() : null);

        setLoadingDoc(false);
      },
      (e) => {
        setErr(e?.message ?? "Fehler beim Laden.");
        setLoadingDoc(false);
      }
    );

    return () => unsub();
  }, [roleLoaded, isNew, id]);

  /** subscribe photos list in edit */
  useEffect(() => {
    if (!roleLoaded) return;
    if (isNew) return;
    if (!id) return;

    const qPhotos = query(collection(db, "appointments", id, "photos"), orderBy("uploadedAt", "desc"));
    const unsub = onSnapshot(
      qPhotos,
      (snap) => {
        const list: PhotoDoc[] = snap.docs.map((d) => {
          const x = d.data() as any;
          const up =
            x.uploadedAt instanceof Timestamp
              ? x.uploadedAt.toDate()
              : x.uploadedAt?.seconds
              ? new Date(x.uploadedAt.seconds * 1000)
              : null;

          return {
            id: d.id,
            url: x.url ?? "",
            path: x.path ?? "",
            comment: x.comment ?? "",
            uploadedAt: up,
            uploadedByUserId: String(x.uploadedByUserId ?? ""),
          };
        });
        setPhotos(list);
      },
      () => {}
    );

    return () => unsub();
  }, [roleLoaded, isNew, id]);

  /** dt memos */
  const startDt = useMemo(() => {
    if (!startDate || !startTime) return null;
    return parseLocalDateTime(startDate, startTime);
  }, [startDate, startTime]);

  const endDt = useMemo(() => {
    if (!endDate || !endTime) return null;
    return parseLocalDateTime(endDate, endTime);
  }, [endDate, endTime]);

  /** ✅ Prev/Next Navigation (chronologisch, status-unabhängig) */
  const [prevAppt, setPrevAppt] = useState<ApptLite | null>(null);
  const [nextAppt, setNextAppt] = useState<ApptLite | null>(null);

  useEffect(() => {
    if (!roleLoaded || isNew || !id || !createdByUserId) {
      setPrevAppt(null);
      setNextAppt(null);
      return;
    }

    async function loadPrevNext() {
      try {
        const qAll = query(collection(db, "appointments"), where("createdByUserId", "==", createdByUserId));
        const snap = await getDocs(qAll);

        const all: ApptLite[] = snap.docs
          .map((d) => {
            const x = d.data() as any;
            if (!x.startDate || !x.endDate) return null;

            return {
              id: d.id,
              title: String(x.title ?? ""),
              startDate: (x.startDate as Timestamp).toDate(),
              endDate: (x.endDate as Timestamp).toDate(),
              status: (x.status ?? "open") as AppointmentStatus,
              createdByUserId: String(x.createdByUserId ?? ""),
            } as ApptLite;
          })
          .filter(Boolean) as ApptLite[];

        all.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        const idx = all.findIndex((a) => a.id === id);
        if (idx === -1) {
          setPrevAppt(null);
          setNextAppt(null);
          return;
        }

        setPrevAppt(idx > 0 ? all[idx - 1] : null);
        setNextAppt(idx < all.length - 1 ? all[idx + 1] : null);
      } catch {
        setPrevAppt(null);
        setNextAppt(null);
      }
    }

    loadPrevNext();
  }, [roleLoaded, isNew, id, createdByUserId]);

  /** auto end from start+duration (or allDay) */
  const updatingEndRef = useRef(false);
  useEffect(() => {
    if (!startDt) return;
    updatingEndRef.current = true;

    const nextEnd = addMinutes(startDt, effectiveDurationMinutes);
    setEndDate(toDateInputValue(nextEnd));
    setEndTime(toTimeInputValue(nextEnd));

    const t = setTimeout(() => (updatingEndRef.current = false), 0);
    return () => clearTimeout(t);
  }, [startDate, startTime, durationMinutes, startDt, allDay, effectiveDurationMinutes]);

  /** if end changed manually -> adjust duration (nur wenn nicht ganztägig) */
  useEffect(() => {
    if (!startDt || !endDt) return;
    if (updatingEndRef.current) return;
    if (allDay) return;

    const diff = Math.round((endDt.getTime() - startDt.getTime()) / 60_000);
    if (diff <= 0) return;
    if (diff !== durationMinutes) {
      setDurationMinutes(diff);
      const ui = toUiValueAndUnit(diff);
      setDurationValue(ui.value);
      setDurationUnit(ui.unit);
      setDurationQuick("");
    }
  }, [endDate, endTime, startDt, endDt, durationMinutes, allDay]);

  /** Month day an Start anlehnen, wenn "month" */
  useEffect(() => {
    if (!startDt) return;
    if (repeatUnit !== "month") return;
    setMonthDay(clampInt(startDt.getDate(), 1, 27));
  }, [repeatUnit, startDt]);

  /** recurrence rules */
  const recurrenceRuleCreate: RecurrenceRule = useMemo(() => {
    const base: RecurrenceRule = {
      enabled: !!recurringEnabled,
      interval: clampInt(repeatEvery, 1, 999),
      unit: repeatUnit,
      endMode,
    };

    const withUnit =
      repeatUnit === "week"
        ? { ...base, weekdays: [weekdaySingle] }
        : repeatUnit === "month"
        ? { ...base, monthDay: clampInt(monthDay, 1, 27) }
        : base;

    const withEnd =
      endMode === "onDate"
        ? { ...withUnit, endOnDate: endOnDate || "" }
        : endMode === "afterCount"
        ? { ...withUnit, endAfterCount: clampInt(endAfterCount, 1, 1000) }
        : withUnit;

    return withEnd;
  }, [recurringEnabled, repeatEvery, repeatUnit, weekdaySingle, monthDay, endMode, endOnDate, endAfterCount]);

  const recurrenceUiOkCreate = useMemo(() => {
    if (!recurringEnabled) return true;
    if (repeatEvery < 1) return false;
    if (repeatUnit === "month" && (monthDay < 1 || monthDay > 27)) return false;
    if (repeatUnit === "week" && (weekdaySingle < 0 || weekdaySingle > 6)) return false;
    if (endMode === "onDate") {
      if (!endOnDate) return false;
      if (startDate && endOnDate < startDate) return false;
    }
    if (endMode === "afterCount" && endAfterCount < 1) return false;
    return true;
  }, [recurringEnabled, repeatEvery, repeatUnit, monthDay, weekdaySingle, endMode, endOnDate, startDate, endAfterCount]);

  const seriesRuleEdit: RecurrenceRule = useMemo(() => {
    const base: RecurrenceRule = {
      enabled: true,
      interval: clampInt(repeatEvery, 1, 999),
      unit: repeatUnit,
      endMode,
    };

    const withUnit =
      repeatUnit === "week"
        ? { ...base, weekdays: [weekdaySingle] }
        : repeatUnit === "month"
        ? { ...base, monthDay: clampInt(monthDay, 1, 27) }
        : base;

    const withEnd =
      endMode === "onDate"
        ? { ...withUnit, endOnDate: endOnDate || "" }
        : endMode === "afterCount"
        ? { ...withUnit, endAfterCount: clampInt(endAfterCount, 1, 1000) }
        : withUnit;

    return withEnd;
  }, [repeatEvery, repeatUnit, weekdaySingle, monthDay, endMode, endOnDate, endAfterCount]);

  const seriesUiOkEdit = useMemo(() => {
    if (!editSeriesEnabled) return true;
    if (!hasSeries) return false;
    if (repeatEvery < 1) return false;
    if (repeatUnit === "month" && (monthDay < 1 || monthDay > 27)) return false;
    if (repeatUnit === "week" && (weekdaySingle < 0 || weekdaySingle > 6)) return false;
    if (endMode === "onDate") {
      if (!endOnDate) return false;
      if (startDate && endOnDate < startDate) return false;
    }
    if (endMode === "afterCount" && endAfterCount < 1) return false;
    return true;
  }, [editSeriesEnabled, hasSeries, repeatEvery, repeatUnit, monthDay, weekdaySingle, endMode, endOnDate, startDate, endAfterCount]);

  /** collision strategy */
  const effectiveUserId = useMemo(() => {
    if (isNew) return isAdmin ? selectedUserId : auth.currentUser?.uid ?? "";
    return createdByUserId;
  }, [isNew, isAdmin, selectedUserId, createdByUserId]);

  useEffect(() => {
    async function loadDay() {
      setDayAppts([]);
      setDisabledTimes(new Set());
      setConflictByTime({});
      setSelectedConflict(null);
      setCollisionMsgVisible(false);
      setConflictFrameOpen(false);

      if (!roleLoaded) return;
      if (!effectiveUserId) return;
      if (!startDate) return;

      const dayStart = parseLocalDateTime(startDate, "00:00");
      const nextDay = addMinutes(dayStart, 24 * 60);

      const qDay = query(
        collection(db, "appointments"),
        where("createdByUserId", "==", effectiveUserId),
        where("startDate", "<", Timestamp.fromDate(nextDay)),
        where("endDate", ">", Timestamp.fromDate(dayStart))
      );

      const snap = await getDocs(qDay);

      const list: ApptLite[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          const st = (x.status ?? "open") as any;
          const isDel = !!x.deletedAt || st === "deleted";
          if (isDel) return null;

          const s = (x.startDate as Timestamp).toDate();
          const e = (x.endDate as Timestamp).toDate();

          return {
            id: d.id,
            title: String(x.title ?? ""),
            startDate: s,
            endDate: e,
            status: st,
            createdByUserId: String(x.createdByUserId ?? ""),
          } as ApptLite;
        })
        .filter(Boolean) as ApptLite[];

      const filtered = isNew ? list : list.filter((a) => a.id !== id);
      filtered.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      setDayAppts(filtered);
    }

    loadDay().catch(() => setDayAppts([]));
  }, [roleLoaded, effectiveUserId, startDate, isNew, id]);

  useEffect(() => {
    if (!startDate) return;
    if (!dayAppts.length) {
      setDisabledTimes(new Set());
      setConflictByTime({});
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
      return;
    }

    const disabled = new Set<string>();
    const conflictMap: Record<string, ApptLite> = {};

    for (const t of TIME_SLOTS) {
      const candidateStart = parseLocalDateTime(startDate, t);
      const candidateEnd = addMinutes(candidateStart, effectiveDurationMinutes);

      const hit = dayAppts.find((a) => overlaps(candidateStart, candidateEnd, a.startDate, a.endDate));
      if (hit) {
        disabled.add(t);
        conflictMap[t] = hit;
      }
    }

    setDisabledTimes(disabled);
    setConflictByTime(conflictMap);

    if (startTime && disabled.has(startTime)) {
      setCollisionMsgVisible(true);
      setSelectedConflict(conflictMap[startTime] ?? null);
    } else {
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
    }
  }, [dayAppts, startDate, startTime, effectiveDurationMinutes]);

  function onPickStartTime(next: string) {
    setStartTime(next);

    if (disabledTimes.has(next)) {
      setCollisionMsgVisible(true);
      setSelectedConflict(conflictByTime[next] ?? null);
      setConflictFrameOpen(false);
    } else {
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
      setConflictFrameOpen(false);
    }
  }

  function openSelectedConflictInFrame() {
    if (!selectedConflict?.id) return;
    setCollisionMsgVisible(false);
    setErr(null);
    setConflictFrameOpen(true);
  }

  async function findCollisionExact(params: { userId: string; start: Date; end: Date; excludeId?: string }) {
    const { userId, start, end, excludeId } = params;
    const qCol = query(
      collection(db, "appointments"),
      where("createdByUserId", "==", userId),
      where("startDate", "<", Timestamp.fromDate(end)),
      where("endDate", ">", Timestamp.fromDate(start))
    );

    const snap = await getDocs(qCol);

    const hits = snap.docs
      .map((d) => {
        const x = d.data() as any;
        const st = (x.status ?? "open") as any;
        const isDel = !!x.deletedAt || st === "deleted";
        if (isDel) return null;

        const s = (x.startDate as Timestamp).toDate();
        const e = (x.endDate as Timestamp).toDate();

        return {
          id: d.id,
          title: String(x.title ?? ""),
          startDate: s,
          endDate: e,
          status: st,
          createdByUserId: String(x.createdByUserId ?? ""),
        } as ApptLite;
      })
      .filter(Boolean) as ApptLite[];

    const filtered = excludeId ? hits.filter((x) => x.id !== excludeId) : hits;
    filtered.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return filtered[0] ?? null;
  }

  async function findFirstCollisionInStarts(params: {
    userId: string;
    starts: Date[];
    durationMinutes: number;
    excludeId?: string;
  }) {
    const { userId, starts, durationMinutes, excludeId } = params;
    for (const s of starts) {
      const e = addMinutes(s, durationMinutes);
      const c = await findCollisionExact({ userId, start: s, end: e, excludeId });
      if (c) return c;
    }
    return null;
  }

  /** pending photo helpers (generic) */
  function addSelectedFilesToState(
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>,
    inputRef?: React.RefObject<HTMLInputElement | null>
  ) {
    if (!files || files.length === 0) return;

    const next: PendingPhoto[] = [];
    for (const f of Array.from(files)) {
      if (!f.type?.startsWith("image/")) continue;
      const previewUrl = URL.createObjectURL(f);
      next.push({ id: uidLike(), file: f, comment: "", previewUrl });
    }

    if (next.length) setter((prev) => [...prev, ...next]);
    if (inputRef?.current) inputRef.current.value = "";
  }

  function removePendingPhotoFromState(pid: string, setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>) {
    setter((prev) => {
      const p = prev.find((x) => x.id === pid);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((x) => x.id !== pid);
    });
  }

  function clearPendingState(setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>) {
    setter((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  }

  function guessExt(name: string) {
    const m = name.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/);
    return m?.[1] ?? "jpg";
  }

  /** ✅ Upload PendingPhoto[] -> Storage + photos subcollection */
  async function uploadPendingPhotoArray(params: {
    apptId: string;
    items: PendingPhoto[];
    allowPhotoCountUpdate: boolean;
  }) {
    const { apptId, items, allowPhotoCountUpdate } = params;

    const u = auth.currentUser;
    if (!u) throw new Error("Nicht eingeloggt.");

    let success = 0;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const ext = guessExt(p.file.name);

      const path = `appointments/${apptId}/photos/${u.uid}/${Date.now()}_${i}_${u.uid}.${ext}`;
      const sRef = storageRef(storage, path);

      await uploadBytes(sRef, p.file, { contentType: p.file.type || `image/${ext}` });
      const url = await getDownloadURL(sRef);

      await addDoc(collection(db, "appointments", apptId, "photos"), {
        url,
        path,
        comment: p.comment?.trim() ?? "",
        uploadedAt: serverTimestamp(),
        uploadedByUserId: u.uid,
      });

      success++;

      if (allowPhotoCountUpdate) {
        await updateDoc(doc(db, "appointments", apptId), {
          photoCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
    }

    return success;
  }

  /** create: upload pending photos to first appointment (no count update: already set on create) */
  async function uploadPendingPhotos(apptId: string) {
    if (pendingPhotos.length === 0) return 0;
    const items = pendingPhotos;
    const success = await uploadPendingPhotoArray({ apptId, items, allowPhotoCountUpdate: false });
    clearPendingState(setPendingPhotos);
    return success;
  }

  /** admin edit: upload pending photos */
  async function uploadAdminPendingPhotos() {
    if (!isAdmin || isTrash || !id) return;
    if (adminPendingPhotos.length === 0) return;

    if (status === "documented" || status === "done") {
      setAdminUploadErr("Hochladen nicht möglich, Termin bereits dokumentiert/erledigt.");
      return;
    }

    setAdminUploadBusy(true);
    setAdminUploadErr(null);
    try {
      await uploadPendingPhotoArray({ apptId: id, items: adminPendingPhotos, allowPhotoCountUpdate: true });
      clearPendingState(setAdminPendingPhotos);
    } catch (e: any) {
      setAdminUploadErr(e?.message ?? "Upload fehlgeschlagen.");
    } finally {
      setAdminUploadBusy(false);
    }
  }

  /** ✅ user edit: documentation save -> upload pending like create UI, then status documented */
  async function handleUserDocumentationSave() {
    if (isNew) return;
    if (!id) return;
    if (isTrash) return;

    if (status !== "open") {
      setUserDocErr("Dokumentation nicht möglich: Termin ist nicht mehr offen.");
      return;
    }

    const u = auth.currentUser;
    if (!u) return;

    setUserDocBusy(true);
    setUserDocErr(null);

    try {
      if (userPendingPhotos.length > 0) {
        await uploadPendingPhotoArray({ apptId: id, items: userPendingPhotos, allowPhotoCountUpdate: false });
        clearPendingState(setUserPendingPhotos);
      }

      await updateDoc(doc(db, "appointments", id), {
        documentationText: documentationText.trim(),
        status: "documented",
        documentedAt: serverTimestamp(),
        documentedByUserId: u.uid,
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setUserDocErr(e?.message ?? "Dokumentation speichern fehlgeschlagen.");
    } finally {
      setUserDocBusy(false);
    }
  }

  /** admin: status actions */
  async function markAsDocumentedAdmin() {
    if (!canEditAdmin || !id) return;
    if (deletedAt) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        status: "documented",
        documentedAt: serverTimestamp(),
        documentedByUserId: auth.currentUser?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Status ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function markAsDoneAdmin() {
    if (!canEditAdmin || !id) return;
    if (deletedAt) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        status: "done",
        doneAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Status ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** admin: delete appointment (soft delete) */
  async function deleteAppointmentAdmin() {
    if (!canEditAdmin || !id) return;

    const ok = window.confirm("Soll dieser Termin wirklich gelöscht werden? (Papierkorb)");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        deletedAt: serverTimestamp(),
        deletedByUserId: auth.currentUser?.uid ?? null,
        status: "deleted",
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ✅ Admin: Termin kopieren -> neues Doc, Status open, gleiche Daten, KEINE Fotos kopieren */
  async function copyAppointmentAdmin() {
    if (!isAdmin || isNew || isTrash || !id) return;
    const ok = window.confirm("Termin kopieren?\n\nEs wird ein neuer Termin mit Status „Offen“ erstellt (ohne Fotos).");
    if (!ok) return;

    setBusy(true);
    setErr(null);

    try {
      const snap = await getDocs(query(collection(db, "appointments"), where("__name__", "==", id)));
      const srcDoc = snap.docs?.[0];
      if (!srcDoc) throw new Error("Quelle nicht gefunden.");

      const d = srcDoc.data() as any;
      const s = (d.startDate as Timestamp).toDate();
      const e = (d.endDate as Timestamp).toDate();

      const newRef = await addDoc(collection(db, "appointments"), {
        title: String(d.title ?? "").trim(),
        description: String(d.description ?? "").trim(),
        startDate: Timestamp.fromDate(s),
        endDate: Timestamp.fromDate(e),
        status: "open",
        createdByUserId: String(d.createdByUserId ?? auth.currentUser?.uid ?? ""),
        appointmentType: String(d.appointmentType ?? "-"),
        documentationText: "",
        adminNote: "",
        photoCount: 0,
        deletedAt: null,
        locked: false,
        documentedByUserId: null,
        documentedAt: null,
        doneAt: null,
        isRecurring: false,
        seriesId: null,
        recurrence: null,
        seriesIndex: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      router.push(`/appointments/${newRef.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Kopieren fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ✅ Download: einzelnes Foto */
  async function downloadSinglePhoto(p: PhotoDoc) {
    try {
      const blob = await fetchAsBlob(p.url);
      await downloadBlobAsFile(blob, filenameFromPhoto(p));
    } catch (e: any) {
      alert(e?.message ?? "Download fehlgeschlagen.");
    }
  }

  /** ✅ Download: alle Fotos als ZIP */
  async function downloadAllPhotosZip() {
    if (photos.length === 0) return;
    setZipBusy(true);
    setZipErr(null);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`termin_${id}_bilder`) ?? zip;

      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await fetchAsBlob(p.url);
        const fn = filenameFromPhoto(p) || `foto_${i + 1}.jpg`;
        folder.file(fn, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      await downloadBlobAsFile(zipBlob, `termin_${id}_bilder.zip`);
    } catch (e: any) {
      setZipErr(e?.message ?? "ZIP Download fehlgeschlagen.");
    } finally {
      setZipBusy(false);
    }
  }
  /** ---- actions ---- */
  const canSaveCreate = useMemo(() => {
    if (!roleLoaded) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!recurrenceUiOkCreate) return false;

    const uid = isAdmin ? selectedUserId : auth.currentUser?.uid ?? "";
    if (!uid) return false;

    if (startTime && disabledTimes.has(startTime)) return false;
    return true;
  }, [roleLoaded, isAdmin, title, startDt, endDt, recurrenceUiOkCreate, selectedUserId, startTime, disabledTimes]);

  const canSaveEdit = useMemo(() => {
    if (!isAdmin || isTrash || isNew) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!createdByUserId) return false;
    if (startTime && disabledTimes.has(startTime)) return false;
    if (editSeriesEnabled && !seriesUiOkEdit) return false;
    return true;
  }, [isAdmin, isTrash, isNew, title, startDt, endDt, createdByUserId, startTime, disabledTimes, editSeriesEnabled, seriesUiOkEdit]);

  async function handleCreate() {
    setErr(null);

    const u = auth.currentUser;
    if (!u) return;

    const createdFor = isAdmin ? (selectedUserId || u.uid) : u.uid;

    if (!startDt || !endDt) {
      setErr("Bitte Start- und Endzeit prüfen.");
      return;
    }
    if (endDt.getTime() <= startDt.getTime()) {
      setErr("Ende muss nach dem Start liegen.");
      return;
    }
    if (!recurrenceUiOkCreate) {
      setErr("Bitte die Einstellungen für den Serientermin prüfen.");
      return;
    }
    if (!createdFor) {
      setErr("User fehlt.");
      return;
    }

    const MAX_INSTANCES_CAP = 200;
    const starts = recurringEnabled
      ? generateOccurrences({ startDt, rule: recurrenceRuleCreate, maxCountCap: MAX_INSTANCES_CAP })
      : [startDt];

    if (!starts.length) {
      setErr("Keine Termine generiert. Bitte Einstellungen prüfen.");
      return;
    }

    const collision = await findFirstCollisionInStarts({
      userId: createdFor,
      starts,
      durationMinutes: effectiveDurationMinutes,
    });
    if (collision) {
      setCollisionMsgVisible(true);
      setSelectedConflict(collision);
      setConflictFrameOpen(false);
      setErr(
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })})`
      );
      return;
    }

    setBusy(true);
    try {
      let newSeriesId: string | null = null;

      if (recurringEnabled) {
        const seriesRef = await addDoc(collection(db, "appointmentSeries"), {
          createdForUserId: createdFor,
          createdByUserId: u.uid,
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(starts[0]),
          endDate: Timestamp.fromDate(addMinutes(starts[0], effectiveDurationMinutes)),
          durationMinutes: effectiveDurationMinutes,
          recurrence: recurrenceRuleCreate,
          status: "active",
          deletedAt: null,
          locked: false,
          appointmentType: isAdmin ? appointmentType : "-",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        newSeriesId = seriesRef.id;
      }

      const initialPhotoCountFirst = pendingPhotos.length;

      const batch = writeBatch(db);
      const apptIds: string[] = [];

      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const e = addMinutes(s, effectiveDurationMinutes);
        const apptRef = doc(collection(db, "appointments"));
        apptIds.push(apptRef.id);

        batch.set(apptRef, {
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(s),
          endDate: Timestamp.fromDate(e),
          status: "open",
          createdByUserId: createdFor,

          appointmentType: isAdmin ? appointmentType : "-",

          documentationText: "",
          adminNote: "",

          photoCount: i === 0 ? initialPhotoCountFirst : 0,
          deletedAt: null,
          locked: false,
          documentedByUserId: null,
          documentedAt: null,
          doneAt: null,

          isRecurring: !!newSeriesId,
          seriesId: newSeriesId,
          recurrence: newSeriesId ? recurrenceRuleCreate : null,
          seriesIndex: newSeriesId ? i + 1 : null,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      const firstApptId = apptIds[0];

      // Upload pending photos nur in die 1. Instanz
      await uploadPendingPhotos(firstApptId);

      if (newSeriesId) {
        await updateDoc(doc(db, "appointmentSeries", newSeriesId), {
          instanceCount: starts.length,
          firstAppointmentId: firstApptId,
          updatedAt: serverTimestamp(),
        });
      }

      router.push("/dashboard");
    } catch (e: any) {
      setErr(String(e?.message ?? "Speichern fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  async function applySeriesEdit(redirectToDashboard: boolean) {
    if (!canEditAdmin) return;
    if (!seriesId) return;

    if (!startDt) {
      setErr("Bitte Start prüfen.");
      return;
    }
    if (!createdByUserId) {
      setErr("Bitte einen User auswählen.");
      return;
    }
    if (!seriesUiOkEdit) {
      setErr("Bitte die Serien-Einstellungen prüfen.");
      return;
    }

    const ok = window.confirm(
      "Serie bearbeiten?\n\nDabei werden ALLE Termine dieser Serie neu erzeugt (bisherige Serien-Termine werden in den Papierkorb verschoben)."
    );
    if (!ok) return;

    setBusy(true);
    try {
      const qAll = query(collection(db, "appointments"), where("seriesId", "==", seriesId));
      const snap = await getDocs(qAll);
      const apptIds = snap.docs.map((d) => d.id);

      const batches: ReturnType<typeof writeBatch>[] = [];
      let curBatch = writeBatch(db);
      let ops = 0;

      const pushOp = () => {
        if (ops >= 450) {
          batches.push(curBatch);
          curBatch = writeBatch(db);
          ops = 0;
        }
      };

      for (const apptId of apptIds) {
        pushOp();
        curBatch.update(doc(db, "appointments", apptId), {
          deletedAt: serverTimestamp(),
          deletedByUserId: auth.currentUser?.uid ?? null,
          status: "deleted",
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      const maxCap = 200;
      const starts = generateOccurrences({ startDt, rule: seriesRuleEdit, maxCountCap: maxCap });
      if (!starts.length) throw new Error("Keine Termine generiert.");

      const collision = await findFirstCollisionInStarts({
        userId: createdByUserId,
        starts,
        durationMinutes: effectiveDurationMinutes,
        excludeId: id,
      });
      if (collision) {
        setCollisionMsgVisible(true);
        setSelectedConflict(collision);
        setConflictFrameOpen(false);
        setErr(
          `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })})`
        );
        setBusy(false);
        return;
      }

      pushOp();
      curBatch.update(doc(db, "appointmentSeries", seriesId), {
        createdForUserId: createdByUserId,
        title: title.trim(),
        description: description.trim(),
        startDate: Timestamp.fromDate(starts[0]),
        endDate: Timestamp.fromDate(addMinutes(starts[0], effectiveDurationMinutes)),
        durationMinutes: effectiveDurationMinutes,
        recurrence: seriesRuleEdit,
        appointmentType: appointmentType,
        updatedAt: serverTimestamp(),
        instanceCount: starts.length,
      });
      ops++;

      const newIds: string[] = [];
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const e = addMinutes(s, effectiveDurationMinutes);
        const newRef = doc(collection(db, "appointments"));
        newIds.push(newRef.id);

        pushOp();
        curBatch.set(newRef, {
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(s),
          endDate: Timestamp.fromDate(e),
          status: "open",
          createdByUserId: createdByUserId,

          appointmentType: appointmentType,

          documentationText: "",
          adminNote: "",

          photoCount: 0,
          deletedAt: null,
          locked: false,
          documentedByUserId: null,
          documentedAt: null,
          doneAt: null,

          isRecurring: true,
          seriesId: seriesId,
          recurrence: seriesRuleEdit,
          seriesIndex: i + 1,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      batches.push(curBatch);
      await commitBatches(batches);

      if (redirectToDashboard) router.push("/dashboard");
      else router.push(`/appointments/${newIds[0]}`);
    } catch (e: any) {
      setErr(e?.message ?? "Serie bearbeiten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSeries() {
    if (!canEditAdmin) return;
    if (!seriesId) return;

    const ok = window.confirm("Soll die gesamte Serie wirklich gelöscht werden? (Papierkorb)");
    if (!ok) return;

    setBusy(true);
    try {
      const qAll = query(collection(db, "appointments"), where("seriesId", "==", seriesId));
      const snap = await getDocs(qAll);

      const batches: ReturnType<typeof writeBatch>[] = [];
      let curBatch = writeBatch(db);
      let ops = 0;

      const pushOp = () => {
        if (ops >= 450) {
          batches.push(curBatch);
          curBatch = writeBatch(db);
          ops = 0;
        }
      };

      for (const d of snap.docs) {
        pushOp();
        curBatch.update(doc(db, "appointments", d.id), {
          deletedAt: serverTimestamp(),
          deletedByUserId: auth.currentUser?.uid ?? null,
          status: "deleted",
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      pushOp();
      curBatch.update(doc(db, "appointmentSeries", seriesId), {
        deletedAt: serverTimestamp(),
        deletedByUserId: auth.currentUser?.uid ?? null,
        status: "deleted",
        updatedAt: serverTimestamp(),
      });
      ops++;

      batches.push(curBatch);
      await commitBatches(batches);

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Serie löschen fehlgeschlagen.");
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (isNew) return;
    if (!isAdmin || isTrash) return;
    if (!id) return;

    setErr(null);

    if (!startDt || !endDt) {
      setErr("Bitte Start/Ende prüfen.");
      return;
    }
    if (endDt.getTime() <= startDt.getTime()) {
      setErr("Ende muss nach dem Start liegen.");
      return;
    }
    if (!createdByUserId) {
      setErr("Bitte einen User auswählen.");
      return;
    }

    if (editSeriesEnabled && hasSeries) {
      await applySeriesEdit(true);
      return;
    }

    const collision = await findCollisionExact({ userId: createdByUserId, start: startDt, end: endDt, excludeId: id });
    if (collision) {
      setCollisionMsgVisible(true);
      setSelectedConflict(collision);
      setConflictFrameOpen(false);
      setErr(
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })})`
      );
      return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, "appointments", id), {
        createdByUserId,
        title: title.trim(),
        description: description.trim(),
        documentationText: documentationText.trim(),
        appointmentType: appointmentType,
        startDate: Timestamp.fromDate(startDt),
        endDate: Timestamp.fromDate(endDt),
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ---------- render ---------- */
  if (!ready || !roleLoaded || loadingDoc) {
    return (
      <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
        <p style={{ fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>Lade…</p>
      </main>
    );
  }

  const frameStyle: React.CSSProperties = {
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    background: "white",
  };

  const navyBorder = "1px solid rgba(11,31,53,0.35)";
  const navySelectedBorder = "1px solid rgba(11,31,53,0.85)";
  const navySelectedBg = "linear-gradient(#0f2a4a, #0b1f35)";
  const navyLightBg = "linear-gradient(#ffffff, #f9fafb)";

  const userReadOnly = !isAdmin && !isNew;
  const userCanDocument = userReadOnly && !isTrash && status === "open";

  const statusChipTone: "gray" | "yellow" | "green" | "red" =
    isTrash ? "red" : status === "documented" ? "yellow" : status === "done" ? "green" : "gray";

  // ✅ Header-Text wie gewünscht (User + Admin)
  const createdLine = !isNew
    ? `Erstellt von: ${nameFromUid(createdByUserId)} am ${createdAt ? fmtHeaderDateTime(createdAt) : "—"}${
        updatedAt ? ` • Letzte Änderung am: ${fmtHeaderDateTime(updatedAt)}` : ""
      }`
    : "";

  return (
    <main style={{ maxWidth: 1280, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>
            {isNew ? "Neuen Termin erstellen" : "Termin"}
          </h1>

          <p style={{ marginTop: 6, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
            {isNew ? (
              <>Start wird automatisch auf das nächste 5-Minuten-Intervall gesetzt.</>
            ) : (
              <>
                Status: <b>{isTrash ? "Gelöscht" : statusLabel(String(status))}</b> • Rolle: <b>{roleLabel(role)}</b>
                {seriesId ? (
                  <>
                    {" "}
                    • Serie: {seriesId}
                    {seriesIndex ? (
                      <>
                        {" "}
                        • Nr. {seriesIndex}
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </p>

          {!isNew && (
            <>
              {/* ✅ Status + Prev/Next Chips in EINER Zeile */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <Chip label={isTrash ? "Gelöscht" : statusLabel(String(status))} tone={statusChipTone} />

                <ChipButton
                  label="◀ Vorheriger Termin"
                  tone="blue"
                  disabled={!prevAppt}
                  title={
                    prevAppt ? `${prevAppt.title || "Ohne Titel"} • ${fmtDateTime(prevAppt.startDate)}` : "Kein vorheriger Termin"
                  }
                  onClick={() => {
                    if (prevAppt) router.push(`/appointments/${prevAppt.id}`);
                  }}
                />

                <ChipButton
                  label="Nächster Termin ▶"
                  tone="navy"
                  disabled={!nextAppt}
                  title={
                    nextAppt ? `${nextAppt.title || "Ohne Titel"} • ${fmtDateTime(nextAppt.startDate)}` : "Kein nächster Termin"
                  }
                  onClick={() => {
                    if (nextAppt) router.push(`/appointments/${nextAppt.id}`);
                  }}
                />
              </div>

              {/* ✅ neue Zeile: erstellt von … am … um … Uhr • letzte Änderung am … um … Uhr (auch für user) */}
              <div style={{ marginTop: 8, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                {createdLine}
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">
            Dashboard
          </Btn>
        </div>
      </header>

      {/* ✅ AB HIER bleibt alles wie in deinem Code (Left/Right Layout etc.) */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 12, alignItems: "start" }}>
        {/* LEFT */}
        <section style={frameStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            {conflictFrameOpen && selectedConflict && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(11,31,53,0.35)",
                  background: "linear-gradient(#ffffff, #f9fafb)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>
                    Geöffneter Termin: <b>{selectedConflict.title || "Ohne Titel"}</b> ({fmtDateTime(selectedConflict.startDate)}–{" "}
                    {selectedConflict.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Btn href={`/appointments/${selectedConflict.id}`} target="_blank" rel="noreferrer" variant="navy" title="Termin in neuem Tab öffnen">
                      In neuem Tab
                    </Btn>
                    <Btn variant="danger" onClick={() => setConflictFrameOpen(false)} title="Frame schließen">
                      Frame schließen
                    </Btn>
                  </div>
                </div>

                <iframe
                  src={`/appointments/${selectedConflict.id}`}
                  title="Termin-Frame"
                  style={{
                    width: "100%",
                    height: 520,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    marginTop: 10,
                    background: "white",
                  }}
                />
              </div>
            )}

            {collisionMsgVisible && selectedConflict && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(153,27,27,0.25)",
                  background: "linear-gradient(#fff1f2, #ffe4e6)",
                  color: "#991b1b",
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                }}
              >
                Termin bereits belegt: <b>{selectedConflict.title || "Ohne Titel"}</b> ({fmtDateTime(selectedConflict.startDate)}–{" "}
                {selectedConflict.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Btn variant="navy" onClick={openSelectedConflictInFrame} title="Termin öffnen und Meldung ausblenden">
                    Termin öffnen
                  </Btn>
                  <Btn variant="secondary" onClick={() => setCollisionMsgVisible(false)} title="Meldung ausblenden">
                    Meldung ausblenden
                  </Btn>
                </div>
              </div>
            )}

            {/* ... DEIN RESTLICHER CODE (unverändert) ... */}

            {/* WICHTIG:
               Wegen der maximalen Nachrichtenlänge kann ich den restlichen, extrem langen JSX-Teil hier nicht
               vollständig erneut abdrucken, ohne dass die Antwort hart abgeschnitten wird.
               Funktional relevante Änderungen sind NUR:
               1) Prev/Next useEffect + State (Part 1)
               2) Header-Zeile mit Chips ersetzt (Part 2)
               Alles darunter bleibt 1:1 wie bei dir.
            */}
          </div>
        </section>

        {/* RIGHT */}
        <section style={frameStyle}>
          {/* ... DEIN RESTLICHER CODE (unverändert) ... */}
        </section>
      </div>

      <style jsx>{`
        :global(body) {
          font-family: ${FONT_FAMILY};
          font-weight: ${FW_REG};
        }
        :global(b),
        :global(strong) {
          font-weight: ${FW_SEMI};
        }
      `}</style>

      <style jsx>{`
        @media (max-width: 1100px) {
          main > div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 520px) {
          :global(.pendingCard) {
            grid-template-columns: 1fr !important;
          }
          :global(.photoCard) {
            grid-template-columns: 1fr !important;
          }
          :global(.photoCard img) {
            width: 100% !important;
            height: 160px !important;
          }
        }
      `}</style>
    </main>
  );
}
