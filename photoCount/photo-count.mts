#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lifeListFile = path.join(repositoryRoot, "ebird_world_life_list.csv");
const resultsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "photo-count-results.json");
const userId = process.env.EBIRD_USER_ID ?? "USER3644381";
const photoStatsUrl = "https://ebird.org/ml-search-api/v2/stats/obs";
const taxonomyUrl = "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json";

function log(message: string): void {
  console.log(`[photo-count ${new Date().toISOString()}] ${message}`);
}

type LifeListBird = {
  commonName: string;
  scientificName: string;
};

type TaxonomyBird = LifeListBird & {
  speciesCode: string;
  category: string;
};

type RawTaxonomyBird = {
  speciesCode: string;
  comName: string;
  sciName: string;
  category: string;
};

type PhotoResult = LifeListBird & {
  speciesCode: string | null;
  userCountsWithPhoto: number | null;
  error?: string;
};

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
};

class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  addFromHeader(setCookie: string, url: URL): void {
    const parts = setCookie.split(";").map((part) => part.trim());
    const separator = parts[0].indexOf("=");
    if (separator < 1) return;

    const name = parts[0].slice(0, separator);
    const value = parts[0].slice(separator + 1);
    let domain = url.hostname;
    let cookiePath = "/";
    let secure = false;

    for (const attribute of parts.slice(1)) {
      const [rawName, ...rawValue] = attribute.split("=");
      const attributeName = rawName.toLowerCase();
      if (attributeName === "domain" && rawValue.length > 0) {
        domain = rawValue.join("=").replace(/^\./, "");
      } else if (attributeName === "path" && rawValue.length > 0) {
        cookiePath = rawValue.join("=");
      } else if (attributeName === "secure") {
        secure = true;
      }
    }

    const key = `${name};${domain};${cookiePath}`;
    this.cookies.set(key, { name, value, domain, path: cookiePath, secure });
  }

  addCookieHeader(cookieHeader: string, url: URL): void {
    for (const pair of cookieHeader.split(";")) {
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(`${pair.slice(0, separator).trim()};${url.hostname};/`, {
          name: pair.slice(0, separator).trim(),
          value: pair.slice(separator + 1).trim(),
          domain: url.hostname,
          path: "/",
          secure: false,
        });
      }
    }
  }

  getHeader(url: URL): string | undefined {
    const matchingCookies = [...this.cookies.values()].filter((cookie) =>
      (url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`)) &&
      url.pathname.startsWith(cookie.path) &&
      (!cookie.secure || url.protocol === "https:")
    );
    return matchingCookies.length > 0
      ? matchingCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
      : undefined;
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function loadLifeList(csv: string): LifeListBird[] {
  const rows = csv.split(/\r?\n/).filter((row) => row.trim());
  return [...new Map(
    rows.slice(1)
      .map(parseCsvLine)
      .filter((columns) => columns[2] === "species" && columns[3])
      .map((columns) => [columns[3], {
        commonName: columns[3],
        scientificName: columns[4],
      }])
  ).values()];
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  log(`Fetching ${url} (redirects: follow)`);
  const cookieJar = new CookieJar();
  const initialUrl = new URL(url);
  if (headers.Cookie) {
    cookieJar.addCookieHeader(headers.Cookie, initialUrl);
  }

  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    const requestHeaders = { ...headers };
    const cookieHeader = cookieJar.getHeader(currentUrl);
    if (cookieHeader) requestHeaders.Cookie = cookieHeader;
    else delete requestHeaders.Cookie;

    let response: Response;
    try {
      response = await fetch(currentUrl, { method: "GET", headers: requestHeaders, redirect: "manual" });
    } catch (error) {
      const cause = error instanceof Error && error.cause ? `; cause: ${String(error.cause)}` : "";
      throw new Error(`Fetch failed for ${currentUrl}: ${error instanceof Error ? error.message : String(error)}${cause}`);
    }

    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const setCookie of setCookies) cookieJar.addFromHeader(setCookie, currentUrl);
    log(`Received ${response.status} ${response.statusText} from ${currentUrl}${setCookies.length ? ` (${setCookies.length} cookies)` : ""}`);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect (${response.status}) did not include a Location header`);
      if (redirectCount === 10) throw new Error("Too many redirects");
      currentUrl = new URL(location, currentUrl);
      log(`Following redirect ${redirectCount + 1} to ${currentUrl}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Request failed (${response.status} ${response.statusText})`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    log(`Response content type: ${contentType || "unknown"}`);
    if (!contentType.includes("json")) {
      throw new Error(`Expected JSON but received ${contentType || "an unknown content type"}`);
    }
    const body = await response.json();
    log("Decoded JSON response");
    return body;
  }

  throw new Error("Request ended without a response");
}

async function loadTaxonomy(): Promise<TaxonomyBird[]> {
  log(`Loading eBird taxonomy (API key: ${process.env.EBIRD_API_KEY ? "set" : "not set"}; cookie: ${process.env.EBIRD_COOKIE ? "set" : "not set"})`);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.EBIRD_API_KEY) {
    headers["X-eBirdApiToken"] = process.env.EBIRD_API_KEY;
  }
  if (process.env.EBIRD_COOKIE) {
    headers.Cookie = process.env.EBIRD_COOKIE;
  }

  const taxonomy = await fetchJson(taxonomyUrl, headers);
  if (!Array.isArray(taxonomy)) {
    throw new Error("eBird taxonomy response was not an array");
  }
  const normalizedTaxonomy = taxonomy.filter((bird): bird is RawTaxonomyBird =>
    typeof bird === "object" && bird !== null &&
    typeof (bird as RawTaxonomyBird).speciesCode === "string" &&
    typeof (bird as RawTaxonomyBird).comName === "string" &&
    typeof (bird as RawTaxonomyBird).sciName === "string"
  ).map((bird) => ({
    commonName: bird.comName,
    scientificName: bird.sciName,
    speciesCode: bird.speciesCode,
    category: bird.category,
  }));
  log(`Loaded ${normalizedTaxonomy.length} taxonomy entries`);
  return normalizedTaxonomy;
}

