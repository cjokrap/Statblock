import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigProblem } from "@/lib/config";

// Paths that work without signing in.
const PUBLIC_PATHS = ["/login"];

// Refresh the auth session on every request and send signed-out visitors
// to /login. Refreshed tokens are written to both the request (for the page
// about to render) and the response (for the browser).
export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const problem = supabaseConfigProblem(supabaseUrl, supabaseKey);
  if (problem) {
    console.error(`Statblock setup: ${problem}`);
    return setupErrorPage(problem, true);
  }

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    });

    // getClaims() verifies the JWT, so a forged cookie can't pass.
    const { data } = await supabase.auth.getClaims();
    const signedIn = Boolean(data?.claims?.sub);
    const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

    if (!signedIn && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (signedIn && request.nextUrl.pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  } catch (err) {
    console.error("Statblock: checking the sign-in session failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return setupErrorPage(`Checking your sign-in with Supabase failed: ${reason}`, false);
  }
}

function setupErrorPage(problem: string, isConfig: boolean) {
  const fix = isConfig
    ? "Fix it in Vercel under Settings → Environment Variables, then redeploy (Deployments → ⋯ → Redeploy). Variables only reach deployments made after they're saved."
    : "Check that NEXT_PUBLIC_SUPABASE_URL is your project's URL and that the Supabase project is running (not paused), then reload.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Statblock setup problem</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f3ede2;color:#1f1b16}
main{max-width:480px;margin:0 auto;padding:32px 20px}h1{font-size:22px}
p{line-height:1.5}.problem{background:#fbf8f2;border:1px solid #ddd2bf;border-radius:12px;padding:14px;font-weight:600}</style>
</head><body><main><h1>Statblock can't start</h1>
<p class="problem">${escapeHtml(problem)}</p><p>${escapeHtml(fix)}</p></main></body></html>`;
  return new NextResponse(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
