import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { packagesQuery } from "@/lib/queries";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/packages")({
  head: () => ({
    meta: [
      { title: "Packages — Therapy Care" },
      { name: "description", content: "Create and manage therapy session packages and pricing." },
      { property: "og:title", content: "Packages — Therapy Care" },
      { property: "og:description", content: "Manage therapy session packages and pricing." },
    ],
  }),
  component: PackagesPage,
});

function PackagesPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const currency = clinic?.currency ?? "INR";
  const packages = useQuery({ ...packagesQuery(id), enabled: !!id });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    specialty: "",
    total_sessions: "10",
    price: "",
    validity_days: "90",
    is_active: true,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Package name is required");
      if (form.price === "" || Number(form.price) < 0) throw new Error("Enter a valid price");
      const { error } = await supabase.from("packages").insert({
        clinic_id: id,
        name: form.name.trim(),
        specialty: form.specialty.trim() || null,
        total_sessions: Number(form.total_sessions) || 1,
        price: Number(form.price),
        validity_days: form.validity_days === "" ? null : Number(form.validity_days),
        is_active: form.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Package created");
      setOpen(false);
      setForm({
        name: "",
        specialty: "",
        total_sessions: "10",
        price: "",
        validity_days: "90",
        is_active: true,
      });
      void qc.invalidateQueries({ queryKey: ["packages", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ packageId, active }: { packageId: string; active: boolean }) => {
      const { error } = await supabase
        .from("packages")
        .update({ is_active: active })
        .eq("id", packageId);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["packages", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packages"
        description="Session bundles families can purchase."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New package
          </Button>
        }
      />

      {packages.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (packages.data ?? []).length === 0 ? (
        <EmptyState
          icon={Package}
          title="No packages yet"
          description="Create session packages to bill families for bundles of therapy sessions."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New package
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead className="hidden sm:table-cell">Specialty</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="hidden md:table-cell">Validity</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(packages.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="hidden sm:table-cell">{p.specialty ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{p.total_sessions}</TableCell>
                  <TableCell className="tabular-nums">{formatCurrency(p.price, currency)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.validity_days ? `${p.validity_days} days` : "No expiry"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={p.is_active}
                      onCheckedChange={(v) => toggle.mutate({ packageId: p.id, active: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New package</DialogTitle>
            <DialogDescription>Define sessions, pricing and validity.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                maxLength={100}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Speech therapy — 10 sessions"
              />
            </div>
            <div className="space-y-2">
              <Label>Specialty</Label>
              <Input
                value={form.specialty}
                maxLength={80}
                onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Total sessions</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.total_sessions}
                  onChange={(e) => setForm({ ...form, total_sessions: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Price *</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Validity (days)</Label>
              <Input
                type="number"
                min={0}
                value={form.validity_days}
                onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              Create package
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
