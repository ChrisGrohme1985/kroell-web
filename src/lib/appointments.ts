// src/lib/appointments.ts
import { db, storage } from "./firebase";
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import type { AppointmentStatus } from "./types";

// -----------------------------
// APPOINTMENTS
// -----------------------------

export async function createAppointment(params: {
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  createdByUserId: string;
}) {
  const res = await addDoc(collection(db, "appointments"), {
    title: params.title,
    description: params.description,
    startDate: Timestamp.fromDate(params.startDate),
    endDate: Timestamp.fromDate(params.endDate),
    status: "open" as AppointmentStatus,
    createdByUserId: params.createdByUserId,

    documentationText: "",
    photoCount: 0,
    adminNote: "",
    deletedAt: null,
    deletedByUserId: null,

    locked: false,
    documentedByUserId: null,
    documentedAt: null,
    doneAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: res.id,
    type: "created",
    message: "Termin erstellt",
    byUserId: params.createdByUserId,
  });

  return res.id;
}

export async function adminUpdateAppointment(params: {
  apptId: string;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  status: AppointmentStatus;
}) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, {
    title: params.title,
    description: params.description,
    startDate: Timestamp.fromDate(params.startDate),
    endDate: Timestamp.fromDate(params.endDate),
    status: params.status,
    updatedAt: serverTimestamp(),
  });
}

export async function finishDocumentation(params: {
  apptId: string;
  documentationText: string;
  userId: string;
}) {
  const apptRef = doc(db, "appointments", params.apptId);
  await updateDoc(apptRef, {
    documentationText: params.documentationText ?? "",
    documentedByUserId: params.userId,
    documentedAt: serverTimestamp(),
    status: "documented",
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: params.apptId,
    type: "documentation_finished",
    message: "Dokumentation abgeschlossen",
    byUserId: params.userId,
  });
}

export async function adminNeedsClarification(params: { apptId: string; adminId: string }) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, {
    status: "needs_clarification",
    locked: false,
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: params.apptId,
    type: "needs_clarification",
    message: "Rückfrage an User",
    byUserId: params.adminId,
  });
}

export async function adminUnlock(params: { apptId: string; adminId: string }) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, { locked: false, updatedAt: serverTimestamp() });

  await addActivity({
    apptId: params.apptId,
    type: "unlock",
    message: "Termin entsperrt",
    byUserId: params.adminId,
  });
}

export async function adminSetDoneWithBy(params: { apptId: string; adminId: string }) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, {
    status: "done",
    doneAt: serverTimestamp(),
    locked: true,
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: params.apptId,
    type: "done",
    message: "Als erledigt markiert",
    byUserId: params.adminId,
  });
}

/**
 * ✅ EINZIGE LÖSCH-FUNKTION (Admin): Soft Delete
 * -> Termin verschwindet aus UI (weil deletedAt != null)
 * -> keine Hard-Deletes mehr => weniger "permission-denied" Watch-Fehler
 */
export async function adminSoftDelete(params: { apptId: string; adminId: string }) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, {
    deletedAt: serverTimestamp(),
    deletedByUserId: params.adminId,
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: params.apptId,
    type: "soft_delete",
    message: "Termin gelöscht (Soft)",
    byUserId: params.adminId,
  });
}

export async function adminUpdateAdminNote(params: { apptId: string; note: string }) {
  const r = doc(db, "appointments", params.apptId);
  await updateDoc(r, { adminNote: params.note ?? "", updatedAt: serverTimestamp() });
}

// -----------------------------
// PHOTOS
// -----------------------------

export async function uploadDocumentationPhoto(apptId: string, file: File) {
  const path = `appointments/${apptId}/documentation/${crypto.randomUUID()}_${file.name}`;
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

export async function addPhotoDoc(params: {
  apptId: string;
  url: string;
  comment: string;
  userId: string;
}) {
  const photoId = crypto.randomUUID();
  const photoRef = doc(collection(db, "appointments", params.apptId, "photos"), photoId);

  await setDoc(photoRef, {
    url: params.url,
    comment: params.comment ?? "",
    uploadedByUserId: params.userId,
    uploadedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "appointments", params.apptId), {
    photoCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  await addActivity({
    apptId: params.apptId,
    type: "photo_added",
    message: "Foto hinzugefügt",
    byUserId: params.userId,
  });
}

export async function adminUpdatePhotoComment(params: {
  apptId: string;
  photoId: string;
  comment: string;
}) {
  const r = doc(db, "appointments", params.apptId, "photos", params.photoId);
  await updateDoc(r, {
    comment: params.comment ?? "",
    updatedAt: serverTimestamp(),
  });
}

// -----------------------------
// ACTIVITY
// -----------------------------

export async function addActivity(params: {
  apptId: string;
  type: string;
  message: string;
  byUserId: string;
}) {
  const id = crypto.randomUUID();
  await setDoc(doc(collection(db, "appointments", params.apptId, "activity"), id), {
    type: params.type,
    message: params.message,
    byUserId: params.byUserId,
    createdAt: serverTimestamp(),
  });
}
