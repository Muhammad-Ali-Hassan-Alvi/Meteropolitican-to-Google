import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leapFetch, leapProxyInUse } from "@/lib/leap";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return relay(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  return relay(request, context, await request.text());
}

async function relay(request: NextRequest, context: Context, body?: string) {
  const denial = checkAccess(request);
  if (denial) return denial;

  const { path } = await context.params;

  // Forward the caller's query string, minus our own auth param.
  const search = new URLSearchParams(request.nextUrl.searchParams);
  search.delete("key");

  const query = search.size ? `?${search}` : "";
  const target = `/${path.map(encodeURIComponent).join("/")}${query}`;

  try {
    const response = await leapFetch(target, {
      method: request.method,
      body,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    });

    const server = response.headers.get("server") ?? "";
    const text = await response.text();

    if (response.status === 403 && server.startsWith("awselb")) {
      return NextResponse.json(
        {
          error: "Blocked by the JobProgress edge before reaching the API",
          hint: "This server's egress IP is on the WAF blocklist. Redeploy to another region or route through a proxy.",
          proxy: leapProxyInUse ?? "none",
        },
        { status: 502 },
      );
    }

    // Pass the upstream status through so Make can branch on it.
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    console.error(err);

    const cause = err instanceof Error ? err.cause : undefined;

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        cause: cause instanceof Error ? cause.message : cause,
      },
      { status: 502 },
    );
  }
}

// This relay calls JobProgress with a real token, so a public deployment URL
// must not be callable by anyone who stumbles across it.
function checkAccess(request: NextRequest) {
  const expected = process.env.LEAP_TEST_KEY;

  if (!expected) {
    if (!process.env.VERCEL) return null;

    return NextResponse.json(
      { error: "LEAP_TEST_KEY must be set on hosted deployments" },
      { status: 500 },
    );
  }

  const provided =
    request.headers.get("x-test-key") ?? request.nextUrl.searchParams.get("key");

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
