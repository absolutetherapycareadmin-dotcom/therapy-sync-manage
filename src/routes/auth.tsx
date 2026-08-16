import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Therapy Care" },
      { name: "description", content: "Sign in or create your Therapy Care clinic account." },
      { property: "og:title", content: "Sign in — Therapy Care" },
      { property: "og:description", content: "Access your therapy centre operations." },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Enter a valid email address").max(255);
const passwordSchema = z.string().min(6, "Password must be at least 6 characters").max(72);

function AuthPage() {
  const { loading, session, clinicId } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState("login");
  const [confirmSent, setConfirmSent] = useState(false);

  useEffect(() => {
    if (loading || !session) return;
    void navigate({ to: clinicId ? "/dashboard" : "/onboarding", replace: true });
  }, [loading, session, clinicId, navigate]);

  const validate = () => {
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      toast.error(emailResult.error.issues[0]?.message ?? "Invalid email");
      return null;
    }
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      toast.error(passwordResult.error.issues[0]?.message ?? "Invalid password");
      return null;
    }
    return { email: emailResult.data, password: passwordResult.data };
  };

  const onLogin = async () => {
    const values = validate();
    if (!values) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(values);
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const onRegister = async () => {
    const values = validate();
    if (!values) return;
    if (!fullName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      ...values,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName.trim() },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      setConfirmSent(true);
      toast.success("Check your email to confirm your Therapy Care account.");
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-foreground/15">
            <HeartPulse className="size-5" />
          </span>
          <span className="text-lg font-semibold">Therapy Care</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            One simple operating system for your therapy centre.
          </h2>
          <p className="mt-4 text-sm opacity-80">
            Children, therapists, rooms, appointments, attendance, packages and payments — organised
            in one secure place, with every clinic kept completely separate.
          </p>
        </div>
        <p className="text-xs opacity-70">© {new Date().getFullYear()} Therapy Care</p>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HeartPulse className="size-5" />
            </span>
            <span className="text-lg font-semibold">Therapy Care</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Therapy Care</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your clinic, or register a new one.
          </p>

          <Tabs value={mode} onValueChange={setMode} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button className="w-full" disabled={busy} onClick={onLogin}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign in
              </Button>
            </TabsContent>

            <TabsContent value="register" className="mt-5 space-y-4">
              {confirmSent ? (
                <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                  We sent a confirmation link to <strong>{email}</strong>. Confirm your email, then
                  sign in to set up your clinic.
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="reg-name">Your name</Label>
                <Input
                  id="reg-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Clinic administrator"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>
              <Button className="w-full" disabled={busy} onClick={onRegister}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Create account
              </Button>
            </TabsContent>
          </Tabs>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" disabled={busy} onClick={onGoogle}>
            Continue with Google
          </Button>
        </div>
      </div>
    </div>
  );
}
