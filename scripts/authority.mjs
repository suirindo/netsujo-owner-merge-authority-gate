const token = process.env.APP_TOKEN;
const kind = process.env.AUTHORITY_KIND;
const repository = "suirindo/netsujo-orchestrator";
const prNumber = Number(process.env.PR_NUMBER);
const expectedBase = process.env.EXPECTED_BASE_SHA;
const expectedHead = process.env.EXPECTED_HEAD_SHA;
const expectedTree = process.env.EXPECTED_HEAD_TREE;
const appId = 5040840;
const actionsAppId = 15368;
if (!token || !["READY", "MERGE"].includes(kind)) throw new Error("AUTHORITY_INPUT_INVALID");
if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error("PR_NUMBER_INVALID");
const sha = /^[0-9a-f]{40}$/;
for (const [name, value] of [["base", expectedBase], ["head", expectedHead], ["tree", expectedTree]]) if (!sha.test(value ?? "")) throw new Error(`${name.toUpperCase()}_SHA_INVALID`);
async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "netsujo-owner-merge-authority-gate", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { throw new Error(`GITHUB_RESPONSE_UNDECODABLE:${method}:${path}:${response.status}`); }
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}:${method}:${path}:${json?.message ?? ""}`);
  return json;
}
const pr = await api(`/repos/${repository}/pulls/${prNumber}`);
if (pr.state !== "open") throw new Error("PR_NOT_OPEN");
if (pr.base?.ref !== "main" || pr.base?.sha !== expectedBase) throw new Error("BASE_MISMATCH");
if (pr.head?.sha !== expectedHead || pr.head?.repo?.full_name !== repository) throw new Error("HEAD_MISMATCH");
const commit = await api(`/repos/${repository}/git/commits/${expectedHead}`);
if (commit.tree?.sha !== expectedTree) throw new Error("TREE_MISMATCH");
const checkName = kind === "READY" ? "owner-ready-authority" : "owner-merge-authority";
const checks = await api(`/repos/${repository}/commits/${expectedHead}/check-runs?filter=latest&per_page=100`);
const own = checks.check_runs.filter((c) => c.name === checkName && c.app?.id === appId);
const priorSuccess = own.find((c) => c.status === "completed" && c.conclusion === "success");
if (kind === "READY") {
  if (priorSuccess) { console.log(JSON.stringify({ disposition: "ALREADY_AUTHORIZED", checkId: priorSuccess.id })); process.exit(0); }
  if (pr.draft !== true) throw new Error("READY_AUTHORITY_REQUIRES_DRAFT_PR");
  const created = await api(`/repos/${repository}/check-runs`, { method: "POST", body: { name: checkName, head_sha: expectedHead, status: "completed", conclusion: "success", external_id: `ready:${repository}:${prNumber}:${expectedBase}:${expectedHead}:${expectedTree}:${process.env.GITHUB_RUN_ID}`, output: { title: "Owner READY authority", summary: `Exact Owner-approved READY subject: PR #${prNumber}, base ${expectedBase}, head ${expectedHead}, tree ${expectedTree}.` } } });
  console.log(JSON.stringify({ disposition: "READY_AUTHORIZED", checkId: created.id }));
  process.exit(0);
}
if (pr.draft !== false) throw new Error("MERGE_AUTHORITY_REQUIRES_READY_PR");
const ready = checks.check_runs.find((c) => c.name === "owner-ready-authority" && c.app?.id === appId && c.status === "completed" && c.conclusion === "success");
if (!ready) throw new Error("OWNER_READY_AUTHORITY_MISSING");
const required = new Map([
  ["conformance", actionsAppId],
  ["classify-darwin-scope", actionsAppId],
  ["darwin-host-boundary", actionsAppId],
  ["review-accepted", actionsAppId],
]);
for (const [name, producer] of required) {
  const match = checks.check_runs.find((c) => c.name === name && c.app?.id === producer && c.head_sha === expectedHead && c.status === "completed" && c.conclusion === "success");
  if (!match) throw new Error(`REQUIRED_CHECK_MISSING:${name}`);
}
if (priorSuccess) {
  const readback = await api(`/repos/${repository}/pulls/${prNumber}`);
  if (readback.merged !== true || !readback.merge_commit_sha) throw new Error("OUTCOME_UNCERTAIN_EXISTING_AUTHORITY_SUCCESS");
  console.log(JSON.stringify({ disposition: "READBACK_COMMITTED", mergeCommitSha: readback.merge_commit_sha, checkId: priorSuccess.id }));
  process.exit(0);
}
const protection = await api(`/repos/${repository}/branches/main/protection`);
const ownerRequired = protection.required_status_checks?.checks?.some((c) => c.context === "owner-merge-authority" && c.app_id === appId);
if (protection.required_status_checks?.strict !== true || !ownerRequired) throw new Error("LIVE_ENFORCEMENT_NOT_REQUIRED");
const created = await api(`/repos/${repository}/check-runs`, { method: "POST", body: { name: checkName, head_sha: expectedHead, status: "completed", conclusion: "success", external_id: `merge:${repository}:${prNumber}:${expectedBase}:${expectedHead}:${expectedTree}:${process.env.GITHUB_RUN_ID}`, output: { title: "Owner MERGE authority", summary: `Exact Owner-approved MERGE subject: PR #${prNumber}, base ${expectedBase}, head ${expectedHead}, tree ${expectedTree}. One-shot App mutation follows immediately.` } } });
let mergeResponse;
try {
  mergeResponse = await api(`/repos/${repository}/pulls/${prNumber}/merge`, { method: "PUT", body: { sha: expectedHead, merge_method: "merge" } });
} catch (error) {
  const readback = await api(`/repos/${repository}/pulls/${prNumber}`);
  if (readback.merged === true && readback.merge_commit_sha) { console.log(JSON.stringify({ disposition: "COMMITTED_AFTER_MUTATION_ERROR", mergeCommitSha: readback.merge_commit_sha, checkId: created.id })); process.exit(0); }
  throw new Error(`OUTCOME_UNCERTAIN_NO_BLIND_RETRY:${error.message}`);
}
if (mergeResponse.merged !== true || !mergeResponse.sha) throw new Error(`MERGE_REJECTED:${mergeResponse.message ?? ""}`);
const merged = await api(`/repos/${repository}/pulls/${prNumber}`);
if (merged.merged !== true || merged.merge_commit_sha !== mergeResponse.sha) throw new Error("POST_MERGE_READBACK_MISMATCH");
const mergeCommit = await api(`/repos/${repository}/git/commits/${mergeResponse.sha}`);
const parents = (mergeCommit.parents ?? []).map((p) => p.sha);
if (parents.length !== 2 || parents[0] !== expectedBase || parents[1] !== expectedHead) throw new Error("MERGE_PARENT_MISMATCH");
console.log(JSON.stringify({ disposition: "COMMITTED", mergeCommitSha: mergeResponse.sha, checkId: created.id }));
