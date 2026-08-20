import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  appointmentsQuery,
  childrenQuery,
  roomsQuery,
  therapistsQuery,
  type Appointment,
} from "@/lib/queries";
import { formatCurrency, formatDate, formatTime, todayISO } from "@/lib/format";
import { runWhatsAppBatch, type BatchRunResult } from "@/lib/whatsappAutomation";
import { isNativeDevice } from "@/lib/deviceComms";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments — Therapy Care" },
      { name: "description", content: "Book, reschedule and manage therapy sessions." },
      { property: "og:title", content: "Appointments — Therapy Care" },
      { property: "og:description", content: "Book, reschedule and manage therapy sessions." },
    ],
  }),
  component: AppointmentsPage,
});

const STATUSES = ["scheduled", "in_progress", "completed", "pending", "cancelled", "no_show"];
const NONE = "__none__";

type FormState = {
  child_id: string;
  therapist_id: string;
  room_id: string;
  specialty: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: string;
  session_fee: string;
  status: string;
  notes: string;
  recurring: boolean;
  recurrence_end: string;
};

const emptyForm = (): FormState => ({
  child_id: "",
  therapist_id: NONE,
  room_id: NONE,
  specialty: "",
  appointment_date: todayISO(),
  start_time: "10:00",
  duration_minutes: "45",
  session_fee: "",
  status: "scheduled",
  notes: "",
  recurring: false,
  recurrence_end: "",
});

function AppointmentsPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const currency = clinic?.currency ?? "INR";

  const appointments = useQuery({ ...appointmentsQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const therapists = useQuery({ ...therapistsQuery(id), enabled: !!id });
  const rooms = useQuery({ ...roomsQuery(id), enabled: !!id });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchRunResult | null>(null);

  const whatsappStatus = useQuery({
    queryKey: ["appointment-whatsapp-status", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_whatsapp_status")
        .select("appointment_id,whatsapp_status,event_status,parent_phone,sent_at,error_message")
        .eq("clinic_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const waByAppointment = useMemo(() => {
    const map = new Map<string, { whatsapp_status: string | null; event_status: string | null }>();
    for (const row of whatsappStatus.data ?? []) {
      if (row.appointment_id) {
        map.set(row.appointment_id, {
          whatsapp_status: row.whatsapp_status,
          event_status: row.event_status,
        });
      }
    }
    return map;
  }, [whatsappStatus.data]);

  const isEligible = (appointmentId: string, status: string) => {
    if (status === "cancelled") return false;
    const wa = waByAppointment.get(appointmentId);
    if (!wa || !wa.whatsapp_status) return false;
    if (wa.whatsapp_status === "sent") return false;
    return ["waiting_whatsapp", "waiting_sms", "waiting_call"].includes(wa.event_status ?? "");
  };

  const runBatch = useMutation({
    mutationFn: async () => {
      if (selected.length === 0) throw new Error("Select at least one appointment");
      return runWhatsAppBatch(selected, (done, total, label) =>
        setBatchProgress(`Sending ${done} of ${total} — ${label}`),
      );
    },
    onSuccess: (result) => {
      setBatchResult(result);
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ["appointment-whatsapp-status", id] });
      void qc.invalidateQueries({ queryKey: ["appointments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBatchProgress(null),
  });


  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (a: Appointment) => {
    setEditing(a);
    setForm({
      child_id: a.child_id,
      therapist_id: a.therapist_id ?? NONE,
      room_id: a.room_id ?? NONE,
      specialty: a.specialty ?? "",
      appointment_date: a.appointment_date,
      start_time: a.start_time.slice(0, 5),
      duration_minutes: String(a.duration_minutes ?? 45),
      session_fee: a.session_fee != null ? String(Number(a.session_fee)) : "",
      status: a.status,
      notes: a.notes ?? "",
      recurring: false,
      recurrence_end: "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.child_id) throw new Error("Select a child");
      if (!form.appointment_date) throw new Error("Select a date");
      if (!form.start_time) throw new Error("Select a time");

      const base = {
        clinic_id: id,
        child_id: form.child_id,
        therapist_id: form.therapist_id === NONE ? null : form.therapist_id,
        room_id: form.room_id === NONE ? null : form.room_id,
        specialty: form.specialty || null,
        start_time: form.start_time,
        duration_minutes: Number(form.duration_minutes) || 45,
        session_fee: form.session_fee === "" ? null : Number(form.session_fee),
        status: form.status,
        notes: form.notes || null,
      };

      if (editing) {
        const { error } = await supabase
          .from("appointments")
          .update({ ...base, appointment_date: form.appointment_date })
          .eq("id", editing.id);
        if (error) throw error;
        return { count: 1 };
      }

      if (form.recurring) {
        if (!form.recurrence_end) throw new Error("Select an end date for the recurring sessions");
        if (form.recurrence_end < form.appointment_date)
          throw new Error("End date cannot be before the start date");

        const groupId = crypto.randomUUID();
        const rows: Array<typeof base & { appointment_date: string; recurrence_group_id: string }> =
          [];
        const cursor = new Date(`${form.appointment_date}T00:00:00`);
        const end = new Date(`${form.recurrence_end}T00:00:00`);
        while (cursor <= end && rows.length < 200) {
          rows.push({
            ...base,
            appointment_date: cursor.toISOString().slice(0, 10),
            recurrence_group_id: groupId,
          });
          cursor.setDate(cursor.getDate() + 7);
        }
        const { error } = await supabase.from("appointments").insert(rows);
        if (error) throw error;
        return { count: rows.length };
      }

      const { error } = await supabase
        .from("appointments")
        .insert({ ...base, appointment_date: form.appointment_date });
      if (error) throw error;
      return { count: 1 };
    },
    onSuccess: (result) => {
      toast.success(
        editing
          ? "Appointment updated"
          : result.count > 1
            ? `${result.count} sessions booked`
            : "Appointment booked",
      );
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["appointments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ appointmentId, status }: { appointmentId: string; status: string }) => {
      const { error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", appointmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["appointments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noChildren = (children.data ?? []).length === 0;
  const noTherapists = (therapists.data ?? []).length === 0;

  const rows = (appointments.data ?? []).filter((a) => filter === "all" || a.status === filter);
  const childName = (cid: string) =>
    children.data?.find((c) => c.id === cid)?.full_name ?? "Unknown child";
  const therapistName = (tid: string | null) =>
    tid ? (therapists.data?.find((t) => t.id === tid)?.full_name ?? "—") : "Unassigned";
  const roomName = (rid: string | null) =>
    rid ? (rooms.data?.find((r) => r.id === rid)?.name ?? "—") : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="All therapy sessions for your clinic."
        actions={
          <Button onClick={openNew} disabled={noChildren}>
            <CalendarPlus className="size-4" />
            Book appointment
          </Button>
        }
      />

      {noChildren || noTherapists ? (
        <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
          {noChildren ? "Add at least one child before booking sessions. " : ""}
          {noTherapists
            ? "No therapist is configured yet — add a therapist so sessions can be assigned."
            : ""}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={() => setSelected(eligibleRowIds)}
          disabled={eligibleRowIds.length === 0 || runBatch.isPending}
        >
          Select all eligible ({eligibleRowIds.length})
        </Button>
        {selected.length > 0 ? (
          <Button variant="ghost" onClick={() => setSelected([])} disabled={runBatch.isPending}>
            Clear selection
          </Button>
        ) : null}
        <Button
          onClick={() => runBatch.mutate()}
          disabled={selected.length === 0 || runBatch.isPending}
        >
          <MessageCircle className="size-4" />
          WhatsApp ({selected.length})
        </Button>
        {batchProgress ? (
          <span className="text-sm text-muted-foreground">{batchProgress}</span>
        ) : null}
        {!isNativeDevice() ? (
          <span className="text-xs text-muted-foreground">
            Run the batch from the Therapy Care Android app — automation uses the centre device's
            normal WhatsApp.
          </span>
        ) : null}
      </div>

      {appointments.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={appointments.data?.length ? "No matching appointments" : "No appointments yet"}
          description={
            appointments.data?.length
              ? "Try a different status filter."
              : "Book your first session — children, therapists and rooms all come from your own records."
          }
          action={
            !noChildren ? (
              <Button onClick={openNew}>
                <CalendarPlus className="size-4" />
                Book appointment
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
                <TableHead>Date & time</TableHead>
                <TableHead className="hidden md:table-cell">Therapist</TableHead>
                <TableHead className="hidden lg:table-cell">Room</TableHead>
                <TableHead className="hidden sm:table-cell">Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{childName(a.child_id)}</TableCell>
                  <TableCell>
                    <span className="block text-sm">{formatDate(a.appointment_date)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatTime(a.start_time)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {therapistName(a.therapist_id)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{roomName(a.room_id)}</TableCell>
                  <TableCell className="hidden sm:table-cell tabular-nums">
                    {a.session_fee != null ? formatCurrency(a.session_fee, currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                        Edit
                      </Button>
                      {a.status !== "completed" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ appointmentId: a.id, status: "completed" })
                          }
                        >
                          Complete
                        </Button>
                      ) : null}
                      {a.status !== "cancelled" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ appointmentId: a.id, status: "cancelled" })
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
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
            <DialogTitle>{editing ? "Edit appointment" : "Book appointment"}</DialogTitle>
            <DialogDescription>
              All options are loaded from your clinic's own records.
            </DialogDescription>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Therapy specialty</Label>
                <Input
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  placeholder="Speech, OT, Behaviour…"
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label>Assigned specialist</Label>
                <Select
                  value={form.therapist_id}
                  onValueChange={(v) => setForm({ ...form, therapist_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select therapist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {(therapists.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {noTherapists ? (
                  <p className="text-xs text-muted-foreground">
                    No therapist configured yet. Add one in the Therapists module.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.appointment_date}
                  onChange={(e) => setForm({ ...form, appointment_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Time *</Label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Room / cabin</Label>
                <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select room" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not assigned</SelectItem>
                    {(rooms.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(rooms.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No rooms configured yet. Add them in Rooms & Cabins.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Session fee</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  placeholder="e.g. 1000"
                  value={form.session_fee}
                  onChange={(e) => setForm({ ...form, session_fee: e.target.value })}
                />
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
                        {s.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!editing ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Repeat weekly</p>
                    <p className="text-xs text-muted-foreground">
                      Creates one session per week between the start and end dates.
                    </p>
                  </div>
                  <Switch
                    checked={form.recurring}
                    onCheckedChange={(v) => setForm({ ...form, recurring: v })}
                  />
                </div>
                {form.recurring ? (
                  <div className="space-y-2">
                    <Label>End date *</Label>
                    <Input
                      type="date"
                      min={form.appointment_date}
                      value={form.recurrence_end}
                      onChange={(e) => setForm({ ...form, recurrence_end: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={1000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {editing ? "Save changes" : "Book appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
