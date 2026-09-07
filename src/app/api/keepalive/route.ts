import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ================= SUPABASE KEEP-ALIVE =================
   Free-tier Supabase projects auto-pause after 7 days with no API activity,
   which would silently take the whole app down. Vercel Cron (see vercel.json,
   both free on the Hobby plan) hits this route once a day, which is real API
   traffic and resets that clock - no paid plan needed on either side.

   Locked to Vercel's own cron invocations: Vercel sends `Authorization:
   Bearer <CRON_SECRET>` automatically once CRON_SECRET is set as an env var,
   so this can't be turned into an open, spammable endpoint by anyone who
   finds the URL. Fails closed (401) if the secret isn't configured yet,
   matching every other guardrail in this app. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 }
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  /* RLS will return zero rows with the anon key and no session - that's
     fine, the ping only needs to reach the database, not read anything. */
  const { error } = await supabase.from("profiles").select("id").limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
}
