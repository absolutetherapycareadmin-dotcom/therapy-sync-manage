# WhatsApp Automation

## Phase 1 — ₹0 test mode

The repository now contains a complete database-first mock workflow. It does not call Meta and does not send real WhatsApp messages.

1. Creating an appointment automatically creates a `whatsapp_messages` row for the parent.
2. The message contains the appointment date, time, therapist, specialty, room and fee.
3. The WhatsApp Centre exposes mock **Confirm**, **Cancel**, and **Reschedule** actions.
4. Confirm updates `appointments.parent_confirmation_status` to `confirmed` and automatically creates a therapist WhatsApp message record plus an in-app notification.
5. Cancel changes the confirmation state to `cancel_requested`; the appointment itself is not deleted or silently cancelled.
6. Reschedule changes the confirmation state to `reschedule_requested`; the appointment remains intact until an admin acts.
7. Invalid parent or therapist phone numbers create an error record/notification instead of pretending a message was delivered.

## Phase 2 — live Meta Cloud API

The Edge Function is at `supabase/functions/whatsapp-automation/index.ts`.

It is designed to keep all WhatsApp credentials server-side. The browser must never receive a Meta access token, phone-number ID secret, app secret, or Supabase secret key.

Required Edge Function secrets for live mode:

- `WHATSAPP_MODE=live`
- `META_WA_ACCESS_TOKEN`
- `META_WA_PHONE_NUMBER_ID`
- `META_WA_APP_SECRET`
- `META_WA_VERIFY_TOKEN`
- `WHATSAPP_APPOINTMENT_TEMPLATE`
- `WHATSAPP_THERAPIST_TEMPLATE`
- `WHATSAPP_TEMPLATE_LANGUAGE` (defaults to `en_US`)
- `META_WA_API_VERSION` (defaults to `v23.0`)

The appointment and therapist templates should be approved as utility templates in Meta Business Manager and contain the same parameter order used by the Edge Function.

### Security model

```text
Therapy Care browser
       |
       | authenticated Supabase request
       v
Supabase Edge Function
       |
       | server-side secret only
       v
Meta WhatsApp Cloud API
       |
       v
Parent / Therapist
```

The webhook endpoint is the same Edge Function with `?webhook=1`. GET handles Meta verification; POST validates `X-Hub-Signature-256` before processing quick-reply actions.

## Deployment note

The repository contains the function and configuration, but GitHub commits alone do not deploy a Supabase Edge Function. Deployment and secret configuration must be performed against the connected Supabase project. Until that is done, keep `WHATSAPP_MODE` in mock mode.

Never commit WhatsApp or Supabase secret values to GitHub, APK assets, or browser-exposed `VITE_*` variables.
