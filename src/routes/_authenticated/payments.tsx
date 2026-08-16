import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { IndianRupee, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { childrenQuery, packagesQuery, paymentsQuery } from "@/lib/queries";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Therapy Care" },
      { name: "description", content: "Record and track therapy payments, dues and collections." },
      { property: "og:title", content: "Payments — Therapy Care" },
      { property: "og:description", content: "Track therapy payments, dues and collections." },
    ],
  }),
  component: PaymentsPage,
});

const NONE = "__none__";
const METHODS = ["cash", "upi", "card", "bank_transfer", "cheque"];
const STATUSES = ["paid", "pending", "partial", "refunded"];

function PaymentsPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const currency = clinic?.currency ?? "INR";

  const payments = useQuery({ ...paymentsQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const packages = useQuery({ ...packagesQuery(id), enabled: !!id });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    child_id: "",
    package_id: NONE,
    amount: "",
    status: "paid",
    method: "cash",
    payment_date: todayISO(),
    notes: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.child_id) throw new Error("Select a child");
      if (form.amount === "" || Number(form.amount) <= 0) throw new Error("Enter a valid amount");
      const { error } = await supabase.from("payments").insert({
        clinic_id: id,
        child_id: form.child_id,
        package_id: form.package_id === NONE ? null : form.package_id,
        amount: Number(form.amount),
        status: form.status,
        method: form.method,
        payment_date: form.payment_date,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setOpen(false);
      setForm({
        child_id: "",
        package_id: NONE,
        amount: "",
        status: "paid",
        method: "cash",
        payment_date: todayISO(),
        notes: "",
      });
      void qc.invalidateQueries({ queryKey: ["payments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = payments.data ?? [];
  const collected = rows
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const pending = rows
    .filter((p) => p.status === "pending" || p.status === "partial")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const childName = (cid: string | null) =>
    cid ? (children.data?.find((c) => c.id === cid)?.full_name ?? "—") : "—";

  const noChildren = (children.data ?? []).length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every transaction recorded for your clinic."
        actions={
          <Button onClick={() => setOpen(true)} disabled={noChildren}>
            <Plus className="size-4" />
            Record payment
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={formatCurrency(collected, currency)} icon={IndianRupee} />
        <StatCard label="Outstanding" value={formatCurrency(pending, currency)} icon={IndianRupee} />
        <StatCard label="Transactions" value={String(rows.length)} icon={IndianRupee} />
      </div>

      {payments.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title="No payments yet"
          description="Record a payment once a family pays for a session or package."
          action={
            !noChildren ? (
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Record payment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Child</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="hidden sm:table-cell">Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{childName(p.child_id)}</TableCell>
                  <TableCell>{formatDate(p.payment_date)}</TableCell>
                  <TableCell className="hidden sm:table-cell capitalize">
                    {(p.method ?? "—").replace("_", " ")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatCurrency(p.amount, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={p.status} />
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
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Link the payment to a child and package.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Child *</Label>
              <Select
                value={form.child_id}
                onValueChange={(v) => setForm({ ...form, child_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a child" />
                </SelectTrigger>
                <SelectContent>
                  {(children.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Package</Label>
              <Select
                value={form.package_id}
                onValueChange={(v) => {
                  const pkg = packages.data?.find((p) => p.id === v);
                  setForm({
                    ...form,
                    package_id: v,
                    amount: pkg ? String(Number(pkg.price)) : form.amount,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No package" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No package</SelectItem>
                  {(packages.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.payment_date}
                  onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                maxLength={500}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              Save payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
