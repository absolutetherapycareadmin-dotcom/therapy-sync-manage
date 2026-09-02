import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarCheck2, HeartPulse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/parent-action")({
  head: () => ({
    meta: [
      { title: "Confirm your therapy appointment — Therapy Care" },
      {
        name: "description",
        content:
          "Confirm, cancel or request a new time for your child's therapy session at the centre.",
      },
      { property: "og:title", content: "Confirm your therapy appointment — Therapy Care" },
      {
        property: "og:description",
        content: "Confirm, cancel or request a new time for your child's therapy session.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ParentActionPage,
});

type Context = {
  ok: boolean;
  reason?: string;
  action?: "confirm" | "cancel" | "reschedule";
  clinic_name?: string;
  child_name?: string;
  parent_name?: string;
  therapist_name?: string;
  appointment_date?: string;
  start_time?: string;
  specialty?: string;
};

const HEADLINE: Record<string, string> = {
  confirm: "Confirm this appointment",
  cancel: "Request a cancellation",
  reschedule: "Request a different time",
};

function ParentActionPage() {
  const [token, setToken] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) {
      setContext({ ok: false, reason: "This link is not valid." });
      return;
    }
    void fetch(`/api/public/parent-action?t=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((data: Context) => setContext(data))
      .catch(() => setContext({ ok: false, reason: "This link could not be checked." }));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/parent-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          new_date: newDate || null,
          new_time: newTime || null,
          reason: reason.trim().slice(0, 500) || null,
        }),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string; action?: string };
      if (!data.ok) {
        setError(data.reason ?? "This action could not be saved.");
        return;
      }
      setDone(
        data.action === "confirm"
          ? "Thank you — your appointment is confirmed. The centre and the therapist have been notified."
          : "Thank you — your request has been sent to the centre. They will review it and confirm shortly.",
      );
    } catch {
      setError("This action could not be saved. Please contact the centre.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HeartPulse className="size-5" />
        </span>
        <span className="text-sm font-semibold">{context?.clinic_name ?? "Therapy Care"}</span>
      </div>

      {!context ? (
        <p className="text-sm text-muted-foreground">Checking your link…</p>
      ) : done ? (
        <div className="rounded-xl border bg-card p-5">
          <CalendarCheck2 className="mb-3 size-6 text-primary" />
          <h1 className="text-lg font-semibold">All done</h1>
          <p className="mt-2 text-sm text-muted-foreground">{done}</p>
        </div>
      ) : !context.ok ? (
        <div className="rounded-xl border bg-card p-5">
          <h1 className="text-lg font-semibold">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{context.reason}</p>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h1 className="text-lg font-semibold">{HEADLINE[context.action ?? "confirm"]}</h1>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Child</dt>
              <dd className="font-medium">{context.child_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-medium">{context.appointment_date}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-medium">{context.start_time?.slice(0, 5)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Therapist</dt>
              <dd className="font-medium">{context.therapist_name ?? "To be assigned"}</dd>
            </div>
          </dl>

          {context.action === "reschedule" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Preferred date *</Label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Preferred time *</Label>
                <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </div>
            </div>
          ) : null}

          {context.action !== "confirm" ? (
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          ) : null}

          {context.action !== "confirm" ? (
            <p className="text-xs text-muted-foreground">
              The centre reviews this request before anything changes.
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button
            className="w-full"
            disabled={busy || (context.action === "reschedule" && (!newDate || !newTime))}
            onClick={() => void submit()}
          >
            {context.action === "confirm" ? "Confirm appointment" : "Send request"}
          </Button>
        </div>
      )}
    </main>
  );
}
