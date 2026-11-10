import https from "https";
import fs from "fs";
import path from "path";

const API_ROOT = "https://api.ebird.org/v2";
const DAYS_BACK = 7;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// Serverless function handler
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Get API key from environment variable
    const API_KEY = process.env.EBIRD_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'EBIRD_API_KEY not configured' });
    }

    // Get location from query params or use default
    const lat = req.query.lat || "39.95";
    const lng = req.query.lng || "-82.99";
    const dist = req.query.dist || "50";
    const listType = req.query.listType || "life"; // 'life' or 'year'
    // Species codes the user has already checked off on the client
    const excludeCodes = new Set(
      (req.query.exclude || "").split(",").map((c) => c.trim()).filter(Boolean)
    );

    const requestOptions = {
      method: "GET",
      redirect: "follow",
      headers: { "x-ebirdapitoken": API_KEY },
      agent: httpsAgent,
    };

    // Load life/year list from CSV - use process.cwd() to get project root
    const csvFileName = listType === 'year' ? 'ebird_world_year_list.csv' : 'ebird_world_life_list.csv';
    const lifeListCsvPath = path.join(process.cwd(), csvFileName);
    let lifeListData = [];
    
    try {
      if (fs.existsSync(lifeListCsvPath)) {
        const csvContent = fs.readFileSync(lifeListCsvPath, "utf-8");
        lifeListData = parseLifeListCsv(csvContent);
        console.log(`Loaded ${lifeListData.length} species from ${listType} list`);
      } else {
        console.warn(`${listType} list CSV not found at: ${lifeListCsvPath}`);
      }
    } catch (error) {
      console.error(`Error reading ${listType} list:`, error);
    }

    const lifeListSpecies = new Set(lifeListData.map((bird) => bird.commonName));

    // Fetch recent observations
    const recentObservations = await recentObservationsNearby(
      lat,
      lng,
      dist,
      DAYS_BACK,
      requestOptions
    );

    if (!recentObservations) {
      return res.status(500).json({ error: 'Failed to fetch observations' });
    }

    // Filter to find species NOT on life list and not already checked off
    const needs = recentObservations.filter(
      (obs) => !lifeListSpecies.has(obs.comName) && !excludeCodes.has(obs.speciesCode)
    );

    // Get unique species codes
    const uniqueSpeciesCodes = [...new Set(needs.map(obs => obs.speciesCode))];

    // Fetch all observations for each species
    const allObservations = [];
    let requestCount = 1; // includes the recentObservationsNearby request
    let warning = null;
    for (const [index, speciesCode] of uniqueSpeciesCodes.entries()) {
      let speciesObs;
      try {
        requestCount++;
        speciesObs = await recentSpeciesObservations(
          speciesCode,
          lat,
          lng,
          dist,
          DAYS_BACK,
          requestOptions
        );
      } catch (error) {
        if (!(error instanceof EbirdApiError)) throw error;
        const progress = `${index} of ${uniqueSpeciesCodes.length} species`;
        console.warn(
          `${error.name} on request #${requestCount}: HTTP ${error.status} ` +
          `(${progress} fetched, listType=${listType}, lat=${lat}, lng=${lng}, dist=${dist})`
        );
        if (error instanceof RateLimitError) {
          warning = `eBird rate limit reached: only ${progress} were loaded. Results are incomplete.`;
        } else if (error instanceof EbirdServerError) {
          warning = `eBird server error (HTTP ${error.status}): only ${progress} were loaded. Results are incomplete.`;
        } else {
          warning = `eBird rejected a request (HTTP ${error.status}): only ${progress} were loaded. Results are incomplete.`;
        }
        break;
      }
      if (speciesObs && speciesObs.length > 0) {
        allObservations.push(...speciesObs);
      }
    }

    // Group by location ID (not name, to avoid combining different locations with same name)
    const byLocation = allObservations.reduce((acc, obs) => {
      const locId = obs.locId;
      if (!acc[locId]) {
        acc[locId] = [];
      }
      acc[locId].push(obs);
      return acc;
    }, {});

    // Calculate distance and prepare locations
    const locationsWithDistance = Object.entries(byLocation).map(([locId, observations]) => {
      const distance = calculateDistance(
        parseFloat(lat),
        parseFloat(lng),
        observations[0].lat,
        observations[0].lng
      );
      return { locId, observations, distance };
    });

    // Sort by observation count, then distance
    const sortedLocations = locationsWithDistance.sort((a, b) => {
      const countDiff = b.observations.length - a.observations.length;
      if (countDiff !== 0) return countDiff;
      return a.distance - b.distance;
    });

    // Generate response data
    const mapData = {
      home: {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
      },
      locations: sortedLocations.map(({ locId, observations, distance }) => ({
        name: observations[0].locName || locId,
        lat: observations[0].lat,
        lng: observations[0].lng,
        locId: locId,
        distance: parseFloat(distance.toFixed(1)),
        speciesCount: observations.length,
        species: observations.map((obs) => ({
          commonName: obs.comName,
          speciesCode: obs.speciesCode,
          count: obs.howMany || "?",
          date: obs.obsDt,
          subId: obs.subId
        })),
      })),
      warning,
    };

    res.status(200).json(mapData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Helper functions
class EbirdApiError extends Error {
  constructor(message, status, url) {
    super(`${message} (HTTP ${status}): ${url}`);
    this.name = 'EbirdApiError';
    this.status = status;
  }
}

class RateLimitError extends EbirdApiError {
  constructor(status, url) {
    super('eBird rate limit exceeded', status, url);
    this.name = 'RateLimitError';
  }
}

class EbirdClientError extends EbirdApiError {
  constructor(status, url) {
    super('eBird request rejected', status, url);
    this.name = 'EbirdClientError';
  }
}

class EbirdServerError extends EbirdApiError {
  constructor(status, url) {
    super('eBird server error', status, url);
    this.name = 'EbirdServerError';
  }
}

async function parseEbirdResponse(response) {
  const { status, url } = response;
  if (status === 429) {
    throw new RateLimitError(status, url);
  }
  if (status >= 400 && status < 500) {
    throw new EbirdClientError(status, url);
  }
  if (status >= 500) {
    throw new EbirdServerError(status, url);
  }
  return response.json();
}

function parseLifeListCsv(csvContent) {
  const rows = csvContent.split("\n").slice(1);
  return rows
    .filter(row => row.trim().length > 0)
    .map((row) => {
      const cols = row.split(",");
      return {
        taxon: cols[1],
        commonName: cols[3],
        scientificName: cols[4],
        location: cols[6],
      };
    });
}

async function recentObservationsNearby(lat, lng, dist, back, requestOptions) {
  const response = await fetch(
    `${API_ROOT}/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&maxResults=10000&includeProvisional=true`,
    requestOptions
  );
  return parseEbirdResponse(response);
}

async function recentSpeciesObservations(speciesCode, lat, lng, dist, back, requestOptions) {
  const response = await fetch(
    `${API_ROOT}/data/obs/geo/recent/${speciesCode}?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&includeProvisional=true`,
    requestOptions
  );
  return parseEbirdResponse(response);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
