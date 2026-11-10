export type UserRole = "admin" | "teacher";
export type ScheduleStatus = "pending" | "confirmed" | "cancelled";
export type AttendanceStatus = "present" | "absent" | null;
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Teacher {
  id: string;
  phone: string | null;
  bio: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Student {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Instrument {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface TeacherInstrument {
  teacher_id: string;
  instrument_id: string;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface ScheduleSeries {
  id: string;
  recurrence_type: "weekly";
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  teacher_id: string;
  student_id: string;
  instrument_id: string;
  room_id: string;
  series_id: string | null;
  start_at: string;
  end_at: string;
  status: ScheduleStatus;
  attendance_status?: AttendanceStatus;
  attendance_marked_at?: string | null;
  attendance_note?: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeacherAvailability {
  id: string;
  teacher_id: string;
  day_of_week: number; // 0 (Sunday) to 6 (Saturday)
  start_time: string;  // HH:mm:ss or HH:mm
  end_time: string;    // HH:mm:ss or HH:mm
  is_available: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

export interface ScheduleRequest {
  id: string;
  schedule_id: string;
  requested_by: string;
  proposed_start_at: string;
  proposed_end_at: string;
  reason: string | null;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

// Joined / Relational Types for UI & API responses
export interface TeacherWithDetails extends Teacher {
  profile: Profile;
  instruments: Instrument[];
  availability: TeacherAvailability[];
  upcoming_lessons_count?: number;
}

export interface StudentWithDetails extends Student {
  enrolled_instruments?: Instrument[];
  assigned_teachers?: { id: string; full_name: string }[];
  upcoming_lessons_count?: number;
  total_lessons_count?: number;
}

export interface ScheduleWithDetails extends Schedule {
  teacher: {
    id: string;
    phone: string | null;
    is_active: boolean;
    profile: Pick<Profile, "id" | "full_name" | "email" | "avatar_url">;
  } | null;
  student: Pick<Student, "id" | "full_name" | "phone" | "email"> | null;
  instrument: Pick<Instrument, "id" | "name" | "description"> | null;
  room: Pick<Room, "id" | "name" | "description"> | null;
  series?: ScheduleSeries | null;
}

export interface ScheduleRequestWithDetails extends ScheduleRequest {
  schedule: ScheduleWithDetails | null;
  requester: Pick<Profile, "id" | "full_name" | "email" | "role"> | null;
  reviewer: Pick<Profile, "id" | "full_name" | "email"> | null;
}

export interface AuditLogWithUser extends AuditLog {
  user?: Pick<Profile, "id" | "full_name" | "email" | "role"> | null;
}

