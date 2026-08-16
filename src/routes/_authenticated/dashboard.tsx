import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  XCircle,
  IndianRupee,
  Wallet,
  Baby,
  UserRound,
  MessageCircle,
  Plus,
  CalendarPlus,
  DoorOpen,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  appointmentsQuery,
  childrenQuery,
  paymentsQuery,
  therapistsQuery,
  whatsappQuery,
} from "@/lib/queries";
import { formatCurrency, formatTime, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Therapy Care" },
      { name: "description", content: "Live operational overview of your therapy centre." },
      { property: "og:title", content: "Dashboard — Therapy Care" },
      { property: "og:description", content: "Live operational overview of your therapy centre." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { clinicId, clinic, profile } = useAuth();
  const id = clinicId as string;

  const appointments = useQuery({ ...appointmentsQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const therapists = useQuery({ ...therapistsQuery(id), enabled: !!id });
  const payments = useQuery({ ...paymentsQuery(id), enabled: !!id });
  const messages = useQuery({ ...whatsappQuery(id), enabled: !!id });

  const today = todayISO();
  const appts = appointments.data ?? [];
  const todays = appts
    .filter((a) => a.appointment_date === today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const pays = payments.data ?? [];
  const currency = clinic?.currency ?? "INR";

  const collectedToday = pays
    .filter((p) => p.status === "paid" && p.payment_date === today)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingAmount = pays
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const upcoming = appts
    .filter((a) => a.appointment_date >= today && a.status === "scheduled")
    .sort((a, b) =>
      `${a.appointment_date}${a.start_time}`.localeCompare(`${b.appointment_date}${b.start_time}`),
    )
    .slice(0, 6);

  const childName = (childId: string) =>
    children.data?.find((c) => c.id === childId)?.full_name ?? "Child";
  const therapistName = (tid: string | null) =>
    tid ? (therapists.data?.find((t) => t.id === tid)?.full_name ?? "—") : "Unassigned";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Everything below is calculated live from your clinic records."
        actions={
          <Button asChild>
            <Link to="/appointments">
              <CalendarPlus className="size-4" />
              Book appointment
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard
          label="Today's appointments"
          value={todays.length}
          icon={CalendarDays}
          tone="info"
        />
        <StatCard
          label="Completed"
          value={appts.filter((a) => a.status === "completed").length}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Pending"
          value={appts.filter((a) => a.status === "pending").length}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Cancelled"
          value={appts.filter((a) => a.status === "cancelled").length}
          icon={XCircle}
          tone="destructive"
        />
        <StatCard
          label="Collected today"
          value={formatCurrency(collectedToday, currency)}
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Pending payments"
          value={formatCurrency(pendingAmount, currency)}
          icon={Wallet}
          tone="warning"
        />
        <StatCard label="Children" value={children.data?.length ?? 0} icon={Baby} />
        <StatCard label="Therapists" value={therapists.data?.length ?? 0} icon={UserRound} />
        <StatCard
          label="WhatsApp messages"
          value={messages.data?.length ?? 0}
          icon={MessageCircle}
        />
        <StatCard label="Total appointments" value={appts.length} icon={CalendarDays} />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Quick actions</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction to="/children" icon={Plus} label="New child" />
          <QuickAction to="/appointments" icon={CalendarPlus} label="Book appointment" />
          <QuickAction to="/therapists" icon={UserRound} label="Add therapist" />
          <QuickAction to="/rooms" icon={DoorOpen} label="Add room / cabin" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Today's schedule</h2>
            <Link to="/appointments" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {todays.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No appointments today"
              description="Once you book sessions for today, they will appear here in time order."
            />
          ) : (
            <ul className="divide-y">
              {todays.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{childName(a.child_id)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatTime(a.start_time)} · {therapistName(a.therapist_id)}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Upcoming appointments</h2>
            <Link to="/appointments" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Nothing scheduled yet"
              description="Book a session to see your upcoming clinic schedule here."
            />
          ) : (
            <ul className="divide-y">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{childName(a.child_id)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.appointment_date} · {formatTime(a.start_time)}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Plus;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm font-medium shadow-[var(--shadow-card)] transition-colors hover:bg-accent"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon className="size-4" />
      </span>
      {label}
    </Link>
  );
}
