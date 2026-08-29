import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DigicamScreen from "@/components/DigicamScreen";

export default async function MediaPage() {
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

  const { data: rawItems } = await supabase
    .from("media_items")
    .select("id, url, caption, notes, media_type, created_at")
    .eq("couple_id", profile.couple_id)
    .order("created_at", { ascending: false });

  return (
    <DigicamScreen
      userId={user.id}
      coupleId={profile.couple_id}
      initialItems={rawItems ?? []}
    />
  );
}
