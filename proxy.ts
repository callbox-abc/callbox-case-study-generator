import { NextRequest, NextResponse } from "next/server";

// App-wide login (HTTP Basic Auth) for every page AND every /api route.
// Credentials come from server-only env vars; they never reach the browser bundle.
//   DRAFT_USER / DRAFT_PS   shared login for the team (not the WordPress credentials)
// Fails closed: if either var is missing, nothing is served.

function safeEqual(a: string, b: string): boolean {
  // Constant-time compare so response timing does not leak how much of a guess matched.
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const user = process.env.DRAFT_USER;
  const pass = process.env.DRAFT_PS;

  if (!user || !pass) {
    return new NextResponse("Login is not configured. Set DRAFT_USER and DRAFT_PS in Vercel and redeploy.", {
      status: 503,
    });
  }

  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      if (sep !== -1 && safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), pass)) {
        return NextResponse.next();
      }
    } catch {
      // malformed header falls through to 401
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Callbox Case Study Generator", charset="UTF-8"' },
  });
}

// Everything except Next.js static assets and the favicon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
