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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          description: string
          id: string
          project_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description?: string
          id?: string
          project_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          id?: string
          project_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          message_id: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          parts?: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          parts?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          pinned: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      panel_stages: {
        Row: {
          id: string
          is_applicable: boolean
          panel_id: string
          project_id: string
          sequence: number
          stage: Database["public"]["Enums"]["prod_stage"]
        }
        Insert: {
          id?: string
          is_applicable?: boolean
          panel_id: string
          project_id: string
          sequence?: number
          stage: Database["public"]["Enums"]["prod_stage"]
        }
        Update: {
          id?: string
          is_applicable?: boolean
          panel_id?: string
          project_id?: string
          sequence?: number
          stage?: Database["public"]["Enums"]["prod_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "panel_stages_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      panels: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          part_area: number
          part_number: string
          part_weight: number
          project_id: string
          sequence: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          part_area?: number
          part_number?: string
          part_weight?: number
          project_id: string
          sequence?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          part_area?: number
          part_number?: string
          part_weight?: number
          project_id?: string
          sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "panels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          new_status: Database["public"]["Enums"]["prod_status"]
          old_status: Database["public"]["Enums"]["prod_status"] | null
          panel_id: string | null
          panel_name: string
          project_id: string
          set_number: number
          stage: Database["public"]["Enums"]["prod_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_status: Database["public"]["Enums"]["prod_status"]
          old_status?: Database["public"]["Enums"]["prod_status"] | null
          panel_id?: string | null
          panel_name: string
          project_id: string
          set_number: number
          stage: Database["public"]["Enums"]["prod_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["prod_status"]
          old_status?: Database["public"]["Enums"]["prod_status"] | null
          panel_id?: string | null
          panel_name?: string
          project_id?: string
          set_number?: number
          stage?: Database["public"]["Enums"]["prod_stage"]
        }
        Relationships: []
      }
      production_sets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          project_id: string
          set_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          project_id: string
          set_number: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string
          set_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_sets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_status: {
        Row: {
          created_at: string
          id: string
          panel_id: string
          project_id: string
          set_id: string
          stage: Database["public"]["Enums"]["prod_stage"]
          status: Database["public"]["Enums"]["prod_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          panel_id: string
          project_id: string
          set_id: string
          stage: Database["public"]["Enums"]["prod_stage"]
          status?: Database["public"]["Enums"]["prod_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          panel_id?: string
          project_id?: string
          set_id?: string
          stage?: Database["public"]["Enums"]["prod_stage"]
          status?: Database["public"]["Enums"]["prod_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_status_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_status_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_status_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "production_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name?: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string
          country: string
          country_other: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          process: string
          set_count: number
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          code: string
          country?: string
          country_other?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          process?: string
          set_count?: number
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          country?: string
          country_other?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          process?: string
          set_count?: number
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      admin_set_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      can_configure: { Args: { _project_id: string }; Returns: boolean }
      can_update_production: { Args: { _project_id: string }; Returns: boolean }
      generate_workflows: { Args: { p_project_id: string }; Returns: number }
      get_admin_stats: { Args: never; Returns: Json }
      get_project_progress: { Args: { p_project_id: string }; Returns: Json }
      get_projects_progress: {
        Args: never
        Returns: {
          panel_count: number
          progress: number
          project_id: string
        }[]
      }
      has_project_access: { Args: { _project_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      my_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      record_login: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "admin"
        | "project_manager"
        | "engineer"
        | "production"
        | "qc"
        | "viewer"
        | "pending"
        | "estimator"
        | "procurement"
        | "finance"
        | "management"
      prod_stage:
        | "lamination"
        | "demould"
        | "trimming"
        | "detailing"
        | "assembly"
        | "bracket_bonding"
        | "panel_to_panel_bonding"
        | "gelcoat_sanding"
        | "primer_spray"
        | "primer_sanding"
        | "painting"
        | "clear_coat"
        | "post_operations"
        | "post_operations_qc"
        | "packing"
      prod_status:
        | "pending"
        | "wip"
        | "completed"
        | "hold"
        | "rework"
        | "not_applicable"
      project_status: "active" | "on_hold" | "completed" | "archived"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "admin",
        "project_manager",
        "engineer",
        "production",
        "qc",
        "viewer",
        "pending",
        "estimator",
        "procurement",
        "finance",
        "management",
      ],
      prod_stage: [
        "lamination",
        "demould",
        "trimming",
        "detailing",
        "assembly",
        "bracket_bonding",
        "panel_to_panel_bonding",
        "gelcoat_sanding",
        "primer_spray",
        "primer_sanding",
        "painting",
        "clear_coat",
        "post_operations",
        "post_operations_qc",
        "packing",
      ],
      prod_status: [
        "pending",
        "wip",
        "completed",
        "hold",
        "rework",
        "not_applicable",
      ],
      project_status: ["active", "on_hold", "completed", "archived"],
    },
  },
} as const
