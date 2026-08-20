export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          appointment_date: string
          child_id: string
          clinic_id: string
          created_at: string
          duration_minutes: number
          id: string
          notes: string | null
          parent_action_at: string | null
          parent_action_note: string | null
          parent_confirmation_status: string
          recurrence_group_id: string | null
          room_id: string | null
          session_fee: number | null
          specialty: string | null
          start_time: string
          status: string
          therapist_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_date: string
          child_id: string
          clinic_id: string
          created_at?: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          parent_action_at?: string | null
          parent_action_note?: string | null
          parent_confirmation_status?: string
          recurrence_group_id?: string | null
          room_id?: string | null
          session_fee?: number | null
          specialty?: string | null
          start_time: string
          status?: string
          therapist_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          child_id?: string
          clinic_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          parent_action_at?: string | null
          parent_action_note?: string | null
          parent_confirmation_status?: string
          recurrence_group_id?: string | null
          room_id?: string | null
          session_fee?: number | null
          specialty?: string | null
          start_time?: string
          status?: string
          therapist_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          appointment_id: string | null
          attendance_date: string
          check_in_at: string | null
          child_id: string
          clinic_id: string
          created_at: string
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          attendance_date?: string
          check_in_at?: string | null
          child_id: string
          clinic_id: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          attendance_date?: string
          check_in_at?: string | null
          child_id?: string
          clinic_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "attendance_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      call_queue: {
        Row: {
          appointment_id: string | null
          attempts: number
          call_type: string
          clinic_id: string
          communication_event_id: string | null
          created_at: string
          dialed_at: string | null
          id: string
          last_error: string | null
          recipient_phone: string
          recipient_role: string
          scheduled_for: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          attempts?: number
          call_type?: string
          clinic_id: string
          communication_event_id?: string | null
          created_at?: string
          dialed_at?: string | null
          id?: string
          last_error?: string | null
          recipient_phone: string
          recipient_role?: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          attempts?: number
          call_type?: string
          clinic_id?: string
          communication_event_id?: string | null
          created_at?: string
          dialed_at?: string | null
          id?: string
          last_error?: string | null
          recipient_phone?: string
          recipient_role?: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_queue_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "call_queue_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_queue_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_queue_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["communication_event_id"]
          },
          {
            foreignKeyName: "call_queue_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "communication_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          address: string | null
          clinic_id: string
          created_at: string
          date_of_birth: string | null
          diagnosis: string | null
          full_name: string
          gender: string | null
          id: string
          notes: string | null
          parent_email: string | null
          parent_name: string | null
          parent_phone: string | null
          status: string
          therapy_track: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          clinic_id: string
          created_at?: string
          date_of_birth?: string | null
          diagnosis?: string | null
          full_name: string
          gender?: string | null
          id?: string
          notes?: string | null
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          status?: string
          therapy_track?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          clinic_id?: string
          created_at?: string
          date_of_birth?: string | null
          diagnosis?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          notes?: string | null
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          status?: string
          therapy_track?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "children_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          address: string | null
          call_enabled: boolean
          city: string | null
          communication_working_hours_enabled: boolean
          communication_working_hours_end: string
          communication_working_hours_start: string
          created_at: string
          currency: string
          device_label: string | null
          device_phone: string | null
          device_subscription_id: number | null
          email: string | null
          id: string
          name: string
          owner_id: string
          phone: string | null
          reminder_lead_minutes: number
          sms_enabled: boolean
          sms_to_call_wait_minutes: number
          timezone: string
          updated_at: string
          whatsapp_escalation_enabled: boolean
          whatsapp_mode: string
          whatsapp_to_sms_wait_minutes: number
        }
        Insert: {
          address?: string | null
          call_enabled?: boolean
          city?: string | null
          communication_working_hours_enabled?: boolean
          communication_working_hours_end?: string
          communication_working_hours_start?: string
          created_at?: string
          currency?: string
          device_label?: string | null
          device_phone?: string | null
          device_subscription_id?: number | null
          email?: string | null
          id?: string
          name: string
          owner_id: string
          phone?: string | null
          reminder_lead_minutes?: number
          sms_enabled?: boolean
          sms_to_call_wait_minutes?: number
          timezone?: string
          updated_at?: string
          whatsapp_escalation_enabled?: boolean
          whatsapp_mode?: string
          whatsapp_to_sms_wait_minutes?: number
        }
        Update: {
          address?: string | null
          call_enabled?: boolean
          city?: string | null
          communication_working_hours_enabled?: boolean
          communication_working_hours_end?: string
          communication_working_hours_start?: string
          created_at?: string
          currency?: string
          device_label?: string | null
          device_phone?: string | null
          device_subscription_id?: number | null
          email?: string | null
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          reminder_lead_minutes?: number
          sms_enabled?: boolean
          sms_to_call_wait_minutes?: number
          timezone?: string
          updated_at?: string
          whatsapp_escalation_enabled?: boolean
          whatsapp_mode?: string
          whatsapp_to_sms_wait_minutes?: number
        }
        Relationships: []
      }
      communication_escalations: {
        Row: {
          appointment_id: string
          call_queue_id: string | null
          call_scheduled_for: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          clinic_id: string
          completed_at: string | null
          created_at: string
          current_stage: string
          event_key: string
          id: string
          response_action: string | null
          sms_queue_id: string | null
          sms_response_token: string | null
          sms_scheduled_for: string | null
          started_at: string
          status: string
          updated_at: string
          whatsapp_message_id: string | null
        }
        Insert: {
          appointment_id: string
          call_queue_id?: string | null
          call_scheduled_for?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          clinic_id: string
          completed_at?: string | null
          created_at?: string
          current_stage?: string
          event_key: string
          id?: string
          response_action?: string | null
          sms_queue_id?: string | null
          sms_response_token?: string | null
          sms_scheduled_for?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          appointment_id?: string
          call_queue_id?: string | null
          call_scheduled_for?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          clinic_id?: string
          completed_at?: string | null
          created_at?: string
          current_stage?: string
          event_key?: string
          id?: string
          response_action?: string | null
          sms_queue_id?: string | null
          sms_response_token?: string | null
          sms_scheduled_for?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_escalations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "communication_escalations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_escalations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_sms_responses: {
        Row: {
          appointment_id: string
          clinic_id: string
          communication_event_id: string
          created_at: string
          id: string
          message: string
          received_at: string
          response_hash: string
          sender_phone: string
        }
        Insert: {
          appointment_id: string
          clinic_id: string
          communication_event_id: string
          created_at?: string
          id?: string
          message: string
          received_at?: string
          response_hash: string
          sender_phone: string
        }
        Update: {
          appointment_id?: string
          clinic_id?: string
          communication_event_id?: string
          created_at?: string
          id?: string
          message?: string
          received_at?: string
          response_hash?: string
          sender_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_sms_responses_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "communication_sms_responses_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_sms_responses_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_sms_responses_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["communication_event_id"]
          },
          {
            foreignKeyName: "communication_sms_responses_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "communication_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          clinic_id: string
          created_at: string
          id: string
          is_read: boolean
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          price: number
          specialty: string | null
          total_sessions: number
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          specialty?: string | null
          total_sessions?: number
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          specialty?: string | null
          total_sessions?: number
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          child_id: string | null
          clinic_id: string
          created_at: string
          id: string
          method: string | null
          notes: string | null
          package_id: string | null
          payment_date: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          appointment_id?: string | null
          child_id?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          method?: string | null
          notes?: string | null
          package_id?: string | null
          payment_date?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          child_id?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          method?: string | null
          notes?: string | null
          package_id?: string | null
          payment_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          clinic_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          capacity: number | null
          clinic_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          room_type: string | null
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          clinic_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          room_type?: string | null
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          clinic_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          room_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_queue: {
        Row: {
          appointment_id: string | null
          attempts: number
          clinic_id: string
          communication_event_id: string | null
          created_at: string
          id: string
          last_error: string | null
          message: string
          message_type: string
          recipient_phone: string
          recipient_role: string
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          attempts?: number
          clinic_id: string
          communication_event_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message: string
          message_type?: string
          recipient_phone: string
          recipient_role?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          attempts?: number
          clinic_id?: string
          communication_event_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message?: string
          message_type?: string
          recipient_phone?: string
          recipient_role?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_queue_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "sms_queue_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_queue_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_queue_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["communication_event_id"]
          },
          {
            foreignKeyName: "sms_queue_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "communication_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          clinic_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "specialties_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      therapists: {
        Row: {
          availability: string | null
          clinic_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          qualification: string | null
          specialty: string | null
          updated_at: string
        }
        Insert: {
          availability?: string | null
          clinic_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          qualification?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          availability?: string | null
          clinic_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          qualification?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "therapists_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_automation_batches: {
        Row: {
          clinic_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          status: string
          total_selected: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          total_selected?: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          total_selected?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_automation_batches_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_automation_items: {
        Row: {
          appointment_date: string | null
          appointment_id: string | null
          batch_id: string
          child_name: string | null
          clinic_id: string
          communication_event_id: string | null
          created_at: string
          id: string
          message: string | null
          parent_name: string | null
          phone: string | null
          position: number
          processed_at: string | null
          reason: string | null
          start_time: string | null
          status: string
          updated_at: string
          whatsapp_message_id: string | null
        }
        Insert: {
          appointment_date?: string | null
          appointment_id?: string | null
          batch_id: string
          child_name?: string | null
          clinic_id: string
          communication_event_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          parent_name?: string | null
          phone?: string | null
          position?: number
          processed_at?: string | null
          reason?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          appointment_date?: string | null
          appointment_id?: string | null
          batch_id?: string
          child_name?: string | null
          clinic_id?: string
          communication_event_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          parent_name?: string | null
          phone?: string | null
          position?: number
          processed_at?: string | null
          reason?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_automation_items_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_automation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["communication_event_id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "communication_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_whatsapp_message_id_fkey"
            columns: ["whatsapp_message_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["whatsapp_message_id"]
          },
          {
            foreignKeyName: "whatsapp_automation_items_whatsapp_message_id_fkey"
            columns: ["whatsapp_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          appointment_id: string | null
          child_id: string | null
          clinic_id: string
          communication_event_id: string | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          id: string
          message: string
          message_type: string
          metadata: Json | null
          phone: string
          provider_message_id: string | null
          provider_status: string | null
          read_at: string | null
          recipient_name: string | null
          recipient_role: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          child_id?: string | null
          clinic_id: string
          communication_event_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          message: string
          message_type?: string
          metadata?: Json | null
          phone: string
          provider_message_id?: string | null
          provider_status?: string | null
          read_at?: string | null
          recipient_name?: string | null
          recipient_role?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          child_id?: string | null
          clinic_id?: string
          communication_event_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          message?: string
          message_type?: string
          metadata?: Json | null
          phone?: string
          provider_message_id?: string | null
          provider_status?: string | null
          read_at?: string | null
          recipient_name?: string | null
          recipient_role?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["appointment_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "appointment_whatsapp_status"
            referencedColumns: ["communication_event_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_communication_event_id_fkey"
            columns: ["communication_event_id"]
            isOneToOne: false
            referencedRelation: "communication_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_provider_events: {
        Row: {
          clinic_id: string | null
          event_type: string
          id: string
          payload: Json
          provider_message_id: string | null
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          clinic_id?: string | null
          event_type: string
          id?: string
          payload?: Json
          provider_message_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Update: {
          clinic_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
          provider_message_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_provider_events_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      appointment_whatsapp_status: {
        Row: {
          appointment_id: string | null
          clinic_id: string | null
          communication_event_id: string | null
          error_message: string | null
          event_status: string | null
          parent_name: string | null
          parent_phone: string | null
          sent_at: string | null
          whatsapp_message_id: string | null
          whatsapp_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      advance_communication_after_sms: {
        Args: { p_escalation_id: string; p_sent_at: string }
        Returns: Json
      }
      cancel_communication_escalation: {
        Args: { p_escalation_id: string; p_reason?: string }
        Returns: boolean
      }
      claim_whatsapp_automation_item: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      complete_communication_after_call: {
        Args: { p_dialed_at: string; p_escalation_id: string }
        Returns: boolean
      }
      create_whatsapp_automation_batch: {
        Args: { p_appointment_ids: string[] }
        Returns: string
      }
      get_communication_escalation_state: {
        Args: { p_escalation_id: string }
        Returns: Json
      }
      is_communication_within_working_hours: {
        Args: { p_at?: string; p_clinic_id: string }
        Returns: boolean
      }
      is_valid_phone: { Args: { p_phone: string }; Returns: boolean }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      process_mock_parent_action: {
        Args: { p_action: string; p_appointment_id: string; p_note?: string }
        Returns: Json
      }
      process_parent_sms_response: {
        Args: {
          p_message: string
          p_response_token: string
          p_sender_phone: string
        }
        Returns: Json
      }
      record_whatsapp_automation_result: {
        Args: { p_item_id: string; p_reason?: string; p_status: string }
        Returns: boolean
      }
      release_stale_whatsapp_automation_items: {
        Args: { p_batch_id?: string }
        Returns: number
      }
      set_whatsapp_mode: {
        Args: { p_clinic_id: string; p_mode: string }
        Returns: boolean
      }
      start_appointment_communication_workflow: {
        Args: { p_appointment_id: string; p_event_key: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
