/**
 * Keeps server.json's version in lockstep with package.json.
 *
 * The official MCP Registry requires the `version` in server.json (and in its npm package
 * entry) to match the published package version — a mismatch fails `mcp-publisher publish`.
 * That is a silent, publish-time footgun of exactly the kind this project avoids, so it is
 * automated rather than remembered: package.json's `version` npm-lifecycle script runs this,
 * and `git add`s the result, so `npm version patch` bumps both in one commit.
 *
 * Run manually with: node scripts/sync-server-json.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkgPath = fileURLToPath(new URL('package.json', root));
const serverPath = fileURLToPath(new URL('server.json', root));

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const server = JSON.parse(readFileSync(serverPath, 'utf8'));

const version = pkg.version;
let changed = false;

if (server.version !== version) {
  server.version = version;
  changed = true;
}
for (const entry of server.packages ?? []) {
  if (entry.version !== version) {
    entry.version = version;
    changed = true;
  }
}

// The registry ties the npm package to this server via matching names; guard it here too so
// a rename of one without the other cannot slip through.
if (server.name !== pkg.mcpName) {
  throw new Error(
    `server.json name "${server.name}" does not match package.json mcpName "${pkg.mcpName}"`,
  );
}
if (server.packages?.[0]?.identifier !== pkg.name) {
  throw new Error(
    `server.json package identifier "${server.packages?.[0]?.identifier}" does not match ` +
      `package.json name "${pkg.name}"`,
  );
}

if (changed) {
  writeFileSync(serverPath, JSON.stringify(server, null, 2) + '\n');
  process.stderr.write(`synced server.json -> version ${version}\n`);
} else {
  process.stderr.write(`server.json already at version ${version}\n`);
}
