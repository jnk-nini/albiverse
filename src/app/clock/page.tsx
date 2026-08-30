import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClockScreen from "@/components/ClockScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* `searchParams` is a promise in this Next version (see
   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
   It carries `from`: the table-of-contents spread the reader opened this
   chapter from, so BACK returns them to that exact page of the book. */

export default async function ClockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const backHref = tocReturnHref((await searchParams).from, CHAPTER_SPREAD.clock);
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

  if (!profile?.couple_id) {
    redirect("/");
  }

  const { data: couple } = await supabase
    .from("couples")
    .select("anniversary_timestamp")
    .eq("id", profile.couple_id)
    .single();

  return (
    <ClockScreen
      userId={user.id}
      coupleId={profile.couple_id}
      initialAnniversary={couple?.anniversary_timestamp}
      backHref={backHref}
    />
  );
}