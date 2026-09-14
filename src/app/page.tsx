"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearChapterAccessCache } from "@/lib/hooks/useChapterAccess";
import { blobKey, dropBlob, readBlob, writeBlob } from "@/lib/media/blobCache";
import { readFileAsDataUrl } from "@/lib/media/mediaPrep";
import { getStorageBlob } from "@/lib/media/storage";
import CoupleConnect from "@/components/CoupleConnect";
import Dashboard from "@/components/Dashboard";
import TurnstileWidget from "@/components/TurnstileWidget";
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
  Star, 
  Flame 
} from "lucide-react";

/* Only the columns this page actually reads off `couples`. Declared so the
   lazy cover-image merge below can be typed without widening to `any`. */
type CoupleRow = {
  id: string;
  partner_1_id: string | null;
  partner_2_id: string | null;
  anniversary_timestamp: string | null;
  cover_image_data?: string | null;
  cover_storage_path?: string | null;
};

/* The cover has no per-row version column to key a cache on, so entries carry
   a fixed stamp and freshness is handled by the timed revalidation in
   loadCoverImage. Bump this to force every client to re-download once. */
const COVER_VERSION = "v1";
const COVER_CHECK_KEY = "albiverse:cover-checked:";

/* How long a cached cover is trusted before it is checked against the
   database again.

   localStorage rather than sessionStorage, and a clock rather than a session:
   sessionStorage is per-TAB, so every new tab and every cold launch of the
   installed PWA counted as a fresh session and paid the full 9.3MB again.
   Twelve hours bounds that to roughly twice a day per device in the worst
   case, while keeping the window short enough that a cover your partner
   changed shows up the same day. Whoever makes the change sees it instantly -
   Dashboard writes through to the cache. */