async function getPhotoCount(speciesCode: string): Promise<number> {
  const url = new URL(photoStatsUrl);
  url.searchParams.set("speciesCode", speciesCode);
  url.searchParams.set("userId", userId);
  url.searchParams.set("continue", "");

  const headers: Record<string, string> = {
    Accept: "application/json",
    Referer: "https://ebird.org/",
  };
  if (process.env.EBIRD_COOKIE) {
    headers.Cookie = process.env.EBIRD_COOKIE;
  }

  const response = await fetchJson(url.toString(), headers);
  if (typeof response !== "object" || response === null ||
      typeof (response as { userCountsWithPhoto?: unknown }).userCountsWithPhoto !== "number") {
    throw new Error("Response did not contain a numeric userCountsWithPhoto value");
  }
  return (response as { userCountsWithPhoto: number }).userCountsWithPhoto;
}

log(`Reading life list from ${lifeListFile}`);
const lifeList = loadLifeList(await readFile(lifeListFile, "utf8"));
log(`Loaded ${lifeList.length} unique species from life list`);
let taxonomy: TaxonomyBird[];
try {
  taxonomy = await loadTaxonomy();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`Taxonomy stage failed: ${message}`);
  const report = {
    generatedAt: new Date().toISOString(),
    userId,
    lifeListSpecies: lifeList.length,
    speciesWithNoPhoto: [],
    mostPhotographed: [],
    results: [],
    error: `Could not load eBird taxonomy: ${message}`,
  };
  await writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
  throw new Error(`${report.error}. Check your network connection and eBird availability.`);
}
const byCommonName = new Map(taxonomy.map((bird) => [bird.commonName, bird]));
const byScientificName = new Map(taxonomy.map((bird) => [bird.scientificName, bird]));
const results: PhotoResult[] = [];
log("Starting photo-count requests");

for (const bird of lifeList) {
  const taxonomyBird = byCommonName.get(bird.commonName) ?? byScientificName.get(bird.scientificName);
  if (!taxonomyBird) {
    log(`No taxonomy match for ${bird.commonName}`);
    results.push({ ...bird, speciesCode: null, userCountsWithPhoto: null, error: "Species code not found in eBird taxonomy" });
    continue;
  }

  try {
    log(`Requesting photo count for ${bird.commonName} (${taxonomyBird.speciesCode})`);
    const userCountsWithPhoto = await getPhotoCount(taxonomyBird.speciesCode);
    results.push({ ...bird, speciesCode: taxonomyBird.speciesCode, userCountsWithPhoto });
    console.log(`${bird.commonName}: ${userCountsWithPhoto}`);
  } catch (error) {
    results.push({
      ...bird,
      speciesCode: taxonomyBird.speciesCode,
      userCountsWithPhoto: null,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`${bird.commonName}: ${results.at(-1)?.error}`);
  }
}

const successfulResults = results.filter((bird) => bird.userCountsWithPhoto !== null);
const report = {
  generatedAt: new Date().toISOString(),
  userId,
  lifeListSpecies: lifeList.length,
  speciesWithNoPhoto: successfulResults.filter((bird) => bird.userCountsWithPhoto === 0),
  mostPhotographed: [...successfulResults]
    .sort((first, second) => (second.userCountsWithPhoto ?? 0) - (first.userCountsWithPhoto ?? 0)),
  results,
};

await writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
log(`Wrote ${resultsFile}`);
console.log(`Species with no photo: ${report.speciesWithNoPhoto.length}`);