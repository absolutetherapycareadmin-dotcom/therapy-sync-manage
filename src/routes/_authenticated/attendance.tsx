import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
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
import { appointmentsQuery, attendanceQuery, childrenQuery } from "@/lib/queries";
import { formatTime, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Therapy Care" },
      { name: "description", content: "Mark session attendance for scheduled therapy sessions." },
      { property: "og:title", content: "Attendance — Therapy Care" },
      { property: "og:description", content: "Mark session attendance for therapy sessions." },
    ],
  }),
  component: AttendancePage,
});

function AttendancePage() {
  const { clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());

  const appointments = useQuery({ ...appointmentsQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const attendance = useQuery({ ...attendanceQuery(id), enabled: !!id });

  const dayAppointments = (appointments.data ?? [])
    .filter((a) => a.appointment_date === date)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const attendanceFor = (appointmentId: string) =>
    (attendance.data ?? []).find((r) => r.appointment_id === appointmentId);

  const mark = useMutation({
    mutationFn: async ({
      appointmentId,
      childId,
      status,
    }: {
      appointmentId: string;
      childId: string;
      status: string;
    }) => {
      const existing = attendanceFor(appointmentId);
      if (existing) {
        const { error } = await supabase
          .from("attendance")
          .update({ status, check_in_at: status === "completed" ? new Date().toISOString() : null })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("attendance").insert({
          clinic_id: id,
          appointment_id: appointmentId,
          child_id: childId,
          attendance_date: date,
          status,
          check_in_at: status === "completed" ? new Date().toISOString() : null,
        });
        if (error) throw error;
      }
      const { error: apptError } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", appointmentId);
      if (apptError) throw apptError;
    },
    onSuccess: () => {
      toast.success("Attendance saved");
      void qc.invalidateQueries({ queryKey: ["attendance", id] });
      void qc.invalidateQueries({ queryKey: ["appointments", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const childName = (cid: string) =>
    children.data?.find((c) => c.id === cid)?.full_name ?? "Unknown child";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Mark attendance against scheduled sessions."
        actions={
          <Input
            type="date"
            className="w-[180px]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        }
      />

      {appointments.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : dayAppointments.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No sessions on this date"
          description="Attendance is generated from booked appointments. Pick another date or book a session."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Child</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Mark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayAppointments.map((a) => {
                const record = attendanceFor(a.id);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{childName(a.child_id)}</TableCell>
                    <TableCell>{formatTime(a.start_time)}</TableCell>
                    <TableCell>
                      <StatusBadge status={record?.status ?? a.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {["completed", "pending", "cancelled"].map((status) => (
                          <Button
                            key={status}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              mark.mutate({ appointmentId: a.id, childId: a.child_id, status })
                            }
                          >
                            {status === "completed"
                              ? "Present"
                              : status === "pending"
                                ? "Pending"
                                : "Absent"}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
