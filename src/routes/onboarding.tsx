import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set up your clinic — Therapy Care" },
      { name: "description", content: "Create your clinic workspace in Therapy Care." },
      { property: "og:title", content: "Set up your clinic — Therapy Care" },
      { property: "og:description", content: "Create your clinic workspace in Therapy Care." },
    ],
  }),
  component: Onboarding,
});

const schema = z.object({
  name: z.string().trim().min(2, "Clinic name is required").max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(255).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
});

function Onboarding() {
  const { loading, session, user, clinicId, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", address: "" });

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/auth", replace: true });
    else if (clinicId) void navigate({ to: "/dashboard", replace: true });
  }, [loading, session, clinicId, navigate]);

  const submit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    if (!user) return;
    setBusy(true);

    const { data: clinic, error } = await supabase
      .from("clinics")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        city: parsed.data.city || null,
        address: parsed.data.address || null,
      })
      .select("id")
      .single();

    if (error || !clinic) {
      setBusy(false);
      toast.error(error?.message ?? "Could not create clinic");
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ clinic_id: clinic.id, role: "owner" })
      .eq("id", user.id);

    if (profileError) {
      setBusy(false);
      toast.error(profileError.message);
      return;
    }

    await refresh();
    setBusy(false);
    toast.success("Clinic created. Welcome to Therapy Care.");
    void navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-[var(--shadow-elevated)] sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HeartPulse className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Therapy Care</p>
            <p className="text-xs text-muted-foreground">Clinic setup</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Set up your clinic</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your clinic workspace starts completely empty. You can add therapists, rooms and children
          right after setup.
        </p>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clinic-name">Clinic name *</Label>
            <Input
              id="clinic-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Bright Steps Therapy Centre"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clinic-phone">Phone</Label>
              <Input
                id="clinic-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinic-email">Email</Label>
              <Input
                id="clinic-email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="hello@clinic.com"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-city">City</Label>
            <Input
              id="clinic-city"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-address">Address</Label>
            <Textarea
              id="clinic-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              rows={3}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Create clinic
          </Button>
        </div>
      </div>
    </div>
  );
}
