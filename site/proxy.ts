import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./server/supabase.ts";

// Keeps the Supabase session alive: an expired access token is exchanged for a
// new one here, where the refreshed cookies can be written to the response.
// Server components cannot write cookies, so without this a session would end
// with its first access token. It makes no access decision; pages and routes
// verify the user themselves.
export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // A sign-in link whose redirect target was not allow-listed lands on the
  // site root with its one-time code. Hand it to the callback route.
  if (url.pathname === "/" && url.searchParams.has("code")) {
    const callback = url.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }
  const config = supabaseConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Pages and the signed-in API. Static assets and the bearer-secret refresh
  // routes carry no session.
  matcher: ["/((?!_next/|api/admin/|api/cron/|api/health|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2|webmanifest|txt)$).*)"],
};
