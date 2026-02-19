import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB_NAME = "cloudflare_monitor_db";
const BINDING = "DB";
const WRANGLER_TOML = path.resolve(process.cwd(), "wrangler.toml");
const PLACEHOLDER_DATABASE_ID = "REPLACE_WITH_YOUR_D1_DATABASE_ID";

function run(command) {
  try {
    return execSync(command, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const details = `${stdout}\n${stderr}`.replace(/\x1B\[[0-9;]*m/g, "").trim();
    throw new Error(`Command failed: ${command}\n${details}`);
  }
}

function getDatabaseIdByName(name) {
  const output = run("npx wrangler d1 list --json");
  const dbs = JSON.parse(output);
  const found = dbs.find((db) => db.name === name);
  return found?.uuid || null;
}

function getConfiguredDatabaseId() {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const sectionPattern = /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/g;

  for (const match of source.matchAll(sectionPattern)) {
    const section = match[0];
    if (!new RegExp(`binding\\s*=\\s*"${BINDING}"`).test(section)) {
      continue;
    }

    const idMatch = section.match(/database_id\s*=\s*"([^"]*)"/);
    if (!idMatch) {
      return null;
    }

    const databaseId = idMatch[1].trim();
    if (!databaseId || databaseId === PLACEHOLDER_DATABASE_ID) {
      return null;
    }

    return databaseId;
  }

  return null;
}

function ensureDatabaseExists() {
  const configuredDatabaseId = getConfiguredDatabaseId();
  if (configuredDatabaseId) {
    console.log(`Using existing D1 database_id from wrangler.toml: ${configuredDatabaseId}`);
    return configuredDatabaseId;
  }

  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN is required when wrangler.toml has no real D1 database_id and bootstrap needs to query/create D1.");
  }

  let databaseId = getDatabaseIdByName(DB_NAME);
  if (databaseId) {
    return databaseId;
  }

  console.log(`D1 database \"${DB_NAME}\" not found, creating...`);
  execSync(`npx wrangler d1 create ${DB_NAME}`, { stdio: "inherit" });

  databaseId = getDatabaseIdByName(DB_NAME);
  if (!databaseId) {
    throw new Error(`Failed to resolve UUID for D1 database \"${DB_NAME}\" after creation.`);
  }

  return databaseId;
}

function updateWranglerToml(databaseId) {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const sectionPattern = /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/g;
  let matched = false;

  const updated = source.replace(sectionPattern, (section) => {
    if (!new RegExp(`binding\\s*=\\s*\"${BINDING}\"`).test(section)) {
      return section;
    }

    matched = true;

    if (/database_id\s*=\s*"[^"]*"/.test(section)) {
      return section.replace(/database_id\s*=\s*"[^"]*"/, `database_id = \"${databaseId}\"`);
    }

    const sectionWithoutTrailingSpaces = section.replace(/\s*$/, "");
    return `${sectionWithoutTrailingSpaces}\ndatabase_id = \"${databaseId}\"\n`;
  });

  if (!matched) {
    throw new Error(`Could not find [[d1_databases]] section with binding \"${BINDING}\" in wrangler.toml.`);
  }

  if (updated !== source) {
    writeFileSync(WRANGLER_TOML, updated, "utf8");
    console.log(`Updated wrangler.toml with D1 database_id: ${databaseId}`);
  } else {
    console.log("wrangler.toml already has the correct D1 database_id.");
  }
}

const databaseId = ensureDatabaseExists();
updateWranglerToml(databaseId);
