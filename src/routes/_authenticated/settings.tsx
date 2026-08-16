import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { specialtiesQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Therapy Care" },
      { name: "description", content: "Manage clinic details, specialties and your account." },
      { property: "og:title", content: "Settings — Therapy Care" },
      { property: "og:description", content: "Manage clinic details, specialties and account." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { clinic, clinicId, profile, refresh, signOut } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    address: "",
    currency: "INR",
  });
  const [specialtyName, setSpecialtyName] = useState("");

  useEffect(() => {
    if (clinic) {
      setForm({
        name: clinic.name ?? "",
        phone: clinic.phone ?? "",
        email: clinic.email ?? "",
        city: clinic.city ?? "",
        address: clinic.address ?? "",
        currency: clinic.currency ?? "INR",
      });
    }
  }, [clinic]);

  const specialties = useQuery({ ...specialtiesQuery(id), enabled: !!id });

  const saveClinic = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Clinic name is required");
      const { error } = await supabase
        .from("clinics")
        .update({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          currency: form.currency.trim().toUpperCase() || "INR",
        })
        .eq("id", id);
      if (error) throw error;
      await refresh();
    },
    onSuccess: () => toast.success("Clinic details saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  const addSpecialty = useMutation({
    mutationFn: async () => {
      if (!specialtyName.trim()) throw new Error("Enter a specialty name");
      const { error } = await supabase
        .from("specialties")
        .insert({ clinic_id: id, name: specialtyName.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setSpecialtyName("");
      toast.success("Specialty added");
      void qc.invalidateQueries({ queryKey: ["specialties", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeSpecialty = useMutation({
    mutationFn: async (specialtyId: string) => {
      const { error } = await supabase.from("specialties").delete().eq("id", specialtyId);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["specialties", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Clinic profile, therapy specialties and account." />

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Clinic profile</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Clinic name *</Label>
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              maxLength={20}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              maxLength={255}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            <Input
              value={form.city}
              maxLength={80}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Input
              value={form.currency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Address</Label>
            <Textarea
              rows={2}
              maxLength={500}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => saveClinic.mutate()} disabled={saveClinic.isPending}>
            Save changes
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Therapy specialties</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Used across therapists, packages and appointments.
        </p>
        <div className="mt-4 flex gap-2">
          <Input
            value={specialtyName}
            maxLength={80}
            placeholder="e.g. Occupational Therapy"
            onChange={(e) => setSpecialtyName(e.target.value)}
          />
          <Button onClick={() => addSpecialty.mutate()} disabled={addSpecialty.isPending}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        {(specialties.data ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No specialties added yet.</p>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border">
            {(specialties.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{s.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSpecialty.mutate(s.id)}
                  aria-label={`Remove ${s.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CommunicationDeviceSection />


      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {profile?.email ?? "—"} ({profile?.role ?? "member"}).
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * Centre communication device: the registered admin/owner Android phone whose
 * active SIM sends normal SMS and places normal cellular calls. Provider neutral.
 */
function CommunicationDeviceSection() {
  const { clinic, clinicId, refresh } = useAuth();
  const [device, setDevice] = useState({
    device_phone: "",
    device_label: "",
    sms_enabled: true,
    call_enabled: true,
    reminder_lead_minutes: 30,
  });

  useEffect(() => {
    if (clinic) {
      setDevice({
        device_phone: clinic.device_phone ?? "",
        device_label: clinic.device_label ?? "",
        sms_enabled: clinic.sms_enabled ?? true,
        call_enabled: clinic.call_enabled ?? true,
        reminder_lead_minutes: clinic.reminder_lead_minutes ?? 30,
      });
    }
  }, [clinic]);

  const save = useMutation({
    mutationFn: async () => {
      const phone = device.device_phone.replace(/[^\d+]/g, "");
      if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new Error("Enter a valid device phone number");
      const lead = Number(device.reminder_lead_minutes);
      if (!Number.isFinite(lead) || lead < 5 || lead > 240) {
        throw new Error("Reminder lead time must be between 5 and 240 minutes");
      }
      const { error } = await supabase
        .from("clinics")
        .update({
          device_phone: phone || null,
          device_label: device.device_label.trim() || null,
          sms_enabled: device.sms_enabled,
          call_enabled: device.call_enabled,
          reminder_lead_minutes: Math.round(lead),
        } as never)
        .eq("id", clinicId as string);
      if (error) throw error;
      await refresh();
    },
    onSuccess: () => toast.success("Communication device saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-semibold">Communication device</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Normal SMS and reminder calls are sent from this registered centre device using whichever SIM
        and network is active in it. No telecom provider or paid gateway is used.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Device phone number</Label>
          <Input
            value={device.device_phone}
            maxLength={20}
            placeholder="+9198XXXXXXXX"
            onChange={(e) => setDevice({ ...device, device_phone: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Device label</Label>
          <Input
            value={device.device_label}
            maxLength={80}
            placeholder="Front desk Android phone"
            onChange={(e) => setDevice({ ...device, device_label: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Reminder lead time (minutes)</Label>
          <Input
            type="number"
            min={5}
            max={240}
            value={device.reminder_lead_minutes}
            onChange={(e) => setDevice({ ...device, reminder_lead_minutes: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-end gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={device.sms_enabled}
              onChange={(e) => setDevice({ ...device, sms_enabled: e.target.checked })}
            />
            Queue SMS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={device.call_enabled}
              onChange={(e) => setDevice({ ...device, call_enabled: e.target.checked })}
            />
            Queue reminder calls
          </label>
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save communication settings
        </Button>
      </div>
    </section>
  );
}
