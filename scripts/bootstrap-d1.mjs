import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB_NAME = "cloudflare_monitor_db";
const BINDING = "DB";
const WRANGLER_TOML = path.resolve(process.cwd(), "wrangler.toml");

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

function ensureDatabaseExists() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN is required for D1 bootstrap in non-interactive deploy environments.");
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
