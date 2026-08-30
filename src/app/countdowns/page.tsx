import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CountdownsScreen from "@/components/CountdownsScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* `searchParams` is a promise in this Next version (see
   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
   It carries `from`: the table-of-contents spread the reader opened this
   chapter from, so BACK returns them to that exact page of the book. */

export default async function CountdownsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const backHref = tocReturnHref((await searchParams).from, CHAPTER_SPREAD.countdowns);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.couple_id) {
    redirect("/");
  }

  // Fetch initial events from Supabase calendar_events using starts_at
  const { data: rawEvents } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("couple_id", profile.couple_id)
    .order("starts_at", { ascending: true });

  const initialEvents = (rawEvents || []).map((ev: any) => {
    let category = "date";
    let custom_sticker = "🕸️";

    if (ev.location) {
      try {
        const parsed = JSON.parse(ev.location);
        if (parsed.category) category = parsed.category;
        if (parsed.custom_sticker) custom_sticker = parsed.custom_sticker;
      } catch {
        if (["date", "birthday", "trip", "anniversary", "custom"].includes(ev.location)) {
          category = ev.location;
        }
      }
    }

    return {
      id: ev.id,
      title: ev.title,
      date: ev.starts_at || ev.date || "",
      notes: ev.notes || "",
      reminder: ev.reminder_at ? true : ev.rsvp_required ?? true,
      category,
      custom_sticker,
    };
  });

  return (
    <CountdownsScreen
      userId={user.id}
      coupleId={profile.couple_id}
      initialEvents={initialEvents}
      backHref={backHref}
    />
  );
}