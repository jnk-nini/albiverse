import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";

/* Quota/cost guardrails: this route is the only one that spends metered
   YouTube API quota and eats a Vercel invocation per call, and it used to be
   reachable by anyone who could sign up on the public login page - signing up
   only needs an email, never joining a couple. The couple_id check below
   closes that "free account, unlimited proxy" gap, and the rate limit stops
   either partner's client (buggy or malicious) from looping. */
const SEARCH_RATE_LIMIT = 40;
const SEARCH_RATE_WINDOW_MS = 60_000;

/* ================= CH.09 - THE FREE SEARCH ENGINE =================
   Track search runs through YouTube Data API v3. The key stays on the server:
   a NEXT_PUBLIC_ key would be readable by anyone who opened devtools and could
   be spent by anyone at all, and the daily quota is shared.

   Two modes:
     GET /api/youtube/search?q=...   list search results
     GET /api/youtube/search?id=...  look one video up by id, used when the
                                     reader pastes a YouTube link instead

   With no key configured the route answers 200 with `configured: false`, so the
   chapter can show the "paste a link" fallback rather than an error state. */

export const dynamic = "force-dynamic";

type YtThumb = { url?: string };
type YtSnippet = {
  title?: string;
  channelTitle?: string;
  thumbnails?: { medium?: YtThumb; default?: YtThumb; high?: YtThumb };
};
type YtSearchItem = { id?: { videoId?: string }; snippet?: YtSnippet };
type YtVideoItem = { id?: string; snippet?: YtSnippet; contentDetails?: { duration?: string } };

export type YoutubeHit = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSeconds: number | null;
};

/** ISO 8601 duration ("PT4M13S") to seconds. */
function parseDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(min || 0) * 60 + Number(s || 0)
  );
}

function pickThumb(snippet: YtSnippet | undefined): string {
  const t = snippet?.thumbnails;
  return t?.medium?.url || t?.high?.url || t?.default?.url || "";
}

/**
 * Resolve one video id with no API key, for pasted links.
 * oEmbed is a public endpoint, so this works on a project that has never set
 * YOUTUBE_API_KEY. If it fails (private or deleted video, network trouble) the
 * track is still returned: the IFrame player only ever needed the id, and a
 * placeholder title beats refusing to add the song at all.
 */
async function resolveWithoutKey(videoId: string): Promise<YoutubeHit> {
  const fallback: YoutubeHit = {
    videoId,
    title: "YouTube track",
    channel: "Pasted link",
    // the thumbnail host needs no key either
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    durationSeconds: null,
  };

  try {
    const oembed = new URL("https://www.youtube.com/oembed");
    oembed.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
    oembed.searchParams.set("format", "json");

    const res = await fetch(oembed, { cache: "no-store" });
    if (!res.ok) return fallback;

    const json = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      videoId,
      title: json.title || fallback.title,
      channel: json.author_name || fallback.channel,
      thumbnail: json.thumbnail_url || fallback.thumbnail,
      durationSeconds: null,
    };
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  /* The route is only for the two people this app belongs to. Without this it
     would be an open proxy that spends the project's quota for strangers. */
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.couple_id) {
    return NextResponse.json({ error: "Link both universes first." }, { status: 403 });
  }

  const { allowed, retryAfterSeconds } = checkRateLimit(
    user.id,
    SEARCH_RATE_LIMIT,
    SEARCH_RATE_WINDOW_MS
  );
  if (!allowed) {
    return NextResponse.json(
      { configured: true, results: [], error: "Searching too fast - give it a moment." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  const key = process.env.YOUTUBE_API_KEY;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const videoId = url.searchParams.get("id")?.trim();

  /* A pasted link must resolve WITHOUT a key. This used to sit behind a single
     missing-key early return, so the "paste a link instead" fallback was itself
     gated on the very thing it was a fallback for, and pasting did nothing.
     oEmbed is public and needs no key; if even that fails, the id alone is
     enough for the IFrame player, so the track stays addable either way. */
  if (!key) {
    if (videoId) {
      return NextResponse.json({ configured: false, results: [await resolveWithoutKey(videoId)] });
    }
    return NextResponse.json({
      configured: false,
      results: [],
      message:
        "Free-text search needs a YouTube API key (add YOUTUBE_API_KEY to .env.local). Paste a YouTube link and it will resolve without one.",
    });
  }

  try {
    let ids: string[] = [];
    const snippets = new Map<string, YtSnippet>();

    if (videoId) {
      ids = [videoId];
    } else {
      if (!q) return NextResponse.json({ configured: true, results: [] });

      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("maxResults", "12");
      searchUrl.searchParams.set("videoEmbeddable", "true");
      searchUrl.searchParams.set("q", q);
      searchUrl.searchParams.set("key", key);

      const res = await fetch(searchUrl, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { configured: true, results: [], error: `YouTube search failed (${res.status}).` },
          { status: 502 }
        );
      }
      const json = (await res.json()) as { items?: YtSearchItem[] };
      for (const item of json.items ?? []) {
        const id = item.id?.videoId;
        if (!id) continue;
        ids.push(id);
        if (item.snippet) snippets.set(id, item.snippet);
      }
    }

    if (ids.length === 0) return NextResponse.json({ configured: true, results: [] });

    /* A second call, because search results carry no duration and the seek
       thread needs one before the first frame of playback. */
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,contentDetails");
    videosUrl.searchParams.set("id", ids.join(","));
    videosUrl.searchParams.set("key", key);

    const detailRes = await fetch(videosUrl, { cache: "no-store" });
    if (!detailRes.ok) {
      // a pasted link can still be resolved the keyless way
      if (videoId) {
        return NextResponse.json({ configured: true, results: [await resolveWithoutKey(videoId)] });
      }
      return NextResponse.json(
        { configured: true, results: [], error: `YouTube lookup failed (${detailRes.status}).` },
        { status: 502 }
      );
    }
    const detailJson = (await detailRes.json()) as { items?: YtVideoItem[] };

    const byId = new Map<string, YtVideoItem>();
    for (const item of detailJson.items ?? []) if (item.id) byId.set(item.id, item);

    const results: YoutubeHit[] = ids
      .map((id) => {
        const detail = byId.get(id);
        const snippet = detail?.snippet ?? snippets.get(id);
        if (!snippet) return null;
        return {
          videoId: id,
          title: snippet.title ?? "Untitled",
          channel: snippet.channelTitle ?? "Unknown artist",
          thumbnail: pickThumb(snippet),
          durationSeconds: parseDuration(detail?.contentDetails?.duration),
        };
      })
      .filter((hit): hit is YoutubeHit => hit !== null);

    if (results.length === 0 && videoId) {
      return NextResponse.json({ configured: true, results: [await resolveWithoutKey(videoId)] });
    }

    return NextResponse.json({ configured: true, results });
  } catch {
    if (videoId) {
      return NextResponse.json({ configured: true, results: [await resolveWithoutKey(videoId)] });
    }
    return NextResponse.json(
      { configured: true, results: [], error: "Could not reach YouTube." },
      { status: 502 }
    );
  }
}
