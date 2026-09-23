import crypto from "node:crypto";
const appId = process.env.APP_ID;
const installationId = process.env.INSTALLATION_ID;
const key = process.env.APP_PRIVATE_KEY;
if (!appId || !installationId || !key) throw new Error("APP_CONFIGURATION_REQUIRED");
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
const jwt = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "netsujo-owner-merge-authority-gate" },
});
if (!response.ok) throw new Error(`INSTALLATION_TOKEN_FAILED:${response.status}`);
const body = await response.json();
process.stdout.write(body.token);
