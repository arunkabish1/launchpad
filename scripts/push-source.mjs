import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...process.env, ...loadEnv() };
const pat = env.GITHUB_PAT || env.GH_PAT;
if (!pat) {
  console.error("GITHUB_PAT is not set in .env or the environment.");
  process.exit(1);
}

const OWNER = process.env.LAUNCHPAD_GITHUB_OWNER || "arunkabish1";
const REPO = process.env.LAUNCHPAD_GITHUB_REPO || "launchpad";

function gitignorePatterns() {
  const p = path.join(ROOT, ".gitignore");
  const lines = fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
  return lines;
}

function globToRe(pat) {
  let re = "";
  for (const ch of pat) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return re;
}

function isIgnored(relPath, patterns) {
  const relParts = relPath.split("/");
  for (const p of patterns) {
    const stripped = p.replace(/^\//, "");
    const dirOnly = p.endsWith("/");
    const base = dirOnly ? stripped.slice(0, -1) : stripped;
    const parts = base.split("/");

    if (!/[?*[]/.test(base)) {
      if (relParts.length >= parts.length) {
        let all = true;
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] !== relParts[i]) {
            all = false;
            break;
          }
        }
        if (all) return true;
      }
      continue;
    }

    const fullRe = new RegExp(`^${globToRe(stripped)}$`);
    if (fullRe.test(relPath)) return true;
    if (!stripped.includes("/")) {
      const segRe = new RegExp(`^${globToRe(stripped)}$`);
      if (relParts.some((s) => segRe.test(s))) return true;
    }
  }
  return false;
}

function collect() {
  const files = [];
  const patterns = gitignorePatterns();
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (rel === ".git") continue;
      if (isIgnored(rel, patterns)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const data = fs.readFileSync(full);
        files.push({ path: rel, content: data.toString("base64") });
      }
    }
  };
  walk(ROOT, "");
  return files;
}

const octokit = new Octokit({ auth: pat });

async function main() {
  const files = collect();
  const totalBytes = files.reduce((n, f) => n + Buffer.byteLength(f.content, "base64"), 0);
  console.log(`Collected ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB decoded)`);

  let defaultBranch = "main";
  try {
    const { data: repo } = await octokit.rest.repos.get({ owner: OWNER, repo: REPO });
    defaultBranch = repo.default_branch;
    console.log(`Repo ${OWNER}/${REPO} exists (default branch ${defaultBranch}).`);
  } catch (err) {
    if (err.status !== 404) throw err;
    const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
      name: REPO,
      private: true,
      description: "Launchpad — deploy apps to Cloudflare from your browser",
      auto_init: false,
    });
    console.log(`Created repo ${OWNER}/${REPO}.`);
    defaultBranch = repo.default_branch;
  }

  const user = (await octokit.rest.users.getAuthenticated()).data;
  const author = { name: user.name || user.login, email: user.email || `${user.login}@users.noreply.github.com` };

  const blobs = [];
  const BATCH = 50;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const created = await Promise.all(
      batch.map((f) =>
        octokit.rest.git.createBlob({ owner: OWNER, repo: REPO, content: f.content, encoding: "base64" })
      )
    );
    created.forEach((res, j) => {
      blobs.push({ path: batch[j].path, mode: "100644", type: "blob", sha: res.data.sha });
    });
    console.log(`  blobs ${Math.min(i + BATCH, files.length)}/${files.length}`);
  }

  const { data: tree } = await octokit.rest.git.createTree({ owner: OWNER, repo: REPO, tree: blobs });

  let parentSha;
  try {
    const { data: ref } = await octokit.rest.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${defaultBranch}` });
    parentSha = ref.object.sha;
  } catch {
    parentSha = undefined;
  }

  const { data: commit } = await octokit.rest.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message: "Deploy Launchpad to Cloudflare Workers",
    tree: tree.sha,
    ...(parentSha ? { parents: [parentSha] } : {}),
    author,
    committer: author,
  });

  if (parentSha) {
    const { data: current } = await octokit.rest.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${defaultBranch}` });
    if (current.object.sha !== parentSha) {
      throw new Error("The default branch moved while pushing; re-run to retry.");
    }
  }

  await octokit.rest.git.updateRef({ owner: OWNER, repo: REPO, ref: `heads/${defaultBranch}`, sha: commit.sha, force: false });
  console.log(`Pushed to https://github.com/${OWNER}/${REPO} @ ${commit.sha}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
