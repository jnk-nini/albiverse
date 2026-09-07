import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* ============================================================================
   SESSION REFRESH  (proxy.ts, not middleware.ts)

   Next 16 deprecated the `middleware` file convention and renamed it to
   `proxy` — same behaviour, different file and export name. See
   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.

   `src/lib/supabase/server.ts` has always carried the comment "This can be
   ignored if you have middleware refreshing user sessions" — but there was no
   middleware. Without it nothing ever renews the auth cookie on a server
   request, so a Supabase access token that expired while the app was closed is
   only repaired if a client component happens to boot and refresh it. The
   server components (Ch.01, Ch.02, Ch.03) call `auth.getUser()` before that
   can happen, see no valid session, and `redirect("/")` — dropping the reader
   back on the login form even though their refresh token was still perfectly
   good.

   Being bounced to the login form is also what surfaces the browser's own
   password machinery. On Edge, focusing a password field with a Microsoft
   account attached is what raises the full Outlook/Microsoft sign-in page.
   Nothing in this app can suppress that prompt (it isn't ours to suppress),
   but staying signed in means the form — and therefore the prompt — stops
   coming up in the first place.

   `getClaims()` is what does the work: it validates the token and, when it is
   past its lifetime, spends the refresh token and writes the new cookies onto
   the response below.
   ========================================================================= */

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  /* Do not put anything between creating the client and this call: it is what
     refreshes the token, and any early return in between ships a response
     without the renewed cookies on it. */
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /* Everything except Next's own build output, the generated icons and the
       plain static files — none of which need a session, and all of which
       would otherwise pay for an auth round-trip they never use. */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/keepalive|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ico)$).*)",
  ],
};
