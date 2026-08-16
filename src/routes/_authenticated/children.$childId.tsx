import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ClipboardCheck, IndianRupee } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  appointmentsQuery,
  attendanceQuery,
  childrenQuery,
  paymentsQuery,
  therapistsQuery,
} from "@/lib/queries";
import { calcAge, formatCurrency, formatDate, formatTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/children/$childId")({
  head: () => ({
    meta: [
      { title: "Child profile — Therapy Care" },
      { name: "description", content: "Child profile, sessions, attendance and payments." },
      { property: "og:title", content: "Child profile — Therapy Care" },
      { property: "og:description", content: "Child profile, sessions, attendance and payments." },
    ],
  }),
  component: ChildProfile,
});

function ChildProfile() {
  const { childId } = Route.useParams();
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;

  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const appointments = useQuery({ ...appointmentsQuery(id), enabled: !!id });
  const attendance = useQuery({ ...attendanceQuery(id), enabled: !!id });
  const payments = useQuery({ ...paymentsQuery(id), enabled: !!id });
  const therapists = useQuery({ ...therapistsQuery(id), enabled: !!id });

  const child = children.data?.find((c) => c.id === childId);
  const childAppointments = (appointments.data ?? []).filter((a) => a.child_id === childId);
  const childAttendance = (attendance.data ?? []).filter((a) => a.child_id === childId);
  const childPayments = (payments.data ?? []).filter((p) => p.child_id === childId);
  const currency = clinic?.currency ?? "INR";

  if (children.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!child) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Child not found"
        description="This record does not exist in your clinic."
        action={
          <Button asChild variant="outline">
            <Link to="/children">Back to children</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/children">
          <ArrowLeft className="size-4" />
          Children
        </Link>
      </Button>

      <PageHeader
        title={child.full_name}
        description={[
          calcAge(child.date_of_birth) ? `${calcAge(child.date_of_birth)} yrs` : null,
          child.therapy_track,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Date of birth" value={formatDate(child.date_of_birth)} />
            <Row label="Gender" value={child.gender ?? "—"} />
            <Row label="Status" value={child.status} />
            <Row label="Guardian" value={child.parent_name ?? "—"} />
            <Row label="Phone" value={child.parent_phone ?? "—"} />
            <Row label="Email" value={child.parent_email ?? "—"} />
            <Row label="Address" value={child.address ?? "—"} />
            <Row label="Notes" value={child.notes ?? "—"} />
          </dl>
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] lg:col-span-2">
          <h2 className="text-sm font-semibold">Appointment history</h2>
          {childAppointments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No sessions yet"
              description="Sessions booked for this child will appear here."
            />
          ) : (
            <ul className="mt-2 divide-y">
              {childAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {formatDate(a.appointment_date)} · {formatTime(a.start_time)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.specialty ?? "Session"} ·{" "}
                      {therapists.data?.find((t) => t.id === a.therapist_id)?.full_name ??
                        "Unassigned"}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Attendance</h2>
          {childAttendance.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No attendance records"
              description="Attendance is recorded from the Attendance module."
            />
          ) : (
            <ul className="mt-2 divide-y">
              {childAttendance.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{formatDate(a.attendance_date)}</span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] lg:col-span-2">
          <h2 className="text-sm font-semibold">Payments</h2>
          {childPayments.length === 0 ? (
            <EmptyState
              icon={IndianRupee}
              title="No payments recorded"
              description="Payments recorded for this child will appear here."
            />
          ) : (
            <ul className="mt-2 divide-y">
              {childPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{formatDate(p.payment_date)}</span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(p.amount, currency)}
                  </span>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
