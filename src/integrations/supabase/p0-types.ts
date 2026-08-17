import type { Database as GeneratedDatabase } from "./types";

type Public = GeneratedDatabase["public"];
type BaseTables = Public["Tables"];
type Clinics = BaseTables["clinics"];
type WhatsAppMessages = BaseTables["whatsapp_messages"];
type SmsQueue = BaseTables["sms_queue"];
type CallQueue = BaseTables["call_queue"];

type P0Clinics = Omit<Clinics, "Row" | "Insert" | "Update"> & {
  Row: Clinics["Row"] & {
    whatsapp_escalation_enabled: boolean;
    whatsapp_to_sms_wait_minutes: number;
    sms_to_call_wait_minutes: number;
  };
  Insert: Clinics["Insert"] & {
    whatsapp_escalation_enabled?: boolean;
    whatsapp_to_sms_wait_minutes?: number;
    sms_to_call_wait_minutes?: number;
  };
  Update: Clinics["Update"] & {
    whatsapp_escalation_enabled?: boolean;
    whatsapp_to_sms_wait_minutes?: number;
    sms_to_call_wait_minutes?: number;
  };
};

type P0WhatsAppMessages = Omit<WhatsAppMessages, "Row" | "Insert" | "Update"> & {
  Row: WhatsAppMessages["Row"] & { communication_event_id: string | null };
  Insert: WhatsAppMessages["Insert"] & { communication_event_id?: string | null };
  Update: WhatsAppMessages["Update"] & { communication_event_id?: string | null };
};

type P0SmsQueue = Omit<SmsQueue, "Row" | "Insert" | "Update"> & {
  Row: SmsQueue["Row"] & { communication_event_id: string | null };
  Insert: SmsQueue["Insert"] & { communication_event_id?: string | null };
  Update: SmsQueue["Update"] & { communication_event_id?: string | null };
};

type P0CallQueue = Omit<CallQueue, "Row" | "Insert" | "Update"> & {
  Row: CallQueue["Row"] & { communication_event_id: string | null };
  Insert: CallQueue["Insert"] & { communication_event_id?: string | null };
  Update: CallQueue["Update"] & { communication_event_id?: string | null };
};

type CommunicationEscalation = {
  Row: {
    id: string;
    clinic_id: string;
    appointment_id: string;
    event_key: string;
    status: string;
    current_stage: string;
    response_action: string | null;
    whatsapp_message_id: string | null;
    sms_queue_id: string | null;
    call_queue_id: string | null;
    started_at: string;
    sms_scheduled_for: string | null;
    call_scheduled_for: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    clinic_id: string;
    appointment_id: string;
    event_key: string;
    status?: string;
    current_stage?: string;
    response_action?: string | null;
    whatsapp_message_id?: string | null;
    sms_queue_id?: string | null;
    call_queue_id?: string | null;
    started_at?: string;
    sms_scheduled_for?: string | null;
    call_scheduled_for?: string | null;
    completed_at?: string | null;
    cancelled_at?: string | null;
    cancel_reason?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    clinic_id?: string;
    appointment_id?: string;
    event_key?: string;
    status?: string;
    current_stage?: string;
    response_action?: string | null;
    whatsapp_message_id?: string | null;
    sms_queue_id?: string | null;
    call_queue_id?: string | null;
    started_at?: string;
    sms_scheduled_for?: string | null;
    call_scheduled_for?: string | null;
    completed_at?: string | null;
    cancelled_at?: string | null;
    cancel_reason?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type P0Tables = Omit<BaseTables, "clinics" | "whatsapp_messages" | "sms_queue" | "call_queue"> & {
  clinics: P0Clinics;
  whatsapp_messages: P0WhatsAppMessages;
  sms_queue: P0SmsQueue;
  call_queue: P0CallQueue;
  communication_escalations: CommunicationEscalation;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<Public, "Tables"> & { Tables: P0Tables };
};
