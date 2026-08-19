import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClockScreen from "@/components/ClockScreen";

export default async function ClockPage() {
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
    />
  );
}