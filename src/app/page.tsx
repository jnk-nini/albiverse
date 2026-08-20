"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import CoupleConnect from "@/components/CoupleConnect";
import Dashboard from "@/components/Dashboard";
import { 
  Heart, 
  Sparkles, 
  KeyRound, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ShieldAlert, 
  LogOut, 
  Zap, 
  Radio,
  FileText,
  Bookmark,
  Star,
  Flame
} from "lucide-react";

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
      let { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

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

        setMessage({ text: "Comic origin logged! Please sign in with your credentials.", type: "success" });
        setIsSignUp(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          await fetchProfileAndCouple(data.user.id, data.user.email);
        }
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Spider-sense tingling: dimensional sync failed!", type: "err" });
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <main className="min-h-screen bg-[#0e0b16] flex items-center justify-center p-4">
        <div className="bg-[#f5efe4] border-[3px] border-zinc-950 px-7 py-4 rounded-xl shadow-[5px_5px_0px_#dc2626] -rotate-1 flex items-center gap-3 animate-pulse">
          <Radio className="w-5 h-5 text-red-700 animate-spin" />
          <span className="font-mono text-xs font-black uppercase tracking-widest text-zinc-900">
            Tuning Spider-Tracer...
          </span>
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
      <main className="min-h-screen bg-[#0e0b16] flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <button
          onClick={() => supabase.auth.signOut()}
          className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f5efe4] border-[2.5px] border-zinc-950 text-zinc-900 text-xs font-black uppercase tracking-wider hover:bg-red-700 hover:text-white transition shadow-[3px_3px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer z-30"
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

  // 3. Not Logged In -> Scrapbook Comic Auth
  return (
    <main className="min-h-screen bg-[#0e0b16] flex items-center justify-center p-4 md:p-10 relative overflow-hidden selection:bg-amber-300 selection:text-zinc-950">
      
      {/* Halftone Dot Matrix Texture */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#ffffff 1.2px, transparent 1.2px)",
          backgroundSize: "18px 18px"
        }}
      />

      {/* Multiverse Dimension Shifting Glows */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-cyan-600/20 rounded-full blur-[110px] animate-pulse pointer-events-none" style={{ animationDuration: "6s" }} />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-red-700/20 rounded-full blur-[110px] animate-pulse pointer-events-none" style={{ animationDuration: "5s" }} />

      {/* FLOATING SFX 1: "THWIP!" Sticker (Top Left) */}
      <div className="hidden lg:block absolute left-12 top-24 z-20 pointer-events-none animate-bounce" style={{ animationDuration: "4s" }}>
        <div className="relative bg-[#facc15] text-zinc-950 border-[3px] border-zinc-950 px-4 py-2 rounded-lg shadow-[4px_4px_0px_#000] -rotate-12 transition-transform hover:scale-110">
          <span className="font-black text-xl tracking-tighter italic">THWIP! 🕸️</span>
          <div className="absolute -bottom-2 left-4 w-3 h-3 bg-[#facc15] border-r-[3px] border-b-[3px] border-zinc-950 rotate-45" />
        </div>
      </div>

      {/* FLOATING STICKER 2: Hanging Polaroid Photo (Bottom Left) */}
      <div className="hidden xl:block absolute left-10 bottom-14 z-20 pointer-events-none transform -rotate-6 transition duration-300 hover:rotate-0 hover:scale-105">
        <div className="relative bg-[#fffdf7] border-[3px] border-zinc-950 p-2.5 pb-6 rounded shadow-[6px_6px_0px_#000] w-40">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-4 bg-teal-600/80 border border-zinc-950 -rotate-2" />
          <div className="w-full h-24 bg-gradient-to-br from-[#be185d] via-purple-900 to-[#0e7490] rounded-xs border border-zinc-950 flex flex-col items-center justify-center text-white">
            <Heart className="w-6 h-6 fill-white animate-pulse text-white" />
            <span className="text-[8px] font-black tracking-widest mt-1 uppercase font-mono">EARTH 65 × 616</span>
          </div>
          <p className="text-[9px] font-mono font-bold text-center mt-2 text-zinc-800 tracking-tight">"CANON EVENT" 📌</p>
        </div>
      </div>

      {/* FLOATING SFX 3: "POW!" Sticker (Top Right) */}
      <div className="hidden lg:block absolute right-14 top-24 z-20 pointer-events-none animate-bounce" style={{ animationDuration: "3.5s" }}>
        <div className="relative bg-[#b91c1c] text-amber-100 border-[3px] border-zinc-950 px-4 py-2 rounded-lg shadow-[4px_4px_0px_#000] rotate-12 transition-transform hover:scale-110">
          <span className="font-black text-xl tracking-tighter italic flex items-center gap-1">
            <Zap className="w-4 h-4 fill-amber-300 text-amber-300" /> POW!
          </span>
          <div className="absolute -bottom-2 right-4 w-3 h-3 bg-[#b91c1c] border-r-[3px] border-b-[3px] border-zinc-950 rotate-45" />
        </div>
      </div>

      {/* FLOATING STICKER 4: Spider-Sense Active (Bottom Right) */}
      <div className="hidden xl:block absolute right-12 bottom-16 z-20 pointer-events-none transform rotate-6">
        <div className="bg-[#0e7490] text-amber-50 border-[3px] border-zinc-950 px-3.5 py-2.5 rounded-xl shadow-[5px_5px_0px_#000] text-center">
          <div className="flex justify-center gap-1 mb-0.5">
            <Star className="w-3 h-3 fill-amber-300 text-zinc-950" />
            <Star className="w-3 h-3 fill-amber-300 text-zinc-950" />
            <Star className="w-3 h-3 fill-amber-300 text-zinc-950" />
          </div>
          <p className="text-[10px] font-black uppercase font-mono leading-none">SPIDER-SENSE</p>
          <p className="text-[7px] font-extrabold uppercase mt-1 tracking-widest bg-zinc-950 text-white px-1.5 py-0.5 rounded-xs">ACTIVE</p>
        </div>
      </div>

      {/* Main Comic Page Envelope Container */}
      <div className="relative w-full max-w-md z-10 my-4">
        
        {/* Layered Under-Pages (Journal Depth) */}
        <div className="absolute inset-0 bg-[#0e7490]/60 rounded-xl border-[3px] border-zinc-950 transform rotate-2 shadow-[6px_6px_0px_#000] pointer-events-none" />
        <div className="absolute inset-0 bg-[#991b1b]/60 rounded-xl border-[3px] border-zinc-950 transform -rotate-2 shadow-[6px_6px_0px_#000] pointer-events-none" />

        {/* Top Washi Tape Banners */}
        <div className="absolute -top-4 left-6 -rotate-3 z-30 bg-[#991b1b] text-amber-50 px-3.5 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_#000] border-2 border-zinc-950 flex items-center gap-1">
          <Flame className="w-3 h-3 text-amber-300 fill-amber-300" />
          <span>PETER // 616</span>
        </div>
        
        <div className="absolute -top-4 right-6 rotate-3 z-30 bg-[#0e7490] text-teal-50 px-3.5 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_#000] border-2 border-zinc-950 flex items-center gap-1">
          <span>GWEN // 65</span>
          <Sparkles className="w-3 h-3 text-amber-200 fill-amber-200" />
        </div>

        {/* The Vintage Newsprint Scrapbook Sheet */}
        <div className="relative bg-[#f4eee1] text-zinc-900 rounded-xl p-6 sm:p-8 border-[3.5px] border-zinc-950 shadow-[8px_8px_0px_#000]">
          
          {/* Header Panel */}
          <div className="relative border-b-2 border-dashed border-zinc-400/80 pb-4 mb-5 text-center">
            
            {/* Split Dual-Hero Badge with Pulsing Action Glow */}
            <div className="inline-flex items-center justify-center mb-2.5 relative group">
              <div className="relative w-14 h-14 rounded-full border-[2.5px] border-zinc-950 overflow-hidden shadow-[3px_3px_0px_#000] flex">
                <div className="w-1/2 h-full bg-[#b91c1c] flex items-center justify-end pr-0.5">
                  <Heart className="w-4 h-4 text-white fill-white" />
                </div>
                <div className="w-1/2 h-full bg-[#0e7490] flex items-center justify-start pl-0.5 border-l-2 border-zinc-950">
                  <Heart className="w-4 h-4 text-pink-100 fill-pink-300" />
                </div>
              </div>
            </div>

            {/* Comic Badges */}
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <span className="bg-amber-200 text-zinc-950 border border-zinc-950 text-[9px] font-black uppercase px-2 py-0.5 shadow-[1px_1px_0px_#000]">
                VOL. #01
              </span>
              <span className="bg-zinc-900 text-white border border-zinc-950 text-[9px] font-black uppercase px-2 py-0.5 shadow-[1px_1px_0px_#000] flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-amber-300 fill-amber-300" /> SCRAPBOOK
              </span>
            </div>

            {/* Title */}
            <h1 className="text-3xl font-black tracking-tight text-zinc-950 uppercase italic font-sans flex items-center justify-center gap-1.5 mt-1 drop-shadow-[1px_1px_0px_rgba(0,0,0,0.1)]">
              Albiverse
            </h1>
            
            {/* Newsprint Cutout Caption */}
            <div className="inline-block mt-1.5 px-3 py-1 bg-white/90 border border-zinc-950 shadow-[2px_2px_0px_#000] -rotate-0.5">
              <p className="text-[10px] font-black uppercase text-zinc-800 font-mono tracking-tight">
                "In every universe, it's always you and me."
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-3.5 relative z-10" autoComplete="on">
            {isSignUp && (
              <div>
                <label 
                  htmlFor="signup-fullname" 
                  className="block text-[10px] font-black uppercase tracking-wider text-zinc-800 mb-1 flex items-center gap-1.5 font-mono"
                >
                  <span className="bg-amber-200 px-1 border border-zinc-950 text-[9px]">ID</span> Secret Identity (Your Name)
                </label>
                <div className="relative">
                  <input
                    id="signup-fullname"
                    name="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Peter Parker / Gwen Stacy"
                    className="w-full pl-9 pr-3 py-2 rounded-md bg-white border-2 border-zinc-950 focus:bg-amber-50/50 focus:border-red-700 outline-none text-zinc-900 placeholder:text-zinc-400 text-xs font-bold shadow-[2px_2px_0px_#000] transition"
                  />
                  <FileText className="w-3.5 h-3.5 text-zinc-700 absolute left-3 top-2.5 pointer-events-none" />
                </div>
              </div>
            )}

            <div>
              <label 
                htmlFor="auth-email" 
                className="block text-[10px] font-black uppercase tracking-wider text-zinc-800 mb-1 flex items-center gap-1.5 font-mono"
              >
                <span className="bg-[#0e7490] text-white px-1 border border-zinc-950 text-[9px]">SIG</span> Web-Frequency (Email)
              </label>
              <div className="relative">
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="spidey@dailybugle.com"
                  className="w-full pl-9 pr-3 py-2 rounded-md bg-white border-2 border-zinc-950 focus:bg-teal-50/50 focus:border-teal-700 outline-none text-zinc-900 placeholder:text-zinc-400 text-xs font-bold shadow-[2px_2px_0px_#000] transition"
                />
                <Mail className="w-3.5 h-3.5 text-zinc-700 absolute left-3 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <label 
                htmlFor="auth-password" 
                className="block text-[10px] font-black uppercase tracking-wider text-zinc-800 mb-1 flex items-center gap-1.5 font-mono"
              >
                <span className="bg-[#b91c1c] text-white px-1 border border-zinc-950 text-[9px]">KEY</span> Web-Lock (Password)
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-10 py-2 rounded-md bg-white border-2 border-zinc-950 focus:bg-red-50/50 focus:border-red-700 outline-none text-zinc-900 placeholder:text-zinc-400 text-xs font-bold shadow-[2px_2px_0px_#000] transition [&::-ms-reveal]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
                />
                <Lock className="w-3.5 h-3.5 text-zinc-700 absolute left-3 top-2.5 pointer-events-none" />
                
                {/* Single Controlled Eye Toggle */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-2 text-zinc-600 hover:text-zinc-950 transition cursor-pointer p-0.5 rounded hover:bg-zinc-100"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-red-700" />
                  ) : (
                    <Eye className="w-4 h-4 text-zinc-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Action Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-gradient-to-r from-[#b91c1c] to-[#0e7490] hover:brightness-110 text-white font-black tracking-wider uppercase text-xs sm:text-sm shadow-[4px_4px_0px_#000] hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-2 border-zinc-950"
            >
              <KeyRound className="w-4 h-4 text-amber-200 animate-pulse" />
              {loading ? "Tuning Dimension..." : isSignUp ? "Publish Origin Story" : "Swing Back In"}
            </button>
          </form>

          {/* Feedback Message */}
          {message && (
            <div className={`mt-3.5 p-2.5 rounded border-2 border-zinc-950 text-xs font-black flex items-center justify-center gap-2 shadow-[2px_2px_0px_#000] animate-bounce ${
              message.type === "err" 
                ? "bg-rose-100 text-rose-950" 
                : "bg-emerald-100 text-emerald-950"
            }`}>
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-700" />
              <span>{message.text}</span>
            </div>
          )}

          {/* Toggle Login/Sign-Up */}
          <div className="mt-5 pt-3.5 border-t border-dashed border-zinc-300 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage(null);
              }}
              className="text-[11px] font-black text-zinc-800 hover:text-red-700 underline underline-offset-4 decoration-2 decoration-red-700/60 uppercase tracking-wide transition cursor-pointer font-mono"
            >
              {isSignUp ? "Already logged in multiverse? Sign In" : "First time swinging by? Create scrapbook"}
            </button>
          </div>

        </div>

        {/* Bottom Corner Masking Tape */}
        <div className="absolute -bottom-2.5 -right-2 w-32 h-5 bg-[#eab308] text-zinc-950 text-[8px] font-black uppercase tracking-wider flex items-center justify-center border-2 border-zinc-950 shadow-[2px_2px_0px_#000] rotate-2 pointer-events-none font-mono">
          CANON EVENT // 01 ⚡
        </div>
      </div>
    </main>
  );
}