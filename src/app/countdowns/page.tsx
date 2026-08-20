import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CountdownsScreen from "@/components/CountdownsScreen";

export default async function CountdownsPage() {
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

  // Fetch initial events safely from Supabase
  const { data: events } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("couple_id", profile.couple_id);

  const initialEvents = (events || []).map((ev: any) => ({
    id: ev.id,
    title: ev.title,
    date: ev.date || ev.starts_at || "",
    notes: ev.notes || "",
    reminder: ev.reminder ?? true,
    category: ev.category || "date",
    custom_sticker: ev.custom_sticker || "🕸️",
  }));

  return (
    <CountdownsScreen
      userId={user.id}
      coupleId={profile.couple_id}
      initialEvents={initialEvents}
    />
  );
}