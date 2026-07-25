import { readFileSync } from "node:fs";
import { ProxyAgent, Agent, fetch } from "undici";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const proxy = process.env.LEAP_HTTP_PROXY || process.env.HTTPS_PROXY || "";
const insecure = process.env.LEAP_PROXY_INSECURE_TLS === "1";

const dispatcher = proxy
  ? new ProxyAgent({ uri: proxy, requestTls: { rejectUnauthorized: !insecure } })
  : new Agent({ connect: { rejectUnauthorized: !insecure } });

const ip = await fetch("https://ipinfo.io/json", { dispatcher }).then((r) => r.json());
console.log(`proxy:  ${proxy || "none (direct)"}`);
console.log(`egress: ${ip.ip} (${ip.city}, ${ip.country})`);

const res = await fetch("https://api.jobprogress.com/api/v3/jobs/8053891", {
  dispatcher,
  headers: {
    Authorization: `Bearer ${process.env.LEAP_API_TOKEN}`,
    Accept: "application/json",
  },
});

console.log(`status: ${res.status}  server: ${res.headers.get("server")}`);

if (res.status === 403 && (res.headers.get("server") ?? "").startsWith("awselb")) {
  console.log("\nBlocked by the AWS edge before reaching JobProgress.");
  console.log(`Egress IP ${ip.ip} is not allowed. The token is not the problem.`);
} else {
  console.log(`\n${await res.text()}`);
}
