// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run gen:types
// Source of truth: the live Supabase schema (supabase/migrations).

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
      activities: {
        Row: {
          also_profiles: string[]
          athlete_id: number | null
          created_at: string
          distance: number
          elapsed_time: number | null
          elevation_gain: number | null
          elevation_profile: Json | null
          geom: unknown
          id: string
          is_race: boolean
          lat: number | null
          lng: number | null
          moving_time: number | null
          name: string | null
          owner_profile: string | null
          place_id: string | null
          shared_group_id: string | null
          solo_profile: string | null
          source: string | null
          source_id: string | null
          start_date: string | null
          strava_id: number | null
          summary_polyline: string | null
          trailhead: string | null
          type: string
        }
        Insert: {
          also_profiles?: string[]
          athlete_id?: number | null
          created_at?: string
          distance?: number
          elapsed_time?: number | null
          elevation_gain?: number | null
          elevation_profile?: Json | null
          geom?: unknown
          id?: string
          is_race?: boolean
          lat?: number | null
          lng?: number | null
          moving_time?: number | null
          name?: string | null
          owner_profile?: string | null
          place_id?: string | null
          shared_group_id?: string | null
          solo_profile?: string | null
          source?: string | null
          source_id?: string | null
          start_date?: string | null
          strava_id?: number | null
          summary_polyline?: string | null
          trailhead?: string | null
          type: string
        }
        Update: {
          also_profiles?: string[]
          athlete_id?: number | null
          created_at?: string
          distance?: number
          elapsed_time?: number | null
          elevation_gain?: number | null
          elevation_profile?: Json | null
          geom?: unknown
          id?: string
          is_race?: boolean
          lat?: number | null
          lng?: number | null
          moving_time?: number | null
          name?: string | null
          owner_profile?: string | null
          place_id?: string | null
          shared_group_id?: string | null
          solo_profile?: string | null
          source?: string | null
          source_id?: string | null
          start_date?: string | null
          strava_id?: number | null
          summary_polyline?: string | null
          trailhead?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_owner_profile_fkey"
            columns: ["owner_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "activities_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_solo_profile_fkey"
            columns: ["solo_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_reactions: {
        Row: {
          activity_id: string
          created_at: string
          emoji: string
          id: string
          profile_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          emoji: string
          id?: string
          profile_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          emoji?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_reactions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_items: {
        Row: {
          board: string
          created_at: string
          created_by: string | null
          done: boolean
          done_at: string | null
          id: string
          note: string | null
          title: string
          url: string | null
        }
        Insert: {
          board: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          id?: string
          note?: string | null
          title: string
          url?: string | null
        }
        Update: {
          board?: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          id?: string
          note?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_hashes: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          sha256: string
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          sha256: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_hashes_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dup_dismissed: {
        Row: {
          created_at: string
          created_by: string | null
          place_a: string
          place_b: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          place_a: string
          place_b: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          place_a?: string
          place_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "dup_dismissed_place_a_fkey"
            columns: ["place_a"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "dup_dismissed_place_a_fkey"
            columns: ["place_a"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dup_dismissed_place_b_fkey"
            columns: ["place_b"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "dup_dismissed_place_b_fkey"
            columns: ["place_b"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          address: string | null
          body: string | null
          created_at: string
          created_by: string | null
          date: string | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          place_id: string
          rating: number | null
          title: string
          url: string | null
        }
        Insert: {
          address?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          date?: string | null
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          place_id: string
          rating?: number | null
          title: string
          url?: string | null
        }
        Update: {
          address?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          date?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          place_id?: string
          rating?: number | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "entries_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      experience_requests: {
        Row: {
          created_at: string
          created_by: string | null
          idempotency_key: string
          place_id: string | null
          visit_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          idempotency_key: string
          place_id?: string | null
          visit_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          idempotency_key?: string
          place_id?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experience_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_tokens: {
        Row: {
          profile_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_tokens: {
        Row: {
          created_at: string
          id: string
          label: string | null
          last_used_at: string | null
          profile_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          profile_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          profile_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          job: string
          started_at: string
          summary: Json | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          job: string
          started_at?: string
          summary?: Json | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          job?: string
          started_at?: string
          summary?: Json | null
        }
        Relationships: []
      }
      join_requests: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          note: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          note?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          note?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      location_pings: {
        Row: {
          accuracy: number | null
          created_at: string
          geom: unknown
          id: string
          lat: number
          lng: number
          place_id: string | null
          profile_id: string | null
          recorded_at: string
          source: string | null
        }
        Insert: {
          accuracy?: number | null
          created_at?: string
          geom?: unknown
          id?: string
          lat: number
          lng: number
          place_id?: string | null
          profile_id?: string | null
          recorded_at: string
          source?: string | null
        }
        Update: {
          accuracy?: number | null
          created_at?: string
          geom?: unknown
          id?: string
          lat?: number
          lng?: number
          place_id?: string | null
          profile_id?: string | null
          recorded_at?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_pings_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "location_pings_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_pings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          profile_id: string
          provider: string
          state: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          profile_id: string
          provider?: string
          state: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          profile_id?: string
          provider?: string
          state?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parks: {
        Row: {
          boundary: unknown
          created_at: string
          id: string
          name: string
        }
        Insert: {
          boundary: unknown
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          boundary?: unknown
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      peak_bags: {
        Row: {
          activity_id: string
          peak_id: string
          place_id: string | null
          profile_id: string | null
        }
        Insert: {
          activity_id: string
          peak_id: string
          place_id?: string | null
          profile_id?: string | null
        }
        Update: {
          activity_id?: string
          peak_id?: string
          place_id?: string | null
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "peak_bags_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peak_bags_peak_id_fkey"
            columns: ["peak_id"]
            isOneToOne: false
            referencedRelation: "peaks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peak_bags_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "peak_bags_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peak_bags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      peaks: {
        Row: {
          created_at: string
          ele_m: number | null
          geom: unknown
          id: string
          lat: number
          lng: number
          name: string
        }
        Insert: {
          created_at?: string
          ele_m?: number | null
          geom?: unknown
          id?: string
          lat: number
          lng: number
          name: string
        }
        Update: {
          created_at?: string
          ele_m?: number | null
          geom?: unknown
          id?: string
          lat?: number
          lng?: number
          name?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          birthdate: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_name: string
          id: string
          kind: string
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name: string
          id?: string
          kind?: string
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          photo_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          photo_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          photo_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_reactions_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          created_at: string
          deleted_at: string | null
          entry_id: string | null
          geom: unknown
          height: number | null
          id: string
          is_landscape: boolean | null
          lat: number | null
          lng: number | null
          place_id: string | null
          r2_key: string
          sha256: string
          source: string
          taken_at: string | null
          thumb_key: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          entry_id?: string | null
          geom?: unknown
          height?: number | null
          id?: string
          is_landscape?: boolean | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          r2_key: string
          sha256: string
          source?: string
          taken_at?: string | null
          thumb_key: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          entry_id?: string | null
          geom?: unknown
          height?: number | null
          id?: string
          is_landscape?: boolean | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          r2_key?: string
          sha256?: string
          source?: string
          taken_at?: string | null
          thumb_key?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "photos_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      place_categories: {
        Row: {
          color: string
          created_at: string
          icon: string
          is_auto: boolean
          is_container: boolean
          is_custom: boolean
          label: string
          review: string
          slug: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          is_auto?: boolean
          is_container?: boolean
          is_custom?: boolean
          label: string
          review: string
          slug: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          is_auto?: boolean
          is_container?: boolean
          is_custom?: boolean
          label?: string
          review?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      place_membership: {
        Row: {
          child_id: string
          created_at: string
          parent_id: string
          relationship_type: string
        }
        Insert: {
          child_id: string
          created_at?: string
          parent_id: string
          relationship_type?: string
        }
        Update: {
          child_id?: string
          created_at?: string
          parent_id?: string
          relationship_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_membership_child_fk"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_membership_child_fk"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_membership_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_membership_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_membership_parent_fk"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_membership_parent_fk"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_membership_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_membership_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      place_membership_exceptions: {
        Row: {
          child_id: string | null
          detected_at: string
          parent_id: string | null
          reason: string
        }
        Insert: {
          child_id?: string | null
          detected_at?: string
          parent_id?: string | null
          reason: string
        }
        Update: {
          child_id?: string | null
          detected_at?: string
          parent_id?: string | null
          reason?: string
        }
        Relationships: []
      }
      place_ratings: {
        Row: {
          place_id: string
          profile_id: string
          rating: number
          updated_at: string
        }
        Insert: {
          place_id: string
          profile_id: string
          rating: number
          updated_at?: string
        }
        Update: {
          place_id?: string
          profile_id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_ratings_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_ratings_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_ratings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      place_wishes: {
        Row: {
          created_at: string
          place_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          place_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          place_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_wishes_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_wishes_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_wishes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          activity_categories: string[]
          address: string | null
          admin1: string | null
          auto: boolean
          boundary: unknown
          bucket: boolean
          categories: string[]
          category: string | null
          city: string | null
          country: string | null
          counts_as_place: boolean | null
          cover_photo_id: string | null
          cover_pos_y: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          favorite: string | null
          first_visit: string | null
          geocoded_at: string | null
          geom: unknown
          holds_children: boolean
          id: string
          is_home: boolean
          is_trail: boolean
          kind: string
          last_visit: string | null
          lat: number
          lng: number
          name: string
          name_locked: boolean
          name_scope: string | null
          named_by: string | null
          needs_geocode: boolean
          park: string | null
          part_of: string[]
          rating: number | null
          review: string | null
          saved: boolean
          suggested: boolean
          visit_count: number
          website: string | null
        }
        Insert: {
          activity_categories?: string[]
          address?: string | null
          admin1?: string | null
          auto?: boolean
          boundary?: unknown
          bucket?: boolean
          categories?: string[]
          category?: string | null
          city?: string | null
          country?: string | null
          counts_as_place?: boolean | null
          cover_photo_id?: string | null
          cover_pos_y?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          favorite?: string | null
          first_visit?: string | null
          geocoded_at?: string | null
          geom?: unknown
          holds_children?: boolean
          id?: string
          is_home?: boolean
          is_trail?: boolean
          kind?: string
          last_visit?: string | null
          lat: number
          lng: number
          name: string
          name_locked?: boolean
          name_scope?: string | null
          named_by?: string | null
          needs_geocode?: boolean
          park?: string | null
          part_of?: string[]
          rating?: number | null
          review?: string | null
          saved?: boolean
          suggested?: boolean
          visit_count?: number
          website?: string | null
        }
        Update: {
          activity_categories?: string[]
          address?: string | null
          admin1?: string | null
          auto?: boolean
          boundary?: unknown
          bucket?: boolean
          categories?: string[]
          category?: string | null
          city?: string | null
          country?: string | null
          counts_as_place?: boolean | null
          cover_photo_id?: string | null
          cover_pos_y?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          favorite?: string | null
          first_visit?: string | null
          geocoded_at?: string | null
          geom?: unknown
          holds_children?: boolean
          id?: string
          is_home?: boolean
          is_trail?: boolean
          kind?: string
          last_visit?: string | null
          lat?: number
          lng?: number
          name?: string
          name_locked?: boolean
          name_scope?: string | null
          named_by?: string | null
          needs_geocode?: boolean
          park?: string | null
          part_of?: string[]
          rating?: number | null
          review?: string | null
          saved?: boolean
          suggested?: boolean
          visit_count?: number
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "places_cover_photo_id_fkey"
            columns: ["cover_photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_name_scope_fkey"
            columns: ["name_scope"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_named_by_fkey"
            columns: ["named_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          role: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      revealed_area: {
        Row: {
          geom: unknown
          id: number
          updated_at: string | null
        }
        Insert: {
          geom?: unknown
          id?: number
          updated_at?: string | null
        }
        Update: {
          geom?: unknown
          id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      shared_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      strava_accounts: {
        Row: {
          access_token: string
          athlete_id: number
          created_at: string
          expires_at: string
          profile_id: string | null
          refresh_token: string
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          athlete_id: number
          created_at?: string
          expires_at: string
          profile_id?: string | null
          refresh_token: string
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          athlete_id?: number
          created_at?: string
          expires_at?: string
          profile_id?: string | null
          refresh_token?: string
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strava_accounts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_migration_exceptions: {
        Row: {
          detected_at: string
          parent_trip_place_id: string | null
          place_id: string | null
          reason: string
        }
        Insert: {
          detected_at?: string
          parent_trip_place_id?: string | null
          place_id?: string | null
          reason: string
        }
        Update: {
          detected_at?: string
          parent_trip_place_id?: string | null
          place_id?: string | null
          reason?: string
        }
        Relationships: []
      }
      trip_notes: {
        Row: {
          created_at: string
          day: string
          id: string
          note: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          day: string
          id?: string
          note: string
          trip_id: string
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          note?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_notes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_people: {
        Row: {
          created_at: string
          person_id: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          person_id: string
          trip_id: string
        }
        Update: {
          created_at?: string
          person_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_people_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_stops: {
        Row: {
          created_at: string
          id: string
          note: string | null
          place_id: string
          sort_order: number
          status: string
          trip_id: string
          visit_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          place_id: string
          sort_order?: number
          status?: string
          trip_id: string
          visit_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          place_id?: string
          sort_order?: number
          status?: string
          trip_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_stops_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "trip_stops_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stops_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stops_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          name: string
          source_place_id: string | null
          start_date: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name: string
          source_place_id?: string | null
          start_date?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name?: string
          source_place_id?: string | null
          start_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_source_place_id_fkey"
            columns: ["source_place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "trips_source_place_id_fkey"
            columns: ["source_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          content_type: string
          created_at: string
          duration_s: number | null
          id: string
          lat: number | null
          lng: number | null
          place_id: string | null
          poster_key: string | null
          r2_key: string
          source: string
          taken_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string
          created_at?: string
          duration_s?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          poster_key?: string | null
          r2_key: string
          source?: string
          taken_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string
          duration_s?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          poster_key?: string | null
          r2_key?: string
          source?: string
          taken_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "videos_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_people: {
        Row: {
          created_at: string
          person_id: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          person_id: string
          visit_id: string
        }
        Update: {
          created_at?: string
          person_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_people_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_trip: boolean
          manual: boolean
          note: string | null
          place_id: string
          solo_override: boolean
          solo_profile: string | null
          start_date: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          is_trip?: boolean
          manual?: boolean
          note?: string | null
          place_id: string
          solo_override?: boolean
          solo_profile?: string | null
          start_date: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          is_trip?: boolean
          manual?: boolean
          note?: string | null
          place_id?: string
          solo_override?: boolean
          solo_profile?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place_counts"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "visits_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_solo_profile_fkey"
            columns: ["solo_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      activity_mileage: {
        Row: {
          activity_count: number | null
          meters: number | null
          miles: number | null
          type: string | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      place_counts: {
        Row: {
          miles: number | null
          photo_count: number | null
          place_id: string | null
          route_count: number | null
        }
        Insert: {
          miles?: never
          photo_count?: never
          place_id?: string | null
          route_count?: never
        }
        Update: {
          miles?: never
          photo_count?: never
          place_id?: string | null
          route_count?: never
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      activity_category: { Args: { p_type: string }; Returns: string }
      activity_reactions_for: {
        Args: { p_activity: string }
        Returns: {
          emoji: string
          mine: boolean
          n: number
          who: string[]
        }[]
      }
      add_place_category: {
        Args: {
          p_color?: string
          p_icon?: string
          p_label: string
          p_review?: string
        }
        Returns: string
      }
      add_to_container: {
        Args: { p_child: string; p_parent: string }
        Returns: undefined
      }
      add_trip_note: {
        Args: { p_day: string; p_note: string; p_trip: string }
        Returns: string
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      approve_join_request: {
        Args: { p_id: string; p_role: string }
        Returns: undefined
      }
      assert_member: { Args: never; Returns: undefined }
      assign_activity_place: {
        Args: { p_lat: number; p_lng: number }
        Returns: string
      }
      assign_activity_to_race: {
        Args: { p_activity: string; p_race_name: string; p_race_place?: string }
        Returns: string
      }
      can_rename_place: {
        Args: { p_caller: string; p_place: string }
        Returns: boolean
      }
      claim_invite: {
        Args: never
        Returns: {
          created_at: string
          display_name: string | null
          id: string
          role: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_city: { Args: { p_place: string }; Returns: undefined }
      climbing_stats: {
        Args: { p_profile?: string }
        Returns: {
          everests: number
          total_ft: number
        }[]
      }
      cluster_now: { Args: never; Returns: Json }
      cluster_unassigned: { Args: never; Returns: Json }
      complete_stops_on_taken_trips: { Args: never; Returns: number }
      confirm_suggested_trip: { Args: { p_place: string }; Returns: string }
      consume_oauth_state: {
        Args: { p_provider?: string; p_state: string }
        Returns: string
      }
      create_experience: {
        Args: { p_key: string; p_place: Json; p_visit?: Json }
        Returns: Json
      }
      create_manual_activity: {
        Args: {
          p_date: string
          p_distance: number
          p_lat: number
          p_lng: number
          p_name: string
          p_place: string
          p_polyline: string
          p_type: string
        }
        Returns: string
      }
      current_app_role: { Args: never; Returns: string }
      data_health: { Args: never; Returns: Json }
      date_night_pick: {
        Args: { p_lat?: number; p_lng?: number; p_radius_km?: number }
        Returns: string
      }
      dedupe_joint_outings: { Args: never; Returns: number }
      dedupe_shared_outings: { Args: never; Returns: number }
      delete_trip_note: { Args: { p_id: string }; Returns: undefined }
      deny_join_request: { Args: { p_id: string }; Returns: undefined }
      disablelongtransactions: { Args: never; Returns: string }
      dismiss_duplicate: {
        Args: { p_a: string; p_b: string }
        Returns: undefined
      }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      ensure_visit: {
        Args: { p_day: string; p_place: string }
        Returns: undefined
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geo_coverage: {
        Args: { p_profile?: string }
        Returns: {
          countries: string[]
          country_count: number
          has_dc: boolean
          us_state_count: number
          us_states: string[]
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      import_file_activity: {
        Args: {
          p_date: string
          p_distance: number
          p_lat: number
          p_lng: number
          p_moving: number
          p_name: string
          p_polyline: string
          p_type: string
        }
        Returns: string
      }
      is_editor_or_owner: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      last_automated_upload: { Args: never; Returns: string }
      list_trash: {
        Args: never
        Returns: {
          deleted_at: string
          id: string
          kind: string
          label: string
          place_id: string
        }[]
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      map_people: {
        Args: never
        Returns: {
          display_name: string
          id: string
          role: string
        }[]
      }
      match_photo: {
        Args: { p_lat?: number; p_lng?: number; p_taken_at: string }
        Returns: {
          meters: number
          name: string
          place_id: string
          reason: string
          score: number
        }[]
      }
      merge_nearby_dupes: { Args: never; Returns: number }
      merge_places: {
        Args: { p_loser: string; p_winner: string }
        Returns: undefined
      }
      merge_places_auto: {
        Args: { p_loser: string; p_winner: string }
        Returns: undefined
      }
      migrate_container_place_trips: { Args: never; Returns: undefined }
      mileage_by_person: {
        Args: { p_profile?: string }
        Returns: {
          activity_count: number
          meters: number
          miles: number
          type: string
        }[]
      }
      occasion_count: { Args: { p_profile?: string }; Returns: number }
      on_this_day: {
        Args: never
        Returns: {
          photo_id: string
          place_id: string
          place_name: string
          taken_at: string
        }[]
      }
      peaks_bagged: {
        Args: { p_profile?: string }
        Returns: {
          ele_ft: number
          id: string
          name: string
          place_id: string
        }[]
      }
      photo_reactions_for: {
        Args: { p_photo: string }
        Returns: {
          emoji: string
          mine: boolean
          n: number
          who: string[]
        }[]
      }
      pings_overview: {
        Args: never
        Returns: {
          lat: number
          lng: number
          weight: number
        }[]
      }
      place_attribution: {
        Args: never
        Returns: {
          place_id: string
          solo_profile: string
        }[]
      }
      place_days: {
        Args: { p_place: string }
        Returns: {
          activities: number
          day: string
          entries: number
          label: string
          photos: number
          pings: number
        }[]
      }
      place_for_activity: {
        Args: { p_lat: number; p_lng: number; p_name: string; p_type: string }
        Returns: string
      }
      place_ids_for_view: { Args: { p_profile?: string }; Returns: string[] }
      place_is_saved: { Args: { pid: string }; Returns: boolean }
      place_people: {
        Args: never
        Returns: {
          place_id: string
          profile_id: string
        }[]
      }
      place_ratings_for: {
        Args: { p_place: string }
        Returns: {
          profile_id: string
          rating: number
        }[]
      }
      place_visit_counts: {
        Args: { p_profile?: string }
        Returns: {
          place_id: string
          visits: number
        }[]
      }
      place_visit_stats: {
        Args: { p_place: string }
        Returns: {
          photos: number
          videos: number
          visit_id: string
        }[]
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      promote_trip_stops_for_place: {
        Args: { p_place: string }
        Returns: undefined
      }
      purge_trash: { Args: never; Returns: undefined }
      race_bucket: { Args: { p_miles: number }; Returns: string }
      race_stats: {
        Args: { p_profile?: string }
        Returns: {
          bucket: string
          miles: number
          n: number
          ord: number
        }[]
      }
      races_list: {
        Args: { p_profile?: string }
        Returns: {
          bucket: string
          id: string
          miles: number
          name: string
          times: number
        }[]
      }
      reassign_activity: {
        Args: { p_activity: string; p_place: string }
        Returns: undefined
      }
      rebuild_place_visits: { Args: { p_place: string }; Returns: undefined }
      rebuild_revealed_area: { Args: never; Returns: undefined }
      recompute_place_stats: { Args: { p_place: string }; Returns: undefined }
      remove_from_container: {
        Args: { p_child: string; p_parent: string }
        Returns: undefined
      }
      restore_photo: { Args: { p_id: string }; Returns: undefined }
      restore_place: { Args: { p_id: string }; Returns: undefined }
      revealed_area_geojson: { Args: never; Returns: Json }
      search_photos: {
        Args: { p_filter: Json }
        Returns: {
          caption: string
          category: string
          city: string
          photo_id: string
          place_id: string
          place_name: string
          taken_at: string
        }[]
      }
      set_activity_race: {
        Args: { p_activity: string; p_is_race: boolean }
        Returns: undefined
      }
      set_activity_solo: {
        Args: { p_activity: string; p_profile: string }
        Returns: undefined
      }
      set_city_boundary: {
        Args: { p_geojson: string; p_kind?: string; p_place: string }
        Returns: undefined
      }
      set_my_rating: {
        Args: { p_place: string; p_rating: number }
        Returns: undefined
      }
      set_photo_caption: {
        Args: { p_caption: string; p_photo: string }
        Returns: undefined
      }
      set_place_name: {
        Args: { p_name: string; p_place: string; p_scope?: string }
        Returns: {
          activity_categories: string[]
          address: string | null
          admin1: string | null
          auto: boolean
          boundary: unknown
          bucket: boolean
          categories: string[]
          category: string | null
          city: string | null
          country: string | null
          counts_as_place: boolean | null
          cover_photo_id: string | null
          cover_pos_y: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          favorite: string | null
          first_visit: string | null
          geocoded_at: string | null
          geom: unknown
          holds_children: boolean
          id: string
          is_home: boolean
          is_trail: boolean
          kind: string
          last_visit: string | null
          lat: number
          lng: number
          name: string
          name_locked: boolean
          name_scope: string | null
          named_by: string | null
          needs_geocode: boolean
          park: string | null
          part_of: string[]
          rating: number | null
          review: string | null
          saved: boolean
          suggested: boolean
          visit_count: number
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "places"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_place_solo: {
        Args: { p_place: string; p_profile: string }
        Returns: undefined
      }
      set_visit_dates: {
        Args: { p_end: string; p_start: string; p_visit: string }
        Returns: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_trip: boolean
          manual: boolean
          note: string | null
          place_id: string
          solo_override: boolean
          solo_profile: string | null
          start_date: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_visit_is_trip: {
        Args: { p_is_trip: boolean; p_visit: string }
        Returns: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_trip: boolean
          manual: boolean
          note: string | null
          place_id: string
          solo_override: boolean
          solo_profile: string | null
          start_date: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_visit_solo: {
        Args: { p_profile: string; p_visit: string }
        Returns: undefined
      }
      settings_stats: {
        Args: { p_profile?: string }
        Returns: {
          camping: number
          dining: number
          trails_taken: number
          winery: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_photo: { Args: { p_id: string }; Returns: undefined }
      soft_delete_place: { Args: { p_id: string }; Returns: undefined }
      spatial_members: { Args: { p_container: string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      strava_athletes: {
        Args: never
        Returns: {
          athlete_id: number
          display_name: string
          profile_id: string
        }[]
      }
      strava_connected: { Args: never; Returns: boolean }
      strava_connected_me: { Args: never; Returns: boolean }
      strava_oauth_start: { Args: never; Returns: string }
      toggle_activity_reaction: {
        Args: { p_activity: string; p_emoji: string }
        Returns: undefined
      }
      toggle_photo_reaction: {
        Args: { p_emoji: string; p_photo: string }
        Returns: undefined
      }
      toggle_wish: { Args: { p_place: string }; Returns: undefined }
      tracking_status: {
        Args: never
        Returns: {
          display_name: string
          last_ping: string
          pings: number
          profile_id: string
        }[]
      }
      trip_contents: {
        Args: { p_visit: string }
        Returns: {
          end_date: string
          place_id: string
          place_name: string
          start_date: string
          visit_id: string
        }[]
      }
      trip_place_ids: { Args: { p_trip: string }; Returns: string[] }
      trip_stats: { Args: { p_trip: string }; Returns: Json }
      trip_timeline: {
        Args: { p_trip: string }
        Returns: {
          day: string
          kind: string
          place_id: string
          sub: string
          title: string
        }[]
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_activity: {
        Args: { p_id: string; p_name: string; p_type?: string }
        Returns: undefined
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      visit_is_inside_trip: { Args: { p_visit: string }; Returns: boolean }
      wander_stats: {
        Args: { p_profile?: string }
        Returns: {
          miles: number
          places_count: number
          trips_count: number
        }[]
      }
      wishes_overview: {
        Args: never
        Returns: {
          everyone: boolean
          member_total: number
          n: number
          place_id: string
          wanters: string[]
        }[]
      }
      wrapped_year_miles: { Args: { p_year: number }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
