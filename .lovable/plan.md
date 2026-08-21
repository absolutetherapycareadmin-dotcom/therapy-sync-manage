# Therapy Care — WhatsApp Workflow Verification Report

No code, database, or configuration was changed. Everything below comes from reading the live database and the current branch.

## A. What already exists

| Area | State |
|---|---|
| Appointments CRUD + recurrence (`appointments.tsx`) | Working |
| Auto-generated parent WhatsApp message on booking (`start_appointment_communication_workflow`) | Working — full template with parent, child, date, time, therapist, therapy, room, fee |
| Escalation record per appointment (`communication_escalations`) | Working |
| Device SMS + scheduled SMS + SIM selection + normal call (`SmsBridge.java`, `sms_queue`, `call_queue`) | Working, untested on device |
| WhatsApp Centre list with honest "manual_opened / never claims delivered" wording | Working |
| Batch tables + RPCs (`whatsapp_automation_batches/items`, claim/record/release) | Present, never successfully exercised |
| Multi-centre isolation via `clinic_id` + RLS | Present on all tables |

## B. Root cause — appointment selection "not working"

The React selection code is actually correct (`selected` state, `toggleSelected`, select-all). The real cause is the **eligibility gate**, `isEligible()` in `appointments.tsx`:

- it requires a `whatsapp_messages` row reached through an *active* escalation whose status is `waiting_whatsapp|waiting_sms|waiting_call`.
- Live data: 3 appointments, 1 escalation, and that one is `cancelled` (the appointment was completed, so `handle_appointment_communication_change` cancelled it). Two older appointments were created before the trigger existed, so they have no escalation at all.
- Result: `eligibleRowIds` is empty → every row checkbox and "Select all eligible" is `disabled` → the count never moves → "WhatsApp (N)" stays at 0.

Secondary real defects in the same block:
- selection is not pruned when the status filter changes, so hidden rows stay selected and the header checkbox compares against a filtered list.
- rows that are ineligible give no reason; the admin cannot tell why the checkbox is dead.

Severity P0.

## C. Root cause — "Message cannot be empty"

In the WhatsApp Centre "New message" dialog, choosing a child fills only `recipient_name` and `phone`. The Message textarea has a *placeholder* only — it is never populated, so `form.message.trim()` is empty and the validator throws. The pre-filled text the admin sees is placeholder text, not state. Severity P0, front-end only.

## D. Honesty problem in the current batch path

`WhatsAppAutomationService.java` uses an accessibility service to auto-tap WhatsApp's Send button and then records status `sent`. That is silent background sending, which conflicts with the ₹0 / honest-status requirement in this brief. The status vocabulary is also `sent/failed/skipped` rather than Prepared / Opened / Awaiting confirmation / Confirmed / Failed. Severity P1.

## E. Missing entirely

- Parent action links (Confirm / Cancel / Request Schedule Change) — `process_mock_parent_action` exists but there is **no public route** (`src/routes/api/` does not exist) and no signed action token table.
- `appointment_history` table.
- `appointment_requests` (schedule-change review queue).
- Admin Request Centre page — no Request Centre exists anywhere today, so building one is not duplication.
- Therapist notifications — `notifications` has no appointment/therapist/actor columns, so nothing is traceable to a therapist.
- Roles: `profiles.role` is a plain column. Role checks on a user-editable profile row are a privilege-escalation risk (P1) — roles belong in a separate `user_roles` table with a `has_role()` security-definer function.

## F. Keep / fix / remove

- **Keep:** all SMS/call/native SIM code, escalation engine, message template, batch tables and RPCs, RLS model.
- **Fix:** eligibility + selection UX, message prefill, batch status vocabulary, `notifications` shape.
- **Remove:** the accessibility auto-send service (replace with deep link + explicit admin confirmation).

## G. Not verified / requires a real device

Everything native: SMS send, scheduled SMS, SIM selection, dialling, WhatsApp deep link opening the right chat with the text pre-filled. Nothing native has been tested on hardware; no claim of device verification is made.

## Implementation plan (proposed order)

1. **Selection (P0)** — make eligibility honest: an appointment is eligible when it is not cancelled and has a parent phone. Auto-create the missing escalation/message on demand for appointments that predate the trigger. Prune selection on filter change; show a tooltip reason on disabled rows.
2. **Message prefill (P0)** — generate the standard template from the selected child (and their next appointment) into the textarea; keep the empty-message guard as a real guard.
3. **Batch queue (P0)** — replace `sent` with `prepared → opened → awaiting_confirmation → confirmed → failed`; after each deep link the admin explicitly confirms "Sent" / "Not sent", and the queue advances. Batch Result reports these states verbatim.
4. **Parent actions (P1)** — new `appointment_action_tokens` (single-use, expiring, per-appointment) plus a public route `src/routes/api/public/parent-action` that validates the token and calls the existing RPC. Message gains three signed links.
5. **History + requests (P1)** — `appointment_history` and `appointment_requests`; parent cancel/schedule-change writes a request, never mutates the appointment directly.
6. **Admin Request Centre (P1)** — one new page listing approval / cancellation / schedule-change requests with Approve / Reject / Modify; only approval mutates the appointment.
7. **Therapist notifications (P1)** — extend `notifications` with `appointment_id`, `therapist_id`, `actor`, `event`; therapist resolved from the appointment, never chosen by the parent.
8. **Security (P1)** — move roles to `user_roles` + `has_role()`; RLS on all new tables; token validation server-side only.
9. **Android (P2)** — drop the accessibility service and its manifest/xml entries; keep one `MainActivity`; leave SMS/call untouched.
10. **Build + real-device test plan** — lint, typecheck, production build, migration check; then the 16-step hardware checklist from the brief.

Phases 1–3 restore the workflow the admin is blocked on today and can ship on their own.
