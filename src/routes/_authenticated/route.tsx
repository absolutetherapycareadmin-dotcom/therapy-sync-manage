import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { HeartPulse, LogOut, Bell } from "lucide-react";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { loading, session, clinic, clinicId, profile, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/auth", replace: true });
    else if (!clinicId) void navigate({ to: "/onboarding", replace: true });
  }, [loading, session, clinicId, navigate]);

  if (loading || !session || !clinicId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <span className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <HeartPulse className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground">Loading Therapy Care…</p>
      </div>
    );
  }

  const name = profile?.full_name || profile?.email || "Account";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/80 px-3 backdrop-blur sm:px-5">
            <SidebarTrigger />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{clinic?.name ?? "Therapy Care"}</p>
              <p className="truncate text-xs text-muted-foreground">Therapy Care workspace</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              onClick={() => void navigate({ to: "/notifications" })}
            >
              <Bell className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{profile?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void navigate({ to: "/settings" })}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut();
                    void navigate({ to: "/auth", replace: true });
                  }}
                >
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl space-y-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
