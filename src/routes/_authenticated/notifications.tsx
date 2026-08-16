import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { notificationsQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Therapy Care" },
      { name: "description", content: "Clinic alerts, reminders and system notifications." },
      { property: "og:title", content: "Notifications — Therapy Care" },
      { property: "og:description", content: "Clinic alerts, reminders and system notifications." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { clinicId } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const notifications = useQuery({ ...notificationsQuery(id), enabled: !!id });

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("clinic_id", id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
      void qc.invalidateQueries({ queryKey: ["notifications", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = notifications.data ?? [];
  const unread = rows.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          rows.length ? (
            <Button variant="outline" onClick={() => markAll.mutate()} disabled={!unread}>
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {notifications.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="Clinic alerts and reminders will appear here as your team uses the platform."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li
              key={n.id}
              className={cn(
                "rounded-xl border bg-card p-4",
                !n.is_read && "border-primary/40 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body ? (
                    <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(n.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
