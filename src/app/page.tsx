"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import CoupleConnect from "@/components/CoupleConnect";
import Dashboard from "@/components/Dashboard";
import { Heart, Sparkles, KeyRound, Mail, Lock, Eye, EyeOff, ShieldAlert, LogOut } from "lucide-react";

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "err" | "success" } | null>(null);
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [coupleData, setCoupleData] = useState<any>(null);
  const [partnerProfile, setPartnerProfile] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const supabase = createClient();

  const fetchProfileAndCouple = async (userId: string, userEmail?: string) => {
    try {
      // 1. Fetch current profile
      let { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      // If missing profile or code, create one
      if (!profile || !profile.invite_code) {
        const freshCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: newProfile } = await supabase
          .from("profiles")
          .upsert({
            id: userId,
            email: userEmail || "spidey@dailybugle.com",
            full_name: fullName || "Web-Slinger",
            invite_code: freshCode,
          })
          .select()
          .single();

        if (newProfile) profile = newProfile;
      }

      setUserProfile(profile);

      // 2. Fetch couple and partner information
      if (profile?.couple_id) {
        const { data: couple } = await supabase
          .from("couples")
          .select("*")
          .eq("id", profile.couple_id)
          .maybeSingle();

        setCoupleData(couple);

        const partnerId = couple?.partner_1_id === userId
          ? couple.partner_2_id
          : couple?.partner_1_id;
        if (partnerId) {
          const { data: partner } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("id", partnerId)
            .maybeSingle();
          setPartnerProfile(partner);
        }
      } else {
        setCoupleData(null);
        setPartnerProfile(null);
      }
    } catch (err) {
      console.error("Error fetching multiverse state:", err);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        await fetchProfileAndCouple(session.user.id, session.user.email);
      } else {
        setUser(null);
        setUserProfile(null);
        setCoupleData(null);
        setPartnerProfile(null);
      }
      setAuthChecking(false);
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        await fetchProfileAndCouple(session.user.id, session.user.email);
      } else {
        setUser(null);
        setUserProfile(null);
        setCoupleData(null);
        setPartnerProfile(null);
      }
      setAuthChecking(false);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;

        const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        if (data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            email,
            full_name: fullName,
            invite_code: generatedCode,
          });
        }

        setMessage({ text: "Universe created! Please sign in with your credentials.", type: "success" });
        setIsSignUp(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          await fetchProfileAndCouple(data.user.id, data.user.email);
        }
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Spider-sense tingling: an error occurred!", type: "err" });
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-pink-300 font-mono text-xs animate-pulse tracking-widest uppercase">
          Initializing Multiverse Link...
        </div>
      </main>
    );
  }

  // 1. Linked -> Dashboard
  if (user && userProfile?.couple_id) {
    return (
      <Dashboard
        user={user}
        profile={userProfile}
        couple={coupleData || { id: userProfile.couple_id, anniversary_timestamp: new Date().toISOString() }}
        partner={partnerProfile}
        onUnlinked={() => fetchProfileAndCouple(user.id, user.email)}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  // 2. Logged In but Not Linked -> Couple Connect Screen
  if (user && !userProfile?.couple_id) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
        <button
          onClick={() => supabase.auth.signOut()}
          className="absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/60 border border-pink-400/30 text-pink-200 text-xs font-semibold hover:bg-red-900 transition cursor-pointer z-30"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>

        <CoupleConnect
          userId={user.id}
          myInviteCode={userProfile?.invite_code || "------"}
          onConnected={() => fetchProfileAndCouple(user.id, user.email)}
        />
      </main>
    );
  }

  // 3. Not Logged In -> Sign In / Sign Up
  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="relative w-full max-w-md z-10">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 comic-washi-tape w-40 h-7 rounded-sm rotate-1 z-20 flex items-center justify-center">
          <span className="text-[9px] font-black tracking-widest text-pink-100 uppercase">
            EARTH-65 × EARTH-616
          </span>
        </div>

        <div className="paper-sheet-solid p-8 shadow-2xl relative overflow-hidden">
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-950/80 text-pink-300 mb-3 border border-pink-400/30 shadow-[0_0_15px_rgba(244,114,182,0.3)]">
              <Heart className="w-7 h-7 fill-red-800 text-pink-400" />
            </div>
            
            <div className="inline-block px-2.5 py-0.5 mb-2 rounded-full bg-red-950/90 border border-red-500/40 text-[10px] font-extrabold tracking-wider text-pink-200">
              ISSUE #01 • THE MULTIVERSE SCRAPBOOK
            </div>

            <h1 className="text-3xl font-black tracking-tight text-white flex items-center justify-center gap-2">
              Albiverse
              <Sparkles className="w-5 h-5 text-pink-400 animate-spin" style={{ animationDuration: '8s' }} />
            </h1>
            <p className="text-xs text-pink-200/70 mt-1 font-medium italic">
              "In every universe, it's always you and me."
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-pink-200/90 mb-1">
                  Secret Identity (Your Name)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Peter Parker / Gwen Stacy"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-pink-400/30 focus:border-red-500 focus:ring-2 focus:ring-red-700/30 outline-none text-pink-100 placeholder:text-pink-200/30 text-sm transition"
                  />
                  <Sparkles className="w-4 h-4 text-pink-400/60 absolute left-3.5 top-3.5" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-pink-200/90 mb-1">
                Web-Frequency (Email)
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="spidey@dailybugle.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-pink-400/30 focus:border-red-500 focus:ring-2 focus:ring-red-700/30 outline-none text-pink-100 placeholder:text-pink-200/30 text-sm transition"
                />
                <Mail className="w-4 h-4 text-pink-400/60 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-pink-200/90 mb-1">
                Web-Lock (Password)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-black/40 border border-pink-400/30 focus:border-red-500 focus:ring-2 focus:ring-red-700/30 outline-none text-pink-100 placeholder:text-pink-200/30 text-sm transition"
                />
                <Lock className="w-4 h-4 text-pink-400/60 absolute left-3.5 top-3.5" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-pink-300/60 hover:text-pink-200 transition cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-pink-400" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-red-800 via-rose-900 to-red-800 hover:from-red-700 hover:to-rose-800 text-pink-50 font-bold tracking-wide shadow-[0_0_20px_rgba(185,28,28,0.5)] transition duration-200 active:scale-[0.98] disabled:opacity-50 text-sm flex items-center justify-center gap-2 mt-4 cursor-pointer border border-pink-400/40"
            >
              <KeyRound className="w-4 h-4 text-pink-300" />
              {loading ? "Aligning Universes..." : isSignUp ? "Create Your Multiverse" : "Swing Back In"}
            </button>
          </form>

          {message && (
            <div className={`mt-4 p-3 rounded-xl border text-xs text-center font-medium flex items-center justify-center gap-1.5 ${
              message.type === "err" 
                ? "bg-red-950/80 border-red-500/50 text-pink-200" 
                : "bg-pink-950/80 border-pink-400/50 text-pink-100"
            }`}>
              <ShieldAlert className="w-4 h-4 shrink-0 text-pink-400" />
              {message.text}
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage(null);
              }}
              className="text-xs text-pink-300/80 hover:text-pink-100 font-semibold underline underline-offset-4 cursor-pointer transition"
            >
              {isSignUp ? "Already a hero? Sign In" : "First time here? Forge your scrapbook"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}