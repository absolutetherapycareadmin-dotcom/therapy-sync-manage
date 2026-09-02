import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const tokenSchema = z.string().trim().regex(/^[a-f0-9]{16,80}$/, "Invalid link");

const actionSchema = z.object({
  token: tokenSchema,
  new_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  new_time: z.string().trim().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Public parent action endpoint. Parents are never signed in, so the single-use
 * token itself is the credential — it is validated server-side only and never
 * returns anything beyond the appointment it belongs to.
 */
export const Route = createFileRoute("/api/public/parent-action")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = tokenSchema.safeParse(url.searchParams.get("t") ?? "");
        if (!parsed.success) return json({ ok: false, reason: "This link is not valid." }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("get_parent_action_context", {
          p_token: parsed.data,
        });
        if (error) return json({ ok: false, reason: "This link could not be checked." }, 500);
        return json(data);
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, reason: "Invalid request." }, 400);
        }
        const parsed = actionSchema.safeParse(body);
        if (!parsed.success) return json({ ok: false, reason: "Invalid request." }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("process_parent_action_token", {
          p_token: parsed.data.token,
          p_new_date: parsed.data.new_date || null,
          p_new_time: parsed.data.new_time || null,
          p_reason: parsed.data.reason || null,
        } as unknown as { p_token: string; p_new_date: string; p_new_time: string; p_reason: string });

        if (error) return json({ ok: false, reason: "This action could not be saved." }, 500);
        return json(data);
      },
    },
  },
});
