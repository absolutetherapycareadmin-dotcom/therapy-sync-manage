import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function CommunicationEscalationControls() {
  const { clinicId, profile } = useAuth();
  const qc = useQueryClient();
  const id = clinicId as string;
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";

  const escalations = useQuery({
    queryKey: ["communication_escalations", id],
    enabled: !!id && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communication_escalations")
        .select("id,appointment_id,status,current_stage,started_at,sms_scheduled_for,call_scheduled_for,cancel_reason")
        .eq("clinic_id", id)
        .in("status", ["waiting_whatsapp", "waiting_sms", "waiting_call"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const cancel = useMutation({
    mutationFn: async (escalationId: string) => {
      const { data, error } = await supabase.rpc("cancel_communication_escalation", {
        p_escalation_id: escalationId,
        p_reason: "admin_cancelled",
      });
      if (error) throw error;
      if (data !== true) throw new Error("The communication escalation was not active or could not be cancelled");
    },
    onSuccess: () => {
      toast.success("Automatic escalation cancelled");
      void qc.invalidateQueries({ queryKey: ["communication_escalations", id] });
      void qc.invalidateQueries({ queryKey: ["sms_queue", id] });
      void qc.invalidateQueries({ queryKey: ["call_queue", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) return null;

  const rows = escalations.data ?? [];
  return (
    <section className="rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">Pending automatic escalations</h2>
        <p className="mt-1 text-sm text-muted-foreground">Centre Admin can stop an individual escalation before its next automatic SMS or call. Historical records are retained.</p>
      </div>
      {escalations.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No pending automatic escalations.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="space-y-1">
                <p className="font-medium">Appointment {row.appointment_id}</p>
                <div className="flex items-center gap-2"><StatusBadge status={row.status} /><span className="text-muted-foreground">stage: {row.current_stage}</span></div>
                {row.call_scheduled_for ? <p className="text-xs text-muted-foreground">Call scheduled: {new Date(row.call_scheduled_for).toLocaleString()}</p> : null}
              </div>
              <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(row.id)}>
                <PhoneOff className="size-4" />
                Cancel escalation
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
