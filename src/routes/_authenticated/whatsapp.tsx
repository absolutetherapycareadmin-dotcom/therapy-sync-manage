import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { childrenQuery, whatsappQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/whatsapp")({ head: () => ({ meta: [
  { title: "WhatsApp Centre — Therapy Care" },
  { name: "description", content: "Prepare and send WhatsApp messages to parents and therapists." },
  { property: "og:title", content: "WhatsApp Centre — Therapy Care" },
  { property: "og:description", content: "Prepare and send WhatsApp messages to parents and therapists." },
] }), component: WhatsappPage });

const NONE = "__none__";
const TYPES = ["reminder", "confirmation", "payment", "general"];

function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(-10)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return digits;
}

function WhatsappPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const messages = useQuery({ ...whatsappQuery(id), enabled: !!id, refetchInterval: 30000 });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const whatsappMode = ((clinic as typeof clinic & { whatsapp_mode?: string } | null)?.whatsapp_mode ?? "free_deep_link");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ child_id: NONE, recipient_name: "", phone: "", message: "", message_type: "reminder" });

  const send = useMutation({
    mutationFn: async () => {
      const phone = normalizeWhatsAppPhone(form.phone);
      const message = form.message.trim();
      if (!/^\d{8,15}$/.test(phone)) throw new Error("Enter a valid WhatsApp phone number, including country code when needed");
      if (!message) throw new Error("Message cannot be empty");
      const { data: inserted, error } = await supabase.from("whatsapp_messages").insert({
        clinic_id: id,
        child_id: form.child_id === NONE ? null : form.child_id,
        recipient_name: form.recipient_name.trim() || null,
        phone: `+${phone}`,
        message,
        message_type: form.message_type,
        status: whatsappMode === "paid_api" ? "queued" : "manual_opened",
        sent_at: null,
      }).select("id").single();
      if (error) throw error;
      if (whatsappMode === "paid_api") {
        const { error: providerError } = await supabase.functions.invoke("whatsapp-api", { body: { to: phone, message, messageId: inserted.id } });
        if (providerError) throw providerError;
      } else {
        const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
        if (!popup) throw new Error("WhatsApp could not be opened by the browser");
        const { error: openedError } = await supabase.from("whatsapp_messages").update({ status: "manual_opened", sent_at: null, metadata: { opened_at: new Date().toISOString(), delivery_claim: false, read_claim: false } }).eq("id", inserted.id).eq("clinic_id", id);
        if (openedError) throw openedError;
      }
    },
    onSuccess: () => { toast.success(whatsappMode === "paid_api" ? "WhatsApp message submitted to the configured provider." : "WhatsApp opened. The user must press Send; delivery/read is not claimed."); setOpen(false); setForm({ child_id: NONE, recipient_name: "", phone: "", message: "", message_type: "reminder" }); void qc.invalidateQueries({ queryKey: ["whatsapp_messages", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openAppointmentMessage = useMutation({
    mutationFn: async (message: { id: string; phone: string; message: string }) => {
      const phone = normalizeWhatsAppPhone(message.phone);
      if (!/^\d{8,15}$/.test(phone)) throw new Error("Parent WhatsApp phone number is invalid");
      if (!message.message.trim()) throw new Error("Appointment WhatsApp message cannot be empty");
      if (whatsappMode === "paid_api") throw new Error("Paid appointment notifications are sent automatically by the server");
      const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message.message.trim())}`, "_blank", "noopener,noreferrer");
      if (!popup) throw new Error("WhatsApp could not be opened by the browser");
      const { error } = await supabase.from("whatsapp_messages").update({ status: "manual_opened", sent_at: null, metadata: { opened_at: new Date().toISOString(), delivery_claim: false, read_claim: false } }).eq("id", message.id).eq("clinic_id", id).eq("status", "queued");
      if (error) throw error;
    },
    onSuccess: () => { toast.success("WhatsApp opened. The user must press Send; delivery/read is not claimed."); void qc.invalidateQueries({ queryKey: ["whatsapp_messages", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = messages.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Centre" description="Appointment WhatsApp notifications are prepared automatically at their configured due time." actions={<Button onClick={() => setOpen(true)}><Send className="size-4" />New message</Button>} />
      <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground"><strong className="text-foreground">{whatsappMode === "paid_api" ? "Paid WhatsApp API mode:" : "₹0 WhatsApp mode:"}</strong> {whatsappMode === "paid_api" ? "Due appointment notifications are sent by the server through the optional official provider. Provider delivery/read states appear only when Meta supplies them." : "Due appointment notifications appear here with a pre-filled recipient and message. Open WhatsApp and press Send yourself. Opening the deep link never counts as delivered/read/sent."}</div>
      {messages.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <EmptyState icon={MessageCircle} title="No messages yet" description="Book an appointment to create its automatic parent WhatsApp notification." action={<Button onClick={() => setOpen(true)}><Send className="size-4" />New message</Button>} /> : (
        <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead>Message</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden lg:table-cell">Due</TableHead><TableHead className="text-right">Status / Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((m) => {
          const due = new Date(m.scheduled_for ?? m.created_at).getTime() <= Date.now();
          const appointmentMessage = m.recipient_role === "parent" && m.message_type === "appointment_confirmation";
          const canOpenFree = appointmentMessage && due && (m.status === "queued" || m.status === "manual_opened") && whatsappMode !== "paid_api";
          return <TableRow key={m.id}><TableCell className="font-medium">{m.recipient_name ?? (m.recipient_role === "therapist" ? "Therapist" : "Parent")}<span className="block text-xs text-muted-foreground">{formatDate(m.created_at)}</span></TableCell><TableCell className="hidden sm:table-cell tabular-nums">{m.phone}</TableCell><TableCell className="max-w-[320px] truncate text-muted-foreground">{m.message}</TableCell><TableCell className="hidden md:table-cell capitalize">{m.message_type.replaceAll("_", " ")}</TableCell><TableCell className="hidden lg:table-cell text-xs">{due ? "Due now" : new Date(m.scheduled_for).toLocaleString()}</TableCell><TableCell className="text-right"><div className="flex flex-col items-end gap-2"><StatusBadge status={m.status} />{appointmentMessage && !due && (m.status === "queued" || m.status === "manual_opened") ? <span className="text-xs text-muted-foreground">Waiting for configured notification time</span> : null}{canOpenFree ? <Button variant="outline" size="sm" disabled={openAppointmentMessage.isPending} onClick={() => openAppointmentMessage.mutate({ id: m.id, phone: m.phone, message: m.message })}>Open WhatsApp</Button> : null}{appointmentMessage && due && whatsappMode === "paid_api" && m.status === "queued" ? <span className="text-xs text-muted-foreground">Automatic server send pending</span> : null}</div></TableCell></TableRow>;
        })}</TableBody></Table></div>
      )}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>New WhatsApp message</DialogTitle><DialogDescription>{whatsappMode === "paid_api" ? "The optional paid provider runs server-side; credentials never enter the browser." : "This manual action opens WhatsApp. It does not claim the message was delivered or read."}</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Child</Label><Select value={form.child_id} onValueChange={(v) => { const child = children.data?.find((c) => c.id === v); setForm({ ...form, child_id: v, recipient_name: child?.parent_name ?? form.recipient_name, phone: child?.parent_phone ?? form.phone }); }}><SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Not linked</SelectItem>{(children.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Recipient name</Label><Input value={form.recipient_name} maxLength={100} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} /></div><div className="space-y-2"><Label>Phone *</Label><Input value={form.phone} maxLength={20} placeholder="+9198XXXXXXXX" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div></div><div className="space-y-2"><Label>Type</Label><Select value={form.message_type} onValueChange={(v) => setForm({ ...form, message_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Message *</Label><Textarea rows={4} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Reminder: your child's therapy session is tomorrow at 10:00 AM." /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => send.mutate()} disabled={send.isPending}>Log & {whatsappMode === "paid_api" ? "send" : "open WhatsApp"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
