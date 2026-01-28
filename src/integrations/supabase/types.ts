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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          created_at: string
          created_from_call: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          description: string | null
          end_time: string
          id: string
          start_time: string
          status: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_from_call?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          description?: string | null
          end_time: string
          id?: string
          start_time: string
          status?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_from_call?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          description?: string | null
          end_time?: string
          id?: string
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean | null
          start_time: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_available?: boolean | null
          start_time: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean | null
          start_time?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          user_id: string
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          user_id: string
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          user_id?: string
        }
        Relationships: []
      }
      call_metrics: {
        Row: {
          avg_turn_duration_ms: number | null
          barge_in_count: number | null
          call_sid: string
          created_at: string | null
          end_to_audio_ms: number | null
          faq_hit_count: number | null
          id: string
          languages_detected: string[] | null
          stt_failures: number | null
          total_turns: number | null
          ttfs_ms: number | null
          user_id: string
        }
        Insert: {
          avg_turn_duration_ms?: number | null
          barge_in_count?: number | null
          call_sid: string
          created_at?: string | null
          end_to_audio_ms?: number | null
          faq_hit_count?: number | null
          id?: string
          languages_detected?: string[] | null
          stt_failures?: number | null
          total_turns?: number | null
          ttfs_ms?: number | null
          user_id: string
        }
        Update: {
          avg_turn_duration_ms?: number | null
          barge_in_count?: number | null
          call_sid?: string
          created_at?: string | null
          end_to_audio_ms?: number | null
          faq_hit_count?: number | null
          id?: string
          languages_detected?: string[] | null
          stt_failures?: number | null
          total_turns?: number | null
          ttfs_ms?: number | null
          user_id?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          appointment_scheduled: string | null
          call_summary: string | null
          call_type: string
          caller_name: string | null
          caller_phone: string | null
          created_at: string
          customer_name: string | null
          customer_topic: string | null
          duration_seconds: number | null
          id: string
          language: string | null
          status: string | null
          summary: string | null
          transcript: Json | null
          user_id: string
        }
        Insert: {
          appointment_scheduled?: string | null
          call_summary?: string | null
          call_type?: string
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string
          customer_name?: string | null
          customer_topic?: string | null
          duration_seconds?: number | null
          id?: string
          language?: string | null
          status?: string | null
          summary?: string | null
          transcript?: Json | null
          user_id: string
        }
        Update: {
          appointment_scheduled?: string | null
          call_summary?: string | null
          call_type?: string
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string
          customer_name?: string | null
          customer_topic?: string | null
          duration_seconds?: number | null
          id?: string
          language?: string | null
          status?: string | null
          summary?: string | null
          transcript?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_appointment_scheduled_fkey"
            columns: ["appointment_scheduled"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          country_code: string
          created_at: string | null
          elevenlabs_agent_id: string | null
          elevenlabs_phone_id: string
          id: string
          is_active: boolean | null
          monthly_cost: number | null
          phone_number: string
          purchased_at: string | null
          status: string
          twilio_sid: string | null
          updated_at: string | null
          user_id: string
          vapi_assistant_id: string | null
        }
        Insert: {
          country_code?: string
          created_at?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_phone_id: string
          id?: string
          is_active?: boolean | null
          monthly_cost?: number | null
          phone_number: string
          purchased_at?: string | null
          status?: string
          twilio_sid?: string | null
          updated_at?: string | null
          user_id: string
          vapi_assistant_id?: string | null
        }
        Update: {
          country_code?: string
          created_at?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_phone_id?: string
          id?: string
          is_active?: boolean | null
          monthly_cost?: number | null
          phone_number?: string
          purchased_at?: string | null
          status?: string
          twilio_sid?: string | null
          updated_at?: string | null
          user_id?: string
          vapi_assistant_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          business_name: string | null
          business_type: string | null
          created_at: string
          dialogflow_agent_id: string | null
          elevenlabs_agent_id: string | null
          id: string
          phone: string | null
          phone_number: string | null
          subscription_plan_id: string | null
          subscription_started_at: string | null
          subscription_status: string | null
          updated_at: string
          user_id: string
          vapi_assistant_id: string | null
          voice_provider: string | null
        }
        Insert: {
          address?: string | null
          business_name?: string | null
          business_type?: string | null
          created_at?: string
          dialogflow_agent_id?: string | null
          elevenlabs_agent_id?: string | null
          id?: string
          phone?: string | null
          phone_number?: string | null
          subscription_plan_id?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id: string
          vapi_assistant_id?: string | null
          voice_provider?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string | null
          business_type?: string | null
          created_at?: string
          dialogflow_agent_id?: string | null
          elevenlabs_agent_id?: string | null
          id?: string
          phone?: string | null
          phone_number?: string | null
          subscription_plan_id?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id?: string
          vapi_assistant_id?: string | null
          voice_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_subscription_plan_id_fkey"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          agent_id: string | null
          created_at: string | null
          id: string
          ip_address: string | null
          limit_type: string
          operation_type: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          limit_type: string
          operation_type: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          limit_type?: string
          operation_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      scripts: {
        Row: {
          agent_voice_gender: string | null
          business_hours: string | null
          created_at: string
          custom_prompt: string | null
          faq: Json | null
          greeting_message: string | null
          id: string
          is_active: boolean | null
          language: string | null
          name: string
          services: string[] | null
          tone: string | null
          updated_at: string
          user_id: string
          voice_id: string | null
        }
        Insert: {
          agent_voice_gender?: string | null
          business_hours?: string | null
          created_at?: string
          custom_prompt?: string | null
          faq?: Json | null
          greeting_message?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          name: string
          services?: string[] | null
          tone?: string | null
          updated_at?: string
          user_id: string
          voice_id?: string | null
        }
        Update: {
          agent_voice_gender?: string | null
          business_hours?: string | null
          created_at?: string
          custom_prompt?: string | null
          faq?: Json | null
          greeting_message?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          name?: string
          services?: string[] | null
          tone?: string | null
          updated_at?: string
          user_id?: string
          voice_id?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          created_at: string
          has_ai_agent: boolean
          has_analytics: boolean
          id: string
          is_active: boolean
          max_appointments_per_month: number
          max_calls_per_month: number
          max_scripts: number
          name: string
          name_he: string
          price_monthly: number
        }
        Insert: {
          created_at?: string
          has_ai_agent?: boolean
          has_analytics?: boolean
          id?: string
          is_active?: boolean
          max_appointments_per_month?: number
          max_calls_per_month?: number
          max_scripts?: number
          name: string
          name_he: string
          price_monthly?: number
        }
        Update: {
          created_at?: string
          has_ai_agent?: boolean
          has_analytics?: boolean
          id?: string
          is_active?: boolean
          max_appointments_per_month?: number
          max_calls_per_month?: number
          max_scripts?: number
          name?: string
          name_he?: string
          price_monthly?: number
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          admin_response: string | null
          created_at: string
          id: string
          message: string
          priority: string
          responded_at: string | null
          responded_by: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          created_at?: string
          id?: string
          message: string
          priority?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          created_at?: string
          id?: string
          message?: string
          priority?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_health: {
        Row: {
          active_calls: number | null
          avg_end_to_audio_ms: number | null
          avg_ttfs_ms: number | null
          circuit_breaker_status: Json | null
          error_count: number | null
          id: string
          stt_success_rate: number | null
          timestamp: string | null
          tts_success_rate: number | null
        }
        Insert: {
          active_calls?: number | null
          avg_end_to_audio_ms?: number | null
          avg_ttfs_ms?: number | null
          circuit_breaker_status?: Json | null
          error_count?: number | null
          id?: string
          stt_success_rate?: number | null
          timestamp?: string | null
          tts_success_rate?: number | null
        }
        Update: {
          active_calls?: number | null
          avg_end_to_audio_ms?: number | null
          avg_ttfs_ms?: number | null
          circuit_breaker_status?: Json | null
          error_count?: number | null
          id?: string
          stt_success_rate?: number | null
          timestamp?: string | null
          tts_success_rate?: number | null
        }
        Relationships: []
      }
      usage_stats: {
        Row: {
          appointments_count: number
          calls_count: number
          id: string
          month_year: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointments_count?: number
          calls_count?: number
          id?: string
          month_year: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointments_count?: number
          calls_count?: number
          id?: string
          month_year?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_rate_limit_events: { Args: never; Returns: undefined }
      get_users_with_email: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
