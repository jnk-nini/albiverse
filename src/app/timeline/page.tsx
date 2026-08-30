import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TimelineScreen from "@/components/TimelineScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* `searchParams` is a promise in this Next version (see
   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
   It carries `from`: the table-of-contents spread the reader opened this
   chapter from, so BACK returns them to that exact page of the book. */

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

  const { data: rawMemories } = await supabase
    .from("media_items")
    .select("*")
    .eq("couple_id", profile.couple_id)
    .order("created_at", { ascending: true });

  const initialMemories = (rawMemories || []).map((item: any) => ({
    id: item.id,
    url: item.file_url || item.url || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800&q=80",
    caption: item.caption || "Multiverse Memory",
    date: item.created_at
      ? new Date(item.created_at).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "CANON",
    notes: item.notes || "",
    photo_scale: item.photo_scale ?? 1.0,
    photo_x: item.photo_x ?? 0,
    photo_y: item.photo_y ?? 0,
    photo_rotation: item.photo_rotation ?? 0,
    photo_flip_h: item.photo_flip_h ?? false,
    photo_flip_v: item.photo_flip_v ?? false,
  }));

  return (
    <TimelineScreen
      userId={user.id}
      coupleId={profile.couple_id}
      initialMemories={initialMemories}
      backHref={backHref}
    />
  );
}