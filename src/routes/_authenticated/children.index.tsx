import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Baby, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { childrenQuery, type Child } from "@/lib/queries";
import { calcAge } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/children/")({
  head: () => ({
    meta: [
      { title: "Children — Therapy Care" },
      { name: "description", content: "Manage the children registered at your therapy centre." },
      { property: "og:title", content: "Children — Therapy Care" },
      { property: "og:description", content: "Manage child records, guardians and therapy tracks." },
    ],
  }),
  component: ChildrenPage,
});

const schema = z.object({
  full_name: z.string().trim().min(2, "Child name is required").max(120),
  parent_name: z.string().trim().max(120).optional(),
  parent_phone: z.string().trim().max(20).optional(),
  parent_email: z.string().trim().max(255).optional(),
});

const emptyForm = {
  full_name: "",
  date_of_birth: "",
  gender: "",
  parent_name: "",
  parent_phone: "",
  parent_email: "",
  address: "",
  therapy_track: "",
  diagnosis: "",
  notes: "",
  status: "active",
};

function ChildrenPage() {
  const { clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ ...childrenQuery(id), enabled: !!id });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Child | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (child: Child) => {
    setEditing(child);
    setForm({
      full_name: child.full_name ?? "",
      date_of_birth: child.date_of_birth ?? "",
      gender: child.gender ?? "",
      parent_name: child.parent_name ?? "",
      parent_phone: child.parent_phone ?? "",
      parent_email: child.parent_email ?? "",
      address: child.address ?? "",
      therapy_track: child.therapy_track ?? "",
      diagnosis: child.diagnosis ?? "",
      notes: child.notes ?? "",
      status: child.status ?? "active",
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
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        parent_name: form.parent_name || null,
        parent_phone: form.parent_phone || null,
        parent_email: form.parent_email || null,
        address: form.address || null,
        therapy_track: form.therapy_track || null,
        diagnosis: form.diagnosis || null,
        notes: form.notes || null,
        status: form.status || "active",
      };
      if (editing) {
        const { error } = await supabase.from("children").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("children").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Child updated" : "Child added");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["children", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (data ?? []).filter((c) =>
    c.full_name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Children"
        description="Every child registered at this clinic."
        actions={
          <Button onClick={openNew}>
            <Plus className="size-4" />
            Add child
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search children"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Baby}
          title={data?.length ? "No matching children" : "No children yet"}
          description={
            data?.length
              ? "Try a different search term."
              : "Add your first child record to start booking sessions and tracking progress."
          }
          action={
            <Button onClick={openNew}>
              <Plus className="size-4" />
              Add child
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Age</TableHead>
                <TableHead className="hidden md:table-cell">Therapy track</TableHead>
                <TableHead className="hidden lg:table-cell">Guardian</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((child) => (
                <TableRow key={child.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/children/$childId"
                      params={{ childId: child.id }}
                      className="hover:underline"
                    >
                      {child.full_name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {calcAge(child.date_of_birth) ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {child.therapy_track ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="block text-sm">{child.parent_name ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {child.parent_phone ?? ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={child.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(child)}>
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
            <DialogTitle>{editing ? "Edit child" : "Add child"}</DialogTitle>
            <DialogDescription>
              Child records are private to your clinic in Therapy Care.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Child name *">
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                maxLength={120}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of birth">
                <Input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                />
              </Field>
              <Field label="Gender">
                <Input
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  maxLength={30}
                />
              </Field>
            </div>
            <Field label="Therapy track / specialty">
              <Input
                value={form.therapy_track}
                onChange={(e) => setForm({ ...form, therapy_track: e.target.value })}
                placeholder="Speech, OT, Behaviour…"
                maxLength={80}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Parent / guardian">
                <Input
                  value={form.parent_name}
                  onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label="Contact number">
                <Input
                  value={form.parent_phone}
                  onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                  maxLength={20}
                />
              </Field>
            </div>
            <Field label="Parent email">
              <Input
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                maxLength={255}
              />
            </Field>
            <Field label="Address">
              <Textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label="Diagnosis / notes">
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={1000}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {editing ? "Save changes" : "Add child"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
