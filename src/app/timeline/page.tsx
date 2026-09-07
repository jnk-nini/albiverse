import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TimelineScreen from "@/components/TimelineScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* `searchParams` is a promise in this Next version (see
   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
   It carries `from`: the table-of-contents spread the reader opened this
   chapter from, so BACK returns them to that exact page of the book.

   PERFORMANCE: this page used to also `select("*")` from `media_items` here
   and hand the result down as `initialMemories`. Three things were wrong with
   that. `select("*")` pulled BOTH `url` and the legacy `file_url` duplicate,
   so every photo's base64 came down twice. All of it then had to be serialised
   into the RSC payload, which is a poor carrier for multi-megabyte strings.
   And `TimelineScreen` runs its own `fetchMemories()` on mount regardless, so
   the entire gallery was downloaded a second time anyway — roughly 12MB of
   traffic on this account to show six polaroids.

   The screen owns its own loading (and its own realtime subscription), so this
   route now does nothing but the auth gate, which is the part that genuinely
   belongs on the server. */

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const backHref = tocReturnHref((await searchParams).from, CHAPTER_SPREAD.timeline);
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

  return <TimelineScreen userId={user.id} coupleId={profile.couple_id} backHref={backHref} />;
}
