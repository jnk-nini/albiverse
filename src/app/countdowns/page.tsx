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

  return (
    <CountdownsScreen
      userId={user.id}
      coupleId={profile.couple_id}
    />
  );
}