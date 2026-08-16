import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { HeartPulse } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

function Index() {
  const { loading, session, clinicId } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/auth", replace: true });
    } else if (!clinicId) {
      void navigate({ to: "/onboarding", replace: true });
    } else {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, session, clinicId, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <HeartPulse className="size-6" />
      </span>
      <p className="text-sm text-muted-foreground">Loading Therapy Care…</p>
    </div>
  );
}
