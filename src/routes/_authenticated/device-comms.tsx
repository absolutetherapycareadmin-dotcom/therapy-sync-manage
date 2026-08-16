import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MessageSquare, PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { callQueueQuery, smsQueueQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import {
  deviceCapabilities,
  placeQueuedCall,
  processDueCallQueue,
  processDueSmsQueue,
  requestCallPermission,
  requestSmsPermission,
  sendQueuedSms,
  type CallQueueRow,
  type DeviceCapabilities,
  type SmsQueueRow,
} from "@/lib/deviceComms";

export const Route = createFileRoute("/_authenticated/device-comms")({
  head: () => ({
    meta: [
      { title: "Device SMS & Calls — Therapy Care" },
      {
        name: "description",
        content:
          "Send appointment SMS and reminder calls from the centre's own Android device and SIM, with full delivery logs.",
      },
      { property: "og:title", content: "Device SMS & Calls — Therapy Care" },
      {
        property: "og:description",
        content: "Centre-device SMS and cellular reminder calls with queue and failure logs.",
      },
    ],
  }),
  component: DeviceCommsPage,
});

function DeviceCommsPage() {
  const { clinic, clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();

  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  const refreshCaps = () => void deviceCapabilities().then(setCaps);
  useEffect(() => {
    void deviceCapabilities().then(setCaps);
  }, []);

  const sms = useQuery({ ...smsQueueQuery(id), enabled: !!id });
  const calls = useQuery({ ...callQueueQuery(id), enabled: !!id });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["sms_queue", id] });
    void qc.invalidateQueries({ queryKey: ["call_queue", id] });
  };

  const runSms = useMutation({
    mutationFn: () => processDueSmsQueue(id),
    onSuccess: (r) => {
      invalidate();
      if (r.processed === 0) toast.info("No SMS is due right now");
      else if (r.failed > 0) toast.error(`${r.sent} sent, ${r.failed} failed: ${r.errors[0] ?? ""}`);
      else toast.success(`${r.sent} SMS sent from the centre device`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runCalls = useMutation({
    mutationFn: () => processDueCallQueue(id),
    onSuccess: (r) => {
      invalidate();
      if (r.processed === 0) toast.info("No reminder call is due right now");
      else if (r.failed > 0) toast.error(`${r.sent} placed, ${r.failed} failed: ${r.errors[0] ?? ""}`);
      else toast.success(`${r.sent} reminder call placed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendOne = useMutation({
    mutationFn: (row: SmsQueueRow) => sendQueuedSms(row),
    onSuccess: () => {
      invalidate();
      toast.success("SMS handed to the device");
    },
    onError: (e: Error) => {
      invalidate();
      toast.error(e.message);
    },
  });

  const callOne = useMutation({
    mutationFn: (row: CallQueueRow) => placeQueuedCall(row),
    onSuccess: () => {
      invalidate();
      toast.success("Call handed to the device dialler");
    },
    onError: (e: Error) => {
      invalidate();
      toast.error(e.message);
    },
  });

  const smsRows = sms.data ?? [];
  const callRows = calls.data ?? [];
  const devicePhone = clinic?.device_phone ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device SMS & Calls"
        description="Normal SMS and normal cellular calls sent from the centre's own registered Android device and its active SIM."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => runCalls.mutate()} disabled={runCalls.isPending}>
              <PhoneCall className="size-4" />
              Run due calls
            </Button>
            <Button onClick={() => runSms.mutate()} disabled={runSms.isPending}>
              <MessageSquare className="size-4" />
              Run due SMS
            </Button>
          </div>
        }
      />

      <section className="rounded-xl border bg-card p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium">Centre communication device</p>
            <p className="text-muted-foreground">
              {devicePhone
                ? `Registered device number: ${devicePhone}${clinic?.device_label ? ` (${clinic.device_label})` : ""}`
                : "No device number configured yet — add it in Settings."}
            </p>
            <p className="text-muted-foreground">
              {caps === null
                ? "Checking device capability…"
                : caps.native
                  ? `Android device · SMS permission: ${caps.smsGranted ? "granted" : "not granted"} · Call permission: ${caps.callGranted ? "granted" : "not granted"} · SIM/telephony: ${caps.telephony ? "available" : "unavailable"}`
                  : (caps.reason ?? "")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={refreshCaps}>
              <RefreshCw className="size-4" />
              Recheck
            </Button>
            {caps?.native && !caps.smsGranted ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void requestSmsPermission().then(refreshCaps).catch((e: Error) => toast.error(e.message))}
              >
                Allow SMS
              </Button>
            ) : null}
            {caps?.native && !caps.callGranted ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void requestCallPermission().then(refreshCaps).catch((e: Error) => toast.error(e.message))}
              >
                Allow calls
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">SMS queue &amp; log</h2>
        {sms.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : smsRows.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No SMS queued"
            description="Booking an appointment queues a confirmation SMS and a reminder before the session."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="hidden lg:table-cell">Scheduled</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {smsRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium tabular-nums">
                      {row.recipient_phone}
                      <span className="block text-xs capitalize text-muted-foreground">{row.recipient_role}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell capitalize">
                      {row.message_type.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate text-muted-foreground">{row.message}</TableCell>
                    <TableCell className="hidden lg:table-cell">{formatDate(row.scheduled_for)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={row.status} />
                        {row.last_error ? (
                          <span className="text-xs text-destructive">{row.last_error}</span>
                        ) : null}
                        {row.status === "queued" || row.status === "failed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={sendOne.isPending}
                            onClick={() => sendOne.mutate(row)}
                          >
                            Send now
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
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Reminder call queue &amp; log</h2>
        {calls.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : callRows.length === 0 ? (
          <EmptyState
            icon={PhoneCall}
            title="No calls queued"
            description="A reminder call is queued automatically before each upcoming appointment."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Scheduled</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium tabular-nums">
                      {row.recipient_phone}
                      <span className="block text-xs capitalize text-muted-foreground">{row.recipient_role}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell capitalize">
                      {row.call_type.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{formatDate(row.scheduled_for)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={row.status} />
                        {row.last_error ? (
                          <span className="text-xs text-destructive">{row.last_error}</span>
                        ) : null}
                        {row.status === "queued" || row.status === "failed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={callOne.isPending}
                            onClick={() => callOne.mutate(row)}
                          >
                            Call now
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
      </section>
    </div>
  );
}