const COVER_REVALIDATE_MS = 12 * 60 * 60 * 1000;

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "err" | "success" } | null>(null);
  const [loading, setLoading] = useState(false);
  /* Supabase's "Enable CAPTCHA protection" toggle, once turned on, requires a
     captchaToken on sign-in AND sign-up alike - see TurnstileWidget. Tokens
     are single-use, so captchaResetKey is bumped after every submit attempt
     to force a fresh challenge for the next one. */
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  // Transition States
  const [isTransitioningIn, setIsTransitioningIn] = useState(false);
  const [transitionMode, setTransitionMode] = useState<"to_dashboard" | "to_connect">("to_dashboard");
  const [isTransitioningOut, setIsTransitioningOut] = useState(false);

  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [coupleData, setCoupleData] = useState<any>(null);
  const [partnerProfile, setPartnerProfile] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const supabase = createClient();

  /* EGRESS: the cover photo is the single most expensive thing this app
     reads. It is a base64 blob on `couples` (9.3MB on this account), and
     because BACK out of every chapter routes to `/?from=<spread>`, this page
     re-mounts constantly - so it used to be re-downloaded on every single
     return to the book. That one query is what put the project over its
     Supabase egress quota.

     It is cached in IndexedDB now. `couples` has no `updated_at` to version
     it against, so instead of checking on every mount the cache is trusted
     for COVER_REVALIDATE_MS, and the upload/reset paths in Dashboard write
     straight through so your own changes are never stale. The bounded
     staleness is therefore: a cover your partner changes on their device
     reaches you within half a day, or immediately if they changed it here. */
  const loadCoverImage = async (coupleId: string) => {
    const key = blobKey.coupleCover(coupleId);

    const applyCover = (bytes: string, storagePath?: string | null) =>
      setCoupleData((prev: CoupleRow | null) =>
        prev && prev.id === coupleId
          ? { ...prev, cover_image_data: bytes, cover_storage_path: storagePath ?? prev.cover_storage_path ?? null }
          : prev
      );

    /* Revalidation is timed, but a cache HIT still paints instantly on every
       mount - that is the whole point. */
    let checkedRecently = false;
    try {
      const last = Number(localStorage.getItem(COVER_CHECK_KEY + coupleId) ?? 0);
      checkedRecently = Number.isFinite(last) && Date.now() - last < COVER_REVALIDATE_MS;
    } catch {
      /* localStorage throws outright when site data is blocked. Treat it as
         "not checked" - worst case is today's behaviour. */
    }

    const cached = await readBlob(key, COVER_VERSION);
    if (cached) {
      applyCover(cached);
      if (checkedRecently) return;
    }

    const { data: cover } = await supabase
      .from("couples")
      .select("cover_image_data, cover_storage_path")
      .eq("id", coupleId)
      .maybeSingle();

    try {
      localStorage.setItem(COVER_CHECK_KEY + coupleId, String(Date.now()));
    } catch {
      /* see above */
    }

    let bytes = cover?.cover_image_data ?? null;
    if (!bytes && cover?.cover_storage_path) {
      try {
        bytes = await readFileAsDataUrl(await getStorageBlob(supabase, cover.cover_storage_path));
      } catch {
        bytes = null;
      }
    }

    if (!bytes) {
      /* Reset to the default cover, probably on the other partner's device.
         Without this the cached copy would keep painting a cover that no
         longer exists, on every mount, forever. */
      if (cached) {
        void dropBlob(key);
        setCoupleData((prev: CoupleRow | null) =>
          prev && prev.id === coupleId ? { ...prev, cover_image_data: null, cover_storage_path: null } : prev
        );
      }
      return;
    }

    if (bytes !== cached) {
      applyCover(bytes, cover?.cover_storage_path ?? null);
      void writeBlob(key, COVER_VERSION, bytes);
    }
  };

  const fetchProfileAndCouple = async (userId: string) => {
    try {
      let { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      /* THE "NAME KEEPS RESETTING TO WEB-SLINGER" BUG, ROOT CAUSE:
         `onAuthStateChange` fires this function on every session event, not
         just the first login - including Supabase's own silent token refresh,
         which happens roughly hourly for as long as a tab stays open. A
         transient empty result from the select above (a cold-start query, a
         network blip - `handle_new_user` already creates this row at signup,
         synchronously, before the client ever gets here) used to look
         identical to "this is a brand new user" and force-upserted a fresh
         `full_name`/`invite_code`. `fullName` is the SIGNUP FORM's local
         state, which is empty during an ordinary session - so the fallback
         `"Web-Slinger"` silently overwrote the real name on the very next
         auth event, no matter how many times the table was corrected by hand.

         This must never fabricate or overwrite full_name/email/invite_code
         here. The only legitimate self-heal left is filling in a missing
         invite_code on an old row that predates the column - and only that
         one column, only when the row genuinely already exists. */
      if (profile && !profile.invite_code) {
        const freshCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: healed } = await supabase
          .from("profiles")
          .update({ invite_code: freshCode })
          .eq("id", userId)
          .is("invite_code", null)
          .select()
          .maybeSingle();
        if (healed) profile = healed;
      }

      setUserProfile(profile);

      if (profile?.couple_id) {
        /* PERFORMANCE: this used to be `select("*")`, which dragged
           `ambient_audio_data` (a whole base64 MP3) and `cover_image_data`
           (a base64 photo) down the wire before ANYTHING could render - on
           this account that is ~12.6MB blocking every single app load, and
           the ambient track was never even read from here (AudioPlayerProvider
           fetches it lazily, only when you press play).

           Only the small columns are awaited now. The cover photo is fetched
           straight afterwards WITHOUT blocking, and merged in when it lands;
           the book shows its hand-drawn CSS cover until then. */
        const { data: couple } = await supabase
          .from("couples")
          .select("id, partner_1_id, partner_2_id, anniversary_timestamp")
          .eq("id", profile.couple_id)
          .maybeSingle();

        setCoupleData(couple);

        if (couple?.id) void loadCoverImage(couple.id);

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
      return profile;
    } catch (err) {
      console.error("Error fetching multiverse state:", err);
      return null;
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        await fetchProfileAndCouple(session.user.id);
      } else {
        setUser(null);
        setUserProfile(null);
        setCoupleData(null);
        setPartnerProfile(null);
      }
      setAuthChecking(false);
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        /* The chapter gate caches the resolved reader per tab; a session
           ending must invalidate it or the next sign-in could paint one
           chapter from the previous reader's ids before revalidating. */
        clearChapterAccessCache();
        setUser(null);
        setUserProfile(null);
        setCoupleData(null);
        setPartnerProfile(null);
        setAuthChecking(false);
        return;
      }

      if (session?.user && !isTransitioningIn) {
        setUser(session.user);
        await fetchProfileAndCouple(session.user.id);
      }
      setAuthChecking(false);
    });

    return () => authListener.subscription.unsubscribe();
  }, [isTransitioningIn]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, captchaToken: captchaToken ?? undefined },
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
        setLoading(false);
      } else {
        // Start transition overlay immediately
        setIsTransitioningIn(true);

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: captchaToken ?? undefined },
        });
        if (error) {
          setIsTransitioningIn(false);
          throw error;
        }

        if (data.user) {
          const profile = await fetchProfileAndCouple(data.user.id);
          setUser(data.user);

          // Route to correct animation mode
          if (profile?.couple_id) {
            setTransitionMode("to_dashboard");
            setTimeout(() => {
              setIsTransitioningIn(false);
              setLoading(false);
            }, 1100);
          } else {
            setTransitionMode("to_connect");
            setTimeout(() => {
              setIsTransitioningIn(false);
              setLoading(false);
            }, 750);
          }
        }
      }
    } catch (err: any) {
      setIsTransitioningIn(false);
      setLoading(false);
      setMessage({ text: err.message || "Spider-sense tingling: dimensional sync failed!", type: "err" });
    } finally {
      /* Turnstile tokens are single-use regardless of outcome - force a
         fresh challenge for the next attempt. */
      setCaptchaResetKey((k) => k + 1);
    }
  };

  const handleSignOut = async () => {
    setIsTransitioningOut(true);
    setTimeout(async () => {
      await supabase.auth.signOut();
      clearChapterAccessCache();
      setUser(null);
      setUserProfile(null);
      setCoupleData(null);
      setPartnerProfile(null);
      setIsTransitioningOut(false);
    }, 950);
  };

  // Called when couple successfully connects inside CoupleConnect
  const handleCoupleConnected = async () => {
    setTransitionMode("to_dashboard");
    setIsTransitioningIn(true);
    await fetchProfileAndCouple(user.id);
    setTimeout(() => {
      setIsTransitioningIn(false);
    }, 1100);
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

  return (
    <>
      <style>{`
        @keyframes portalIn {
          0% { transform: scale(0.6) rotate(-8deg); opacity: 0; }
          45% { transform: scale(1.04) rotate(1deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes portalOut {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(0.65) rotate(6deg); opacity: 0; }
        }
        @keyframes fastSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes reverseSpin {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        .animate-portal-in {
          animation: portalIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
        .animate-portal-out {
          animation: portalOut 0.55s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards;
        }
        .animate-spin-fast {
          animation: fastSpin 1.2s linear infinite;
        }
        .animate-spin-reverse {
          animation: reverseSpin 2s linear infinite;
        }
      `}</style>

      {/* 🚀 1. DYNAMIC LOGIN TRANSITION OVERLAY */}
      {isTransitioningIn && (
        <div className="fixed inset-0 z-[9999] bg-[#0e0b16] flex flex-col items-center justify-center p-4 overflow-hidden animate-portal-in">
          <div 
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#ffffff 1.5px, transparent 1.5px)",
              backgroundSize: "20px 20px"
            }}
          />
          
          <div className="absolute w-[450px] h-[450px] rounded-full border-4 border-dashed border-[#06b6d4]/40 animate-spin-fast pointer-events-none" />
          <div className="absolute w-[360px] h-[360px] rounded-full border-4 border-dashed border-[#e11d48]/40 animate-spin-reverse pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center justify-center text-center">
            {transitionMode === "to_dashboard" ? (
              <div className="bg-[#fffef9] border-[4px] border-zinc-950 shadow-[10px_10px_0px_#dc2626] px-8 py-6 rounded-2xl -rotate-2 flex flex-col items-center max-w-sm sm:max-w-md">
                <div className="relative w-18 h-18 rounded-full border-[3.5px] border-zinc-950 overflow-hidden shadow-[4px_4px_0px_#000] flex mb-3 animate-bounce">
                  <div className="w-1/2 h-full bg-[#dc2626] flex items-center justify-end pr-1">
                    <Heart className="w-6 h-6 text-white fill-white" />
                  </div>
                  <div className="w-1/2 h-full bg-[#06b6d4] flex items-center justify-start pl-1 border-l-2 border-zinc-950">
                    <Heart className="w-6 h-6 text-pink-100 fill-pink-500" />
                  </div>
                </div>

                <span className="bg-yellow-300 border-2 border-zinc-950 text-[10px] font-black uppercase tracking-widest px-3 py-1 shadow-[2px_2px_0px_#000] mb-2 font-mono">
                  DIMENSION LINKED // 616 × 65
                </span>

                <h2 className="text-2xl sm:text-3xl font-black italic tracking-tight text-zinc-950 uppercase font-sans">
                  *THWIP!* 🕸️
                </h2>
                <p className="text-sm font-black text-zinc-800 uppercase tracking-wider font-mono mt-1">
                  Opening Universe Scrapbook...
                </p>
              </div>
            ) : (
              <div className="bg-[#fffef9] border-[4px] border-zinc-950 shadow-[10px_10px_0px_#06b6d4] px-8 py-6 rounded-2xl rotate-2 flex flex-col items-center max-w-sm sm:max-w-md">
                <Radio className="w-12 h-12 text-[#0e7490] animate-spin mb-3" />
                <span className="bg-[#0e7490] text-white border-2 border-zinc-950 text-[10px] font-black uppercase tracking-widest px-3 py-1 shadow-[2px_2px_0px_#000] mb-2 font-mono">
                  MULTIVERSE BEACON ACTIVE
                </span>
                <h2 className="text-2xl sm:text-3xl font-black italic tracking-tight text-zinc-950 uppercase font-sans">
                  *BZZZT!* 📡
                </h2>
                <p className="text-sm font-black text-zinc-800 uppercase tracking-wider font-mono mt-1">
                  Connecting Spidey Frequency...
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🚪 2. SIGN-OUT TRANSITION OVERLAY */}
      {isTransitioningOut && (
        <div className="fixed inset-0 z-[9999] bg-[#0e0b16] flex flex-col items-center justify-center p-4 overflow-hidden animate-portal-out">
          <div 
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#ffffff 1.2px, transparent 1.2px)",
              backgroundSize: "16px 16px"
            }}
          />

          <div className="relative z-10 flex flex-col items-center justify-center text-center">
            <div className="bg-[#b91c1c] text-white border-[4px] border-zinc-950 shadow-[10px_10px_0px_#000] px-8 py-6 rounded-2xl rotate-2 flex flex-col items-center">
              <Zap className="w-12 h-12 text-yellow-300 fill-yellow-300 animate-spin mb-2" />
              <span className="bg-zinc-950 text-white text-[10px] font-black uppercase tracking-widest px-3 py-0.5 border border-white mb-2 font-mono">
                DISCONNECTING MULTIVERSE
              </span>
              <h2 className="text-2xl sm:text-3xl font-black italic tracking-tight uppercase">
                *SWOOSH!* ⚡
              </h2>
              <p className="text-xs font-bold text-amber-200 uppercase tracking-widest font-mono mt-1">
                Sealing Multiverse Rift...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. Screen Views */}
      {user && userProfile?.couple_id ? (
        <Dashboard
          user={user}
          profile={userProfile}
          couple={coupleData || { id: userProfile.couple_id, anniversary_timestamp: new Date().toISOString() }}
          partner={partnerProfile}
          onUnlinked={() => fetchProfileAndCouple(user.id)}
          onSignOut={handleSignOut}
        />
      ) : user && !userProfile?.couple_id ? (
        <main className="min-h-screen bg-[#0e0b16] flex flex-col items-center justify-center p-4 relative overflow-hidden">
          <button
            onClick={handleSignOut}
            className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f5efe4] border-[2.5px] border-zinc-950 text-zinc-900 text-xs font-black uppercase tracking-wider hover:bg-red-700 hover:text-white transition shadow-[3px_3px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer z-30"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>

          <CoupleConnect
            userId={user.id}
            myInviteCode={userProfile?.invite_code || "------"}
            onConnected={handleCoupleConnected}
          />
        </main>
      ) : (
        /* 4. Login Screen */
        <main className="min-h-screen bg-[#0e0b16] flex items-center justify-center p-4 md:p-10 relative overflow-hidden selection:bg-amber-300 selection:text-zinc-950">
          <div 
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#ffffff 1.2px, transparent 1.2px)",
              backgroundSize: "18px 18px"
            }}
          />

          <div className="absolute -top-24 -left-24 w-96 h-96 bg-cyan-600/20 rounded-full blur-[110px] animate-pulse pointer-events-none" style={{ animationDuration: "6s" }} />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-red-700/20 rounded-full blur-[110px] animate-pulse pointer-events-none" style={{ animationDuration: "5s" }} />

          {/* Giant Comic Halftone Strip (bold, oversized, fighting for attention) */}
          <div
            className="absolute top-0 left-0 w-[160%] h-52 sm:h-80 -translate-x-10 -translate-y-20 rotate-[-8deg] pointer-events-none opacity-35"
            style={{
              backgroundImage: "radial-gradient(circle, #0e7490 4.5px, transparent 4.5px)",
              backgroundSize: "28px 28px",
            }}
          />

          {/* Giant Halftone Burst Medallion */}
          <div
            className="absolute -top-40 -right-40 w-[700px] h-[700px] sm:w-[950px] sm:h-[950px] rounded-full pointer-events-none opacity-45"
            style={{
              backgroundImage: "radial-gradient(circle, #dc2626 4px, transparent 4px)",
              backgroundSize: "24px 24px",
              maskImage: "radial-gradient(circle, black 0%, black 40%, transparent 72%)",
              WebkitMaskImage: "radial-gradient(circle, black 0%, black 40%, transparent 72%)",
            }}
          />

          {/* Giant Spider Emblem */}
          <div className="absolute -bottom-28 -left-28 sm:-left-20 pointer-events-none select-none opacity-90 -rotate-12">
            <span className="block text-[300px] sm:text-[440px] leading-none drop-shadow-[0_14px_50px_rgba(0,0,0,0.85)]">
              🕷️
            </span>
          </div>

          {/* Floating Stickers */}
          <div className="hidden lg:block absolute left-12 top-24 z-20 pointer-events-none animate-bounce" style={{ animationDuration: "4s" }}>
            <div className="relative bg-[#facc15] text-zinc-950 border-[3px] border-zinc-950 px-4 py-2 rounded-lg shadow-[4px_4px_0px_#000] -rotate-12">
              <span className="font-black text-xl tracking-tighter italic">THWIP! 🕸️</span>
              <div className="absolute -bottom-2 left-4 w-3 h-3 bg-[#facc15] border-r-[3px] border-b-[3px] border-zinc-950 rotate-45" />
            </div>
          </div>

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

          <div className="hidden lg:block absolute right-14 top-24 z-20 pointer-events-none animate-bounce" style={{ animationDuration: "3.5s" }}>
            <div className="relative bg-[#b91c1c] text-amber-100 border-[3px] border-zinc-950 px-4 py-2 rounded-lg shadow-[4px_4px_0px_#000] rotate-12">
              <span className="font-black text-xl tracking-tighter italic flex items-center gap-1">
                <Zap className="w-4 h-4 fill-amber-300 text-amber-300" /> POW!
              </span>
              <div className="absolute -bottom-2 right-4 w-3 h-3 bg-[#b91c1c] border-r-[3px] border-b-[3px] border-zinc-950 rotate-45" />
            </div>
          </div>

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

          {/* Form Envelope */}
          <div className="relative w-full max-w-md z-10 my-4">
            <div className="absolute inset-0 bg-[#0e7490]/60 rounded-xl border-[3px] border-zinc-950 transform rotate-2 shadow-[6px_6px_0px_#000] pointer-events-none" />
            <div className="absolute inset-0 bg-[#991b1b]/60 rounded-xl border-[3px] border-zinc-950 transform -rotate-2 shadow-[6px_6px_0px_#000] pointer-events-none" />

            <div className="absolute -top-4 left-6 -rotate-3 z-30 bg-[#991b1b] text-amber-50 px-3.5 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_#000] border-2 border-zinc-950 flex items-center gap-1">
              <Flame className="w-3 h-3 text-amber-300 fill-amber-300" />
              <span>PETER // 616</span>
            </div>

            <div className="absolute -top-4 right-6 rotate-3 z-30 bg-[#0e7490] text-teal-50 px-3.5 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_#000] border-2 border-zinc-950 flex items-center gap-1">
              <span>GWEN // 65</span>
              <Sparkles className="w-3 h-3 text-amber-200 fill-amber-200" />
            </div>

            {/* Washi tape holding the card down, and comic-burst stickers
                popping off the card edges, so the card itself reads as
                decorated rather than just the space around it.
                Layering is physical: tape goes down first (z-20), then the
                universe badges (z-30), then the stickers on top (z-40). The
                tape is placed in the gap BETWEEN the two badges and along the
                clear stretch of the bottom edge, so it never covers a label. */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 tape-pink-solid w-40 h-6 -rotate-2 z-20 pointer-events-none" />
            <div className="absolute -bottom-3 left-[38%] -translate-x-1/2 tape-gold-solid w-28 h-5 rotate-3 z-20 pointer-events-none" />

            <div className="absolute -right-7 top-1/3 z-40 pointer-events-none select-none rotate-12">
              <div className="relative bg-[#facc15] text-zinc-950 border-[3px] border-zinc-950 px-3 py-1.5 rounded-lg shadow-[4px_4px_0px_#000]">
                <span className="font-black text-lg tracking-tighter italic">THWIP!</span>
              </div>
            </div>

            <div className="absolute -left-8 -bottom-6 z-40 pointer-events-none select-none -rotate-[16deg]">
              <div className="relative bg-[#b91c1c] text-amber-100 border-[3px] border-zinc-950 px-3.5 py-1.5 rounded-lg shadow-[4px_4px_0px_#000] flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                <span className="font-black text-lg tracking-tighter italic">POW!</span>
              </div>
            </div>

            <div className="relative bg-[#f4eee1] text-zinc-900 rounded-xl p-6 sm:p-8 border-[3.5px] border-zinc-950 shadow-[8px_8px_0px_#000]">
              
              <div className="relative border-b-2 border-dashed border-zinc-400/80 pb-4 mb-5 text-center">
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

                <div className="flex items-center justify-center gap-2 mb-1.5">
                  <span className="bg-amber-200 text-zinc-950 border border-zinc-950 text-[9px] font-black uppercase px-2 py-0.5 shadow-[1px_1px_0px_#000]">
                    VOL. #01
                  </span>
                  <span className="bg-zinc-900 text-white border border-zinc-950 text-[9px] font-black uppercase px-2 py-0.5 shadow-[1px_1px_0px_#000] flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5 text-amber-300 fill-amber-300" /> SCRAPBOOK
                  </span>
                </div>

                <h1 className="text-3xl font-black tracking-tight text-zinc-950 uppercase italic font-sans flex items-center justify-center gap-1.5 mt-1 drop-shadow-[1px_1px_0px_rgba(0,0,0,0.1)]">
                  Albiverse
                </h1>
                
                <div className="inline-block mt-1.5 px-3 py-1 bg-white/90 border border-zinc-950 shadow-[2px_2px_0px_#000] -rotate-0.5">
                  <p className="text-[10px] font-black uppercase text-zinc-800 font-mono tracking-tight">
                    "In every universe, it's always you and me."
                  </p>
                </div>
              </div>

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
                    
                    {/* The icon stays 16px, but the hit area is a full 36px
                        square: at p-0.5 this was a 20x20 target on the first
                        screen anyone touches, which is well under a thumb. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-zinc-600 hover:text-zinc-950 transition cursor-pointer rounded hover:bg-zinc-100"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4 text-red-700" />
                      ) : (
                        <Eye className="w-4 h-4 text-zinc-600" />
                      )}
                    </button>
                  </div>
                </div>

                <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaResetKey} />

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3 px-4 rounded-lg bg-gradient-to-r from-[#b91c1c] to-[#0e7490] hover:brightness-110 text-white font-black tracking-wider uppercase text-xs sm:text-sm shadow-[4px_4px_0px_#000] hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-2 border-zinc-950"
                >
                  <KeyRound className="w-4 h-4 text-amber-200 animate-pulse" />
                  {loading ? "Tuning Dimension..." : isSignUp ? "Publish Origin Story" : "Swing Back In"}
                </button>
              </form>

              {message && (
                <div className={`mt-3.5 p-2.5 rounded border-2 border-zinc-950 text-xs font-black flex items-center justify-center gap-2 shadow-[2px_2px_0px_#000] animate-bounce ${
                  message.type === "err" 
                    ? "bg-rose-100 text-rose-950" 
                    : "bg-emerald-100 text-emerald-950"
                }`}>
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-red-700" />
                  <span>{message.text}</span>
                </div>
              )}

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

            <div className="absolute -bottom-2.5 -right-2 w-32 h-5 bg-[#eab308] text-zinc-950 text-[8px] font-black uppercase tracking-wider flex items-center justify-center border-2 border-zinc-950 shadow-[2px_2px_0px_#000] rotate-2 pointer-events-none font-mono">
              CANON EVENT // 01 ⚡
            </div>
          </div>
        </main>
      )}
    </>
  );
}