import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, IndianRupee, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { useAuth } from "@/lib/auth";
import { appointmentsQuery, childrenQuery, paymentsQuery, therapistsQuery } from "@/lib/queries";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Therapy Care" },
      { name: "description", content: "Sessions, attendance and revenue insights for your clinic." },
      { property: "og:title", content: "Reports — Therapy Care" },
      { property: "og:description", content: "Sessions, attendance and revenue insights." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const currency = clinic?.currency ?? "INR";

  const appointments = useQuery({ ...appointmentsQuery(id), enabled: !!id });
  const payments = useQuery({ ...paymentsQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const therapists = useQuery({ ...therapistsQuery(id), enabled: !!id });

  const appts = appointments.data ?? [];
  const pays = payments.data ?? [];
  const completed = appts.filter((a) => a.status === "completed").length;
  const cancelled = appts.filter((a) => a.status === "cancelled" || a.status === "no_show").length;
  const revenue = pays
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const attendanceRate = appts.length ? Math.round((completed / appts.length) * 100) : 0;

  const bySpecialty = new Map<string, number>();
  appts.forEach((a) => {
    const key = a.specialty?.trim() || "Unspecified";
    bySpecialty.set(key, (bySpecialty.get(key) ?? 0) + 1);
  });
  const specialtyRows = [...bySpecialty.entries()].sort((a, b) => b[1] - a[1]);

  const byTherapist = new Map<string, number>();
  appts.forEach((a) => {
    const name = a.therapist_id
      ? (therapists.data?.find((t) => t.id === a.therapist_id)?.full_name ?? "Unknown")
      : "Unassigned";
    byTherapist.set(name, (byTherapist.get(name) ?? 0) + 1);
  });
  const therapistRows = [...byTherapist.entries()].sort((a, b) => b[1] - a[1]);

  const isEmpty = appts.length === 0 && pays.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Live insights calculated from your clinic data." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total sessions" value={String(appts.length)} icon={CalendarDays} />
        <StatCard label="Completion rate" value={`${attendanceRate}%`} icon={BarChart3} />
        <StatCard label="Revenue collected" value={formatCurrency(revenue, currency)} icon={IndianRupee} />
        <StatCard label="Active children" value={String((children.data ?? []).length)} icon={Users} />
      </div>

      {isEmpty ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <BarChart3 className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No data to report yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reports populate automatically as you book sessions and record payments.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold">Sessions by specialty</h2>
            <ul className="mt-4 space-y-3">
              {specialtyRows.map(([name, count]) => (
                <li key={name} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{name}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.round((count / appts.length) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold">Sessions by therapist</h2>
            <ul className="mt-4 space-y-3">
              {therapistRows.map(([name, count]) => (
                <li key={name} className="flex justify-between text-sm">
                  <span>{name}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold">Session outcomes</h2>
            <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="text-lg font-semibold tabular-nums">{completed}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd className="text-lg font-semibold tabular-nums">{cancelled}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Upcoming</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {appts.length - completed - cancelled}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold">Collections</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="tabular-nums">{formatCurrency(revenue, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="tabular-nums">
                  {formatCurrency(
                    pays
                      .filter((p) => p.status !== "paid" && p.status !== "refunded")
                      .reduce((sum, p) => sum + Number(p.amount), 0),
                    currency,
                  )}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
