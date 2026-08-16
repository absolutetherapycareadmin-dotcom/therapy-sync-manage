import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  clinic_id: string | null;
  full_name: string | null;
  email: string | null;
  role: string;
};

export type Clinic = {
  id: string;
  name: string;
  owner_id: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  timezone?: string | null;
  device_phone?: string | null;
  device_label?: string | null;
  sms_enabled?: boolean;
  call_enabled?: boolean;
  reminder_lead_minutes?: number;
};


type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  clinic: Clinic | null;
  clinicId: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function loadContext(userId: string, email: string | null, name: string | null) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, clinic_id, full_name, email, role")
    .eq("id", userId)
    .maybeSingle();

  let profile = existing as Profile | null;

  if (!profile) {
    const { data: created } = await supabase
      .from("profiles")
      .insert({ id: userId, email, full_name: name })
      .select("id, clinic_id, full_name, email, role")
      .maybeSingle();
    profile = (created as Profile | null) ?? null;
  }

  let clinic: Clinic | null = null;
  if (profile?.clinic_id) {
    const { data } = await supabase
      .from("clinics")
      .select("id, name, owner_id, phone, email, address, city, currency")
      .eq("id", profile.clinic_id)
      .maybeSingle();
    clinic = (data as Clinic | null) ?? null;
  }

  return { profile, clinic };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);

  const hydrate = async (nextSession: Session | null) => {
    setSession(nextSession);
    if (!nextSession?.user) {
      setProfile(null);
      setClinic(null);
      setLoading(false);
      return;
    }
    const meta = nextSession.user.user_metadata as Record<string, unknown> | undefined;
    const name = (meta?.["full_name"] as string) ?? (meta?.["name"] as string) ?? null;
    const result = await loadContext(nextSession.user.id, nextSession.user.email ?? null, name);
    setProfile(result.profile);
    setClinic(result.clinic);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === "TOKEN_REFRESHED") {
        setSession(nextSession);
        return;
      }
      setLoading(true);
      void hydrate(nextSession);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (active) void hydrate(data.session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      clinic,
      clinicId: profile?.clinic_id ?? null,
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        await hydrate(data.session);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
        setClinic(null);
        setSession(null);
      },
    }),
    [loading, session, profile, clinic],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
