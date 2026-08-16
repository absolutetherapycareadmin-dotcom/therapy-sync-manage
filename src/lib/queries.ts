import { supabase } from "@/integrations/supabase/client";
import type { CallQueueRow, SmsQueueRow } from "@/lib/deviceComms";

export type Child = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  address: string | null;
  therapy_track: string | null;
  diagnosis: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

export type Therapist = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  qualification: string | null;
  availability: string | null;
  is_active: boolean;
};

export type Room = {
  id: string;
  name: string;
  room_type: string | null;
  capacity: number | null;
  is_active: boolean;
};

export type Specialty = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type Appointment = {
  id: string;
  child_id: string;
  therapist_id: string | null;
  room_id: string | null;
  specialty: string | null;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  session_fee: number | null;
  status: string;
  parent_confirmation_status: string;
  parent_action_at: string | null;
  parent_action_note: string | null;
  notes: string | null;
  recurrence_group_id: string | null;
};

export type Payment = {
  id: string;
  child_id: string | null;
  appointment_id: string | null;
  package_id: string | null;
  amount: number;
  status: string;
  method: string | null;
  payment_date: string;
  notes: string | null;
};

export type PackageRow = {
  id: string;
  name: string;
  specialty: string | null;
  total_sessions: number;
  price: number;
  validity_days: number | null;
  is_active: boolean;
};

export type WhatsappMessage = {
  id: string;
  child_id: string | null;
  appointment_id: string | null;
  recipient_name: string | null;
  phone: string;
  message: string;
  message_type: string;
  recipient_role: string;
  status: string;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  sent_at: string | null;
  created_at: string;
};

export type AttendanceRow = {
  id: string;
  appointment_id: string | null;
  child_id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  notes: string | null;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  is_read: boolean;
  created_at: string;
};

async function list<T>(table: string, clinicId: string, order: string, ascending = true) {
  const { data, error } = await supabase
    .from(table as "children")
    .select("*")
    .eq("clinic_id", clinicId)
    .order(order as "created_at", { ascending });
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

export const childrenQuery = (clinicId: string) => ({
  queryKey: ["children", clinicId],
  queryFn: () => list<Child>("children", clinicId, "created_at", false),
});

export const therapistsQuery = (clinicId: string) => ({
  queryKey: ["therapists", clinicId],
  queryFn: () => list<Therapist>("therapists", clinicId, "full_name"),
});

export const roomsQuery = (clinicId: string) => ({
  queryKey: ["rooms", clinicId],
  queryFn: () => list<Room>("rooms", clinicId, "name"),
});

export const specialtiesQuery = (clinicId: string) => ({
  queryKey: ["specialties", clinicId],
  queryFn: () => list<Specialty>("specialties", clinicId, "name"),
});

export const appointmentsQuery = (clinicId: string) => ({
  queryKey: ["appointments", clinicId],
  queryFn: () => list<Appointment>("appointments", clinicId, "appointment_date", false),
});

export const paymentsQuery = (clinicId: string) => ({
  queryKey: ["payments", clinicId],
  queryFn: () => list<Payment>("payments", clinicId, "payment_date", false),
});

export const packagesQuery = (clinicId: string) => ({
  queryKey: ["packages", clinicId],
  queryFn: () => list<PackageRow>("packages", clinicId, "name"),
});

export const whatsappQuery = (clinicId: string) => ({
  queryKey: ["whatsapp_messages", clinicId],
  queryFn: () => list<WhatsappMessage>("whatsapp_messages", clinicId, "created_at", false),
});

export const attendanceQuery = (clinicId: string) => ({
  queryKey: ["attendance", clinicId],
  queryFn: () => list<AttendanceRow>("attendance", clinicId, "attendance_date", false),
});

export const notificationsQuery = (clinicId: string) => ({
  queryKey: ["notifications", clinicId],
  queryFn: () => list<NotificationRow>("notifications", clinicId, "created_at", false),
});

export const smsQueueQuery = (clinicId: string) => ({
  queryKey: ["sms_queue", clinicId],
  queryFn: () => list<SmsQueueRow>("sms_queue", clinicId, "scheduled_for", false),
});

export const callQueueQuery = (clinicId: string) => ({
  queryKey: ["call_queue", clinicId],
  queryFn: () => list<CallQueueRow>("call_queue", clinicId, "scheduled_for", false),
});
