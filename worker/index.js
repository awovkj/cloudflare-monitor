const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const DAYS_QUERY = `
query($zone: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: {zoneTag: $zone}) {
      httpRequests1dGroups(
        filter: {date_geq: $since, date_leq: $until}
        limit: 100
        orderBy: [date_DESC]
      ) {
        dimensions { date }
        sum {
          requests
          bytes
          threats
          cachedRequests
          cachedBytes
        }
      }
    }
  }
}`;

const HOURS_QUERY = `
query($zone: String!, $since: Time!, $until: Time!) {
  viewer {
    zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(
        filter: {datetime_geq: $since, datetime_leq: $until}
        limit: 200
        orderBy: [datetime_DESC]
      ) {
        dimensions { datetime }
        sum {
          requests
          bytes
          threats
          cachedRequests
          cachedBytes
        }
      }
    }
  }
}`;

const GEO_QUERY = `
query($zone: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: {zoneTag: $zone}) {
      httpRequests1dGroups(
        filter: {date_geq: $since, date_leq: $until}
        limit: 100
        orderBy: [date_DESC]
      ) {
        sum {
          countryMap {
            bytes
            requests
            threats
            clientCountryName
          }
        }
      }
    }
  }
}`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ status: "ok", timestamp: new Date().toISOString() });
    }

    if (path === "/api/status") {
      const latest = await getLatestSnapshot(env.DB);
      const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM analytics_snapshots").first();
      return json({
        status: "running",
        snapshots: Number(countRow?.count || 0),
        hasData: Boolean(latest),
        lastUpdatedAt: latest?.createdAt || null,
        timestamp: new Date().toISOString()
      });
    }

    if (path === "/api/refresh" && request.method === "POST") {
      try {
        const payload = await refreshAndStore(env);
        return json({ status: "ok", accounts: payload.accounts?.length || 0 });
      } catch (error) {
        return json({ status: "error", message: error.message }, 500);
      }
    }

    if (path === "/api/analytics" || path === "/data/analytics.json") {
      try {
        const forceRefresh = url.searchParams.get("refresh") === "1";

        if (forceRefresh) {
          const payload = await refreshAndStore(env);
          return json(payload);
        }

        const latest = await getLatestSnapshot(env.DB);
        if (latest) {
          return json(latest.payload);
        }

        const payload = await refreshAndStore(env);
        return json(payload);
      } catch (error) {
        return json({ accounts: [], error: error.message }, 500);
      }
    }

    return serveAssets(request, env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshAndStore(env));
  }
};

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) {
    return response;
  }

  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (!acceptsHtml) {
    return response;
  }

  const url = new URL(request.url);
  const indexRequest = new Request(new URL("/index.html", url), request);
  return env.ASSETS.fetch(indexRequest);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

async function getLatestSnapshot(db) {
  const row = await db
    .prepare("SELECT created_at, payload FROM analytics_snapshots ORDER BY id DESC LIMIT 1")
    .first();

  if (!row) {
    return null;
  }

  return {
    createdAt: row.created_at,
    payload: JSON.parse(row.payload)
  };
}

async function refreshAndStore(env) {
  const config = loadConfig(env);
  const payload = await fetchAnalyticsPayload(config);

  await env.DB
    .prepare("INSERT INTO analytics_snapshots (payload) VALUES (?)")
    .bind(JSON.stringify(payload))
    .run();

  return payload;
}

function loadConfig(env) {
  if (env.CF_CONFIG) {
    const parsed = JSON.parse(env.CF_CONFIG);
    validateConfig(parsed);
    return parsed;
  }

  const accounts = [];

  if (hasLegacyAccountConfig(env, "")) {
    accounts.push(buildAccountFromLegacyEnv(env, "", "默认账户"));
  }

  let i = 1;
  while (hasLegacyAccountConfig(env, `_${i}`)) {
    const fallbackName = `账户${i}`;
    const account = buildAccountFromLegacyEnv(env, `_${i}`, fallbackName);
    accounts.push(account);
    i += 1;
  }

  if (accounts.length === 0) {
    throw new Error("No Cloudflare account configuration found");
  }

  const parsed = { accounts };
  validateConfig(parsed);
  return parsed;
}

function getFirstEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function parseList(value) {
  return (value || "")
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function hasLegacyAccountConfig(env, suffix) {
  const token = getFirstEnvValue(env, [`CF_TOKENS${suffix}`, `CF_TOKEN${suffix}`]);
  const zones = getFirstEnvValue(env, [`CF_ZONES${suffix}`, `CF_ZONE_IDS${suffix}`, `CF_ZONE${suffix}`]);
  return Boolean(token && zones);
}

function buildAccountFromLegacyEnv(env, suffix, fallbackName) {
  const token = getFirstEnvValue(env, [`CF_TOKENS${suffix}`, `CF_TOKEN${suffix}`]);
  const zonesValue = getFirstEnvValue(env, [`CF_ZONES${suffix}`, `CF_ZONE_IDS${suffix}`, `CF_ZONE${suffix}`]);
  const domainsValue = getFirstEnvValue(env, [`CF_DOMAINS${suffix}`, `CF_DOMAIN${suffix}`]);
  const accountNameKey = `CF_ACCOUNT_NAME${suffix}`;

  const zoneIds = parseList(zonesValue);
  const domains = parseList(domainsValue);

  return {
    name: env[accountNameKey] || fallbackName,
    token,
    zones: zoneIds.map((zoneId, idx) => ({
      zone_id: zoneId,
      domain: domains[idx] || zoneId
    }))
  };
}

function validateConfig(config) {
  if (!config?.accounts || !Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error("CF_CONFIG must include at least one account");
  }

  config.accounts.forEach((account) => {
    if (!account.name || !account.token || !Array.isArray(account.zones) || account.zones.length === 0) {
      throw new Error("Each account requires name, token and zones");
    }

    account.zones.forEach((zone) => {
      if (!zone.zone_id || !zone.domain) {
        throw new Error("Each zone requires zone_id and domain");
      }
    });
  });
}

async function fetchAnalyticsPayload(config) {
  const payload = { accounts: [] };

  for (const account of config.accounts) {
    const accountData = {
      name: account.name,
      zones: []
    };

    for (const zone of account.zones) {
      const zoneData = await fetchZoneAnalytics(account.token, zone);
      accountData.zones.push(zoneData);
    }

    payload.accounts.push(accountData);
  }

  return payload;
}

async function fetchZoneAnalytics(token, zone) {
  const daysSince = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const daysUntil = new Date().toISOString().slice(0, 10);
  const hoursSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const hoursUntil = new Date().toISOString();

  const today = new Date().toISOString().slice(0, 10);

  const [daysRes, hoursRes, geoRes] = await Promise.all([
    callCloudflareGraphql(token, DAYS_QUERY, {
      zone: zone.zone_id,
      since: daysSince,
      until: daysUntil
    }),
    callCloudflareGraphql(token, HOURS_QUERY, {
      zone: zone.zone_id,
      since: hoursSince,
      until: hoursUntil
    }),
    callCloudflareGraphql(token, GEO_QUERY, {
      zone: zone.zone_id,
      since: today,
      until: today
    })
  ]);

  const dailyGroups = daysRes?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const hourlyGroups = hoursRes?.data?.viewer?.zones?.[0]?.httpRequests1hGroups || [];
  const geoGroups = geoRes?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];

  return {
    domain: zone.domain,
    raw: dailyGroups,
    rawHours: hourlyGroups,
    geography: aggregateGeography(geoGroups)
  };
}

async function callCloudflareGraphql(token, query, variables) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Cloudflare API request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0]?.message || "Cloudflare GraphQL query failed");
  }

  return data;
}

function aggregateGeography(rawGeoGroups) {
  const map = new Map();

  for (const group of rawGeoGroups) {
    const countryMap = group?.sum?.countryMap;
    if (!Array.isArray(countryMap)) {
      continue;
    }

    for (const countryData of countryMap) {
      const country = countryData?.clientCountryName;
      if (!country || country === "Unknown") {
        continue;
      }

      const prev = map.get(country) || {
        dimensions: { clientCountryName: country },
        sum: { requests: 0, bytes: 0, threats: 0 }
      };

      prev.sum.requests += countryData.requests || 0;
      prev.sum.bytes += countryData.bytes || 0;
      prev.sum.threats += countryData.threats || 0;

      map.set(country, prev);
    }
  }

  return [...map.values()].sort((a, b) => b.sum.requests - a.sum.requests).slice(0, 15);
}
