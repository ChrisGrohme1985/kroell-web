// src/lib/types.ts

// --------------------
// Rollen
// --------------------
export type Role = "admin" | "user";

// --------------------
// Appointment Status
// --------------------
// Enthält ALLE Status, die im Projekt tatsächlich verwendet werden
export type AppointmentStatus =
  | "open"        // UI-Status (z. B. beim Bearbeiten)
  | "draft"
  | "planned"
  | "documented"
  | "done"
  | "canceled"
  | "deleted";    // wird im Code explizit geprüft

// --------------------
// User Profile
// --------------------
export type UserProfile = {
  uid: string;
  email?: string;
  role: Role;
  displayName: string;

  firstName: string;
  lastName: string;
};

// --------------------
// Appointment
// --------------------
export type Appointment = {
  id: string;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;

  status: AppointmentStatus;
  createdByUserId: string;

  documentationText: string;
  photoCount: number;

  adminNote?: string;
  deletedAt?: Date | null;
  locked?: boolean;

  documentedByUserId?: string | null;
  documentedAt?: Date | null;
  doneAt?: Date | null;
};

// --------------------
// Photos
// --------------------
export type PhotoDoc = {
  id: string;
  url: string;
  comment: string;
  uploadedByUserId: string;
  uploadedAt?: Date | null;
};
