import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  { name: "description", content: "Compose and log WhatsApp messages sent to parents and therapists." },
  { property: "og:title", content: "WhatsApp Centre — Therapy Care" },
  { property: "og:description", content: "Compose and log WhatsApp messages to parents and therapists." },
] }), component: WhatsappPage });

const NONE = "__none__";
const TYPES = ["reminder", "confirmation", "payment", "general"];
type RpcResult = { data: unknown; error: { message: string } | null };
function callMockParentAction(appointmentId: string, action: string, note?: string) { const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult>; return rpc("process_mock_parent_action", { p_appointment_id: appointmentId, p_action: action, p_note: note ?? null }); }

function WhatsappPage() {
  const { clinicId, clinic } = useAuth();
  const id = clinicId as string;
  const qc = useQueryClient();
  const messages = useQuery({ ...whatsappQuery(id), enabled: !!id });
  const children = useQuery({ ...childrenQuery(id), enabled: !!id });
  const whatsappMode = ((clinic as typeof clinic & { whatsapp_mode?: string } | null)?.whatsapp_mode ?? "free_deep_link");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ child_id: NONE, recipient_name: "", phone: "", message: "", message_type: "reminder" });

  const send = useMutation({
    mutationFn: async () => {
      const phone = form.phone.replace(/[^\d+]/g, "");
      if (phone.length < 8) throw new Error("Enter a valid phone number");
      if (!form.message.trim()) throw new Error("Message cannot be empty");
      const { data: inserted, error } = await supabase.from("whatsapp_messages").insert({ clinic_id: id, child_id: form.child_id === NONE ? null : form.child_id, recipient_name: form.recipient_name.trim() || null, phone, message: form.message.trim(), message_type: form.message_type, status: whatsappMode === "paid_api" ? "queued" : "manual_opened", sent_at: null }).select("id").single();
      if (error) throw error;
      if (whatsappMode === "paid_api") {
        const { error: providerError } = await supabase.functions.invoke("whatsapp-api", { body: { to: phone.replace(/\D/g, ""), message: form.message.trim(), messageId: inserted.id } });
        if (providerError) throw providerError;
      } else {
        window.open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(form.message.trim())}`, "_blank", "noopener,noreferrer");
      }
    },
    onSuccess: () => { toast.success(whatsappMode === "paid_api" ? "WhatsApp message submitted to the configured provider." : "WhatsApp opened. Delivery/read status is not claimed."); setOpen(false); setForm({ child_id: NONE, recipient_name: "", phone: "", message: "", message_type: "reminder" }); void qc.invalidateQueries({ queryKey: ["whatsapp_messages", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openAppointmentMessage = useMutation({
    mutationFn: async (message: { id: string; phone: string; message: string }) => {
      const phone = message.phone.replace(/\D/g, "");
      if (!phone) throw new Error("Parent phone number is invalid");
      if (whatsappMode === "paid_api") {
        const { error } = await supabase.functions.invoke("whatsapp-api", { body: { to: phone, message: message.message, messageId: message.id } });
        if (error) throw error;
      } else {
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message.message)}`, "_blank", "noopener,noreferrer");
        const { error } = await supabase.from("whatsapp_messages").update({ status: "manual_opened", sent_at: null }).eq("id", message.id).eq("clinic_id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(whatsappMode === "paid_api" ? "WhatsApp message submitted to the configured provider." : "WhatsApp opened. The user must press Send; delivery/read is not claimed."); void qc.invalidateQueries({ queryKey: ["whatsapp_messages", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mockAction = useMutation({ mutationFn: async ({ appointmentId, action }: { appointmentId: string; action: string }) => { const { error } = await callMockParentAction(appointmentId, action); if (error) throw new Error(error.message); }, onSuccess: (_, variables) => { const label = variables.action === "confirm_appointment" ? "confirmed" : variables.action === "cancel_appointment" ? "cancellation requested" : "reschedule requested"; toast.success(`Mock parent response: ${label}`); void qc.invalidateQueries({ queryKey: ["whatsapp_messages", id] }); }, onError: (e: Error) => toast.error(e.message) });
  const rows = messages.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Centre" description="Compose messages and keep a record of parent and therapist WhatsApp automation." actions={<Button onClick={() => setOpen(true)}><Send className="size-4" />New message</Button>} />
      <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground"><strong className="text-foreground">{whatsappMode === "paid_api" ? "Paid WhatsApp API mode:" : "₹0 WhatsApp mode:"}</strong> {whatsappMode === "paid_api" ? "Messages use the optional server-side provider configuration. No provider credentials are exposed to the browser." : "appointment messages are prepared with a recipient and pre-filled text. Open WhatsApp and press Send yourself. The system never treats opening the deep link as delivered/read."}</div>
      {messages.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <EmptyState icon={MessageCircle} title="No messages yet" description="Book an appointment to create its automatic parent confirmation." action={<Button onClick={() => setOpen(true)}><Send className="size-4" />New message</Button>} /> : (
        <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead>Message</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden lg:table-cell">Role</TableHead><TableHead className="text-right">Status / Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((m) => <TableRow key={m.id}><TableCell className="font-medium">{m.recipient_name ?? (m.recipient_role === "therapist" ? "Therapist" : "Parent")}<span className="block text-xs text-muted-foreground">{formatDate(m.created_at)}</span></TableCell><TableCell className="hidden sm:table-cell tabular-nums">{m.phone}</TableCell><TableCell className="max-w-[320px] truncate text-muted-foreground">{m.message}</TableCell><TableCell className="hidden md:table-cell capitalize">{m.message_type.replaceAll("_", " ")}</TableCell><TableCell className="hidden lg:table-cell capitalize">{m.recipient_role}</TableCell><TableCell className="text-right"><div className="flex flex-col items-end gap-2"><StatusBadge status={m.status} />{m.recipient_role === "parent" && m.message_type === "appointment_confirmation" && m.appointment_id && (m.status === "queued" || m.status === "manual_opened") ? <><Button variant="outline" size="sm" disabled={openAppointmentMessage.isPending} onClick={() => openAppointmentMessage.mutate({ id: m.id, phone: m.phone, message: m.message })}>{whatsappMode === "paid_api" ? "Send via API" : "Open WhatsApp"}</Button><div className="flex flex-wrap justify-end gap-1"><Button variant="outline" size="sm" disabled={mockAction.isPending} onClick={() => mockAction.mutate({ appointmentId: m.appointment_id!, action: "confirm_appointment" })}>Approve</Button><Button variant="outline" size="sm" disabled={mockAction.isPending} onClick={() => mockAction.mutate({ appointmentId: m.appointment_id!, action: "cancel_appointment" })}>Cancel</Button><Button variant="outline" size="sm" disabled={mockAction.isPending} onClick={() => mockAction.mutate({ appointmentId: m.appointment_id!, action: "reschedule_appointment" })}>Schedule Change</Button></div></> : null}</div></TableCell></TableRow>)}</TableBody></Table></div>
      )}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>New WhatsApp message</DialogTitle><DialogDescription>{whatsappMode === "paid_api" ? "The optional paid provider runs server-side; credentials never enter the browser." : "This manual action opens WhatsApp. It does not claim the message was delivered or read."}</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Child</Label><Select value={form.child_id} onValueChange={(v) => { const child = children.data?.find((c) => c.id === v); setForm({ ...form, child_id: v, recipient_name: child?.parent_name ?? form.recipient_name, phone: child?.parent_phone ?? form.phone }); }}><SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Not linked</SelectItem>{(children.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Recipient name</Label><Input value={form.recipient_name} maxLength={100} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} /></div><div className="space-y-2"><Label>Phone *</Label><Input value={form.phone} maxLength={20} placeholder="+9198XXXXXXXX" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div></div><div className="space-y-2"><Label>Type</Label><Select value={form.message_type} onValueChange={(v) => setForm({ ...form, message_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Message *</Label><Textarea rows={4} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Reminder: your child's therapy session is tomorrow at 10:00 AM." /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => send.mutate()} disabled={send.isPending}>Log & {whatsappMode === "paid_api" ? "send" : "open WhatsApp"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
