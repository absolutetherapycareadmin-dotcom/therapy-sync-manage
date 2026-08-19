import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/whatsapp-provider")({
  head: () => ({ meta: [{ title: "WhatsApp Provider — Therapy Care" }] }),
  component: WhatsAppProviderPage,
});

function WhatsAppProviderPage() {
  const { clinic, clinicId, profile, refresh } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const [saving, setSaving] = useState(false);
  const [leadMinutes, setLeadMinutes] = useState<number | null>(null);
  const mode = (clinic as typeof clinic & { whatsapp_mode?: string } | null)?.whatsapp_mode ?? "free_deep_link";
  const configuredLead = (clinic as typeof clinic & { whatsapp_notification_lead_minutes?: number } | null)?.whatsapp_notification_lead_minutes ?? 0;
  const displayLead = leadMinutes ?? configuredLead;

  const providerEvents = useQuery({
    queryKey: ["whatsapp-provider-events", clinicId],
    enabled: !!clinicId && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_provider_events").select("id,provider_message_id,event_type,received_at").eq("clinic_id", clinicId as string).order("received_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveMode = useMutation({
    mutationFn: async (nextMode: "free_deep_link" | "paid_api") => {
      setSaving(true);
      const { data, error } = await supabase.rpc("set_whatsapp_mode", { p_clinic_id: clinicId as string, p_mode: nextMode });
      if (error) throw error;
      if (data !== true) throw new Error("WhatsApp mode was not changed");
      await refresh();
    },
    onSuccess: () => { toast.success("WhatsApp provider mode saved"); void qc.invalidateQueries({ queryKey: ["whatsapp-provider-events", clinicId] }); },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setSaving(false),
  });

  const saveLead = useMutation({
    mutationFn: async () => {
      const value = Number(displayLead);
      if (!Number.isInteger(value) || value < 0 || value > 10080) throw new Error("WhatsApp notification lead time must be between 0 and 10080 minutes");
      const { data, error } = await supabase.rpc("set_whatsapp_notification_lead", { p_clinic_id: clinicId as string, p_lead_minutes: value });
      if (error) throw error;
      if (data !== true) throw new Error("WhatsApp notification timing was not changed");
      await refresh();
      setLeadMinutes(null);
    },
    onSuccess: () => toast.success("WhatsApp notification timing saved"),
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) return <div className="space-y-6"><PageHeader title="WhatsApp Provider" description="Centre Admin access is required." /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Provider" description="Choose the optional paid provider path without changing the free WhatsApp workflow." />
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Notification timing</h2>
        <p className="mt-1 text-sm text-muted-foreground">Appointment WhatsApp preparation becomes due this many minutes before the appointment, using the centre timezone. Zero means prepare immediately when the appointment is booked.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3"><div className="space-y-2"><Label>WhatsApp notification lead time (minutes)</Label><Input type="number" min={0} max={10080} value={displayLead} onChange={(e) => setLeadMinutes(Number(e.target.value))} /></div><Button onClick={() => saveLead.mutate()} disabled={saveLead.isPending}>Save timing</Button></div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Core mode</h2>
        <p className="mt-1 text-sm text-muted-foreground">₹0 Free WhatsApp remains the default: the application generates a wa.me deep link and a human presses Send. It never claims delivery or read status.</p>
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3 rounded-lg border p-4"><input type="radio" name="whatsapp-mode" checked={mode === "free_deep_link"} disabled={saving} onChange={() => saveMode.mutate("free_deep_link")} /><span><span className="block font-medium">₹0 Free WhatsApp — Deep Link</span><span className="text-sm text-muted-foreground">No Meta credentials. Human Send action. No delivery/read claims.</span></span></label>
          <label className="flex items-start gap-3 rounded-lg border p-4"><input type="radio" name="whatsapp-mode" checked={mode === "paid_api"} disabled={saving} onChange={() => saveMode.mutate("paid_api")} /><span><span className="block font-medium">Optional Paid WhatsApp API</span><span className="text-sm text-muted-foreground">Due appointment notifications are sent automatically by the server. If the provider is not configured, the message records an explicit failure and the core free mode remains independent.</span></span></label>
        </div>
        <div className="mt-4 rounded-lg border p-4 text-sm"><p className="font-medium">Credential security</p><p className="mt-1 text-muted-foreground">Meta access tokens, phone-number IDs, app secrets and webhook verification secrets are server-side Supabase secrets. They are never entered, stored, or bundled in this browser page or Android APK.</p></div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Recent provider events</h2>
        <p className="mt-1 text-sm text-muted-foreground">Only provider events associated with this centre's own sent messages are retained.</p>
        {providerEvents.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : providerEvents.data?.length ? <div className="mt-4 divide-y rounded-lg border">{providerEvents.data.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{event.event_type}</span><span className="text-muted-foreground">{event.provider_message_id}</span><span className="text-xs text-muted-foreground">{new Date(event.received_at).toLocaleString()}</span></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">No paid-provider events recorded.</p>}
        <div className="mt-4"><Button variant="outline" onClick={() => void providerEvents.refetch()}>Refresh events</Button></div>
      </section>
    </div>
  );
}
