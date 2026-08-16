import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { therapistsQuery, type Therapist } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/therapists")({
  head: () => ({
    meta: [
      { title: "Therapists — Therapy Care" },
      { name: "description", content: "Manage therapists, specialties and availability." },
      { property: "og:title", content: "Therapists — Therapy Care" },
      { property: "og:description", content: "Manage therapists, specialties and availability." },
    ],
  }),
  component: TherapistsPage,
});

const schema = z.object({ full_name: z.string().trim().min(2, "Therapist name is required").max(120) });

const emptyForm = {
  full_name: "",
  email: "",
  phone: "",
  specialty: "",
  qualification: "",
  availability: "",
  is_active: true,
};

function TherapistsPage() {
  const { clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ ...therapistsQuery(id), enabled: !!id });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Therapist | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (t: Therapist) => {
    setEditing(t);
    setForm({
      full_name: t.full_name ?? "",
      email: t.email ?? "",
      phone: t.phone ?? "",
      specialty: t.specialty ?? "",
      qualification: t.qualification ?? "",
      availability: t.availability ?? "",
      is_active: t.is_active,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
      const payload = {
        clinic_id: id,
        full_name: form.full_name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        specialty: form.specialty || null,
        qualification: form.qualification || null,
        availability: form.availability || null,
        is_active: form.is_active,
      };
      if (editing) {
        const { error } = await supabase.from("therapists").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("therapists").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Therapist updated" : "Therapist added");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["therapists", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Therapists"
        description="Specialists available for session booking."
        actions={
          <Button onClick={openNew}>
            <Plus className="size-4" />
            Add therapist
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No therapists configured"
          description="Add at least one therapist before booking appointments."
          action={
            <Button onClick={openNew}>
              <Plus className="size-4" />
              Add therapist
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Specialty</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Availability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.full_name}</TableCell>
                  <TableCell className="hidden sm:table-cell">{t.specialty ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="block text-sm">{t.phone ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">{t.email ?? ""}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{t.availability ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.is_active ? "active" : "inactive"} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit therapist" : "Add therapist"}</DialogTitle>
            <DialogDescription>Therapists are private to your clinic.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full name *</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Specialty</Label>
                <Input
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  placeholder="Speech, OT, Behaviour…"
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label>Qualification</Label>
                <Input
                  value={form.qualification}
                  onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                  maxLength={120}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  maxLength={20}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  maxLength={255}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Availability</Label>
              <Textarea
                rows={2}
                value={form.availability}
                onChange={(e) => setForm({ ...form, availability: e.target.value })}
                placeholder="Mon–Fri, 10:00 AM – 6:00 PM"
                maxLength={300}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive therapists stay on record but are flagged as unavailable.
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {editing ? "Save changes" : "Add therapist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
