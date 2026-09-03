import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Inbox } from "lucide-react";
import { toast } from "sonner";

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
import { childrenQuery } from "@/lib/queries";
import { formatDate, formatTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({
    meta: [
      { title: "Request Centre — Therapy Care" },
      {
        name: "description",
        content: "Review parent confirmations, cancellations and schedule-change requests.",
      },
      { property: "og:title", content: "Request Centre — Therapy Care" },
      {
        property: "og:description",
        content: "Review parent confirmations, cancellations and schedule-change requests.",
      },
    ],
  }),
  component: RequestsPage,
});

type RequestRow = {
  id: string;
  appointment_id: string;
  child_id: string | null;
  request_type: string;
  requested_by: string;
  requested_date: string | null;
  requested_time: string | null;
  reason: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function RequestsPage() {
  const { clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });

  const [active, setActive] = useState<RequestRow | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [note, setNote] = useState("");

  const requests = useQuery({
    queryKey: ["appointment-requests", id],
    enabled: !!id,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_requests")
        .select(
          "id,appointment_id,child_id,request_type,requested_by,requested_date,requested_time,reason,status,admin_note,created_at",
        )
        .eq("clinic_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RequestRow[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ decision }: { decision: "approved" | "rejected" }) => {
      if (!active) throw new Error("No request selected");
      const { data, error } = await callRpc("decide_appointment_request", {
        p_request_id: active.id,
        p_decision: decision,
        p_new_date: newDate || null,
        p_new_time: newTime || null,
        p_note: note.trim() || null,
      });
      if (error) throw new Error(error.message);
      const result = data as { ok?: boolean; reason?: string } | null;
      if (result?.ok === false) throw new Error(result.reason ?? "Request could not be decided");
      return decision;
    },
    onSuccess: (decision) => {
      toast.success(decision === "approved" ? "Request approved" : "Request rejected");
      setActive(null);
      setNewDate("");
      setNewTime("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["appointment-requests", id] });
      void qc.invalidateQueries({ queryKey: ["appointments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const childName = (cid: string | null) =>
    (cid ? children.data?.find((c) => c.id === cid)?.full_name : null) ?? "Unknown child";
  const label = (type: string) => type.replaceAll("_", " ");

  const rows = requests.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");

  const openReview = (row: RequestRow) => {
    setActive(row);
    setNewDate(row.requested_date ?? "");
    setNewTime(row.requested_time?.slice(0, 5) ?? "");
    setNote("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Centre"
        description="Parent confirmations, cancellations and schedule-change requests. Nothing changes in the calendar until you approve it."
      />

      <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">{pending.length}</strong> request(s) awaiting your
        review.
      </div>

      {requests.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No parent requests yet"
          description="When a parent uses the Confirm, Cancel or Request schedule change link in their WhatsApp message, it appears here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Child</TableHead>
                <TableHead>Request</TableHead>
                <TableHead className="hidden md:table-cell">Preferred slot</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {childName(r.child_id)}
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(r.created_at)} · by {r.requested_by}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{label(r.request_type)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.requested_date
                      ? `${formatDate(r.requested_date)}${r.requested_time ? ` · ${formatTime(r.requested_time)}` : ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate lg:table-cell text-muted-foreground">
                    {r.reason ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "pending" ? (
                      <Button variant="outline" size="sm" onClick={() => openReview(r)}>
                        Review
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.admin_note ?? "Decided"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={active !== null} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">
              Review {active ? label(active.request_type) : ""}
            </DialogTitle>
            <DialogDescription>
              {active?.request_type === "schedule_change"
                ? "Approving moves the appointment to the slot below. You can change it before approving."
                : "Approving a cancellation cancels the appointment. Rejecting keeps it as scheduled."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm">
              <span className="text-muted-foreground">Child: </span>
              {childName(active?.child_id ?? null)}
            </p>
            {active?.reason ? (
              <p className="text-sm text-muted-foreground">Parent note: {active.reason}</p>
            ) : null}

            {active?.request_type === "schedule_change" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>New date</Label>
                  <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>New time</Label>
                  <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Admin note (optional)</Label>
              <Textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "rejected" })}
            >
              Reject
            </Button>
            <Button
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "approved" })}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
