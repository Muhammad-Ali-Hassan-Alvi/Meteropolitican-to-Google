import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leapFetch, leapProxyInUse } from "@/lib/leap";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denial = checkAccess(request);
  if (denial) return denial;

  const jobId = request.nextUrl.searchParams.get("jobId") ?? "8053891";

  try {
    const response = await leapFetch(`/jobs/${encodeURIComponent(jobId)}`);

    const server = response.headers.get("server") ?? "";
    const body = await response.text();

    // A 403 straight from the AWS load balancer means the request never reached
    // JobProgress: the edge is refusing this egress IP, so the token is irrelevant.
    if (response.status === 403 && server.startsWith("awselb")) {
      return NextResponse.json(
        {
          status: 403,
          blockedAtEdge: true,
          proxy: leapProxyInUse ?? "none",
          hint: "AWS blocked this IP before the API saw the request. Route the call through an allowed egress IP (VPN/proxy) or ask JobProgress to allowlist it.",
          body,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: response.status,
      proxy: leapProxyInUse ?? "none",
      body: safeJson(body),
    });
  } catch (err) {
    console.error(err);

    // undici collapses connection failures into a bare "fetch failed"; the
    // cause carries the DNS/TLS detail that actually explains it.
    const cause = err instanceof Error ? err.cause : undefined;

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        cause: cause instanceof Error ? cause.message : cause,
        proxy: leapProxyInUse ?? "none",
      },
      { status: 500 },
    );
  }
}

// This route calls JobProgress with a real token, so a public deployment URL
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

function safeJson(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
