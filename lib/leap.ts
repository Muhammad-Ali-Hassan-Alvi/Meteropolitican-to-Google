import { Agent, ProxyAgent, fetch, type Dispatcher } from "undici";

export const LEAP_BASE_URL = "https://api.jobprogress.com/api/v3";

const proxyUri =
  process.env.LEAP_HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  "";

// Some consumer VPN/proxy endpoints terminate TLS with a cert Node won't trust.
const allowInsecureTls = process.env.LEAP_PROXY_INSECURE_TLS === "1";

// undici's 10s default is too tight for slow DNS on this network, and
// autoSelectFamily avoids stalling on a dead IPv6 route.
const connect = {
  rejectUnauthorized: !allowInsecureTls,
  timeout: 30_000,
};

let dispatcher: Dispatcher;

if (proxyUri) {
  dispatcher = new ProxyAgent({
    uri: proxyUri,
    requestTls: connect,
    connect,
  });
} else {
  dispatcher = new Agent({ connect, autoSelectFamily: true });
}

export const leapProxyInUse = proxyUri || null;

export async function leapFetch(path: string, init: RequestInit = {}) {
  const token = process.env.LEAP_API_TOKEN;

  if (!token) {
    throw new Error("LEAP_API_TOKEN is not set in .env.local");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  return fetch(`${LEAP_BASE_URL}${path}`, {
    ...init,
    headers,
    dispatcher,
  } as Parameters<typeof fetch>[1]);
}
