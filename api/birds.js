import https from "https";
import fs from "fs";

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

    const requestOptions = {
      method: "GET",
      redirect: "follow",
      headers: { "x-ebirdapitoken": API_KEY },
      agent: httpsAgent,
    };

    // Load life list from CSV (you'll need to upload this to Vercel)
    const lifeListCsvPath = "./ebird_world_life_list.csv";
    let lifeListData = [];
    
    try {
      if (fs.existsSync(lifeListCsvPath)) {
        const csvContent = fs.readFileSync(lifeListCsvPath, "utf-8");
        lifeListData = parseLifeListCsv(csvContent);
      }
    } catch (error) {
      console.error("Error reading life list:", error);
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

    // Filter to find species NOT on life list
    const needs = recentObservations.filter(
      (obs) => !lifeListSpecies.has(obs.comName)
    );

    // Get unique species codes
    const uniqueSpeciesCodes = [...new Set(needs.map(obs => obs.speciesCode))];

    // Fetch all observations for each species
    const allObservations = [];
    for (const speciesCode of uniqueSpeciesCodes) {
      const speciesObs = await recentSpeciesObservations(
        speciesCode,
        lat,
        lng,
        dist,
        DAYS_BACK,
        requestOptions
      );
      if (speciesObs && speciesObs.length > 0) {
        allObservations.push(...speciesObs);
      }
    }

    // Group by location
    const byLocation = allObservations.reduce((acc, obs) => {
      const locName = obs.locName || obs.locId;
      if (!acc[locName]) {
        acc[locName] = [];
      }
      acc[locName].push(obs);
      return acc;
    }, {});

    // Calculate distance and prepare locations
    const locationsWithDistance = Object.entries(byLocation).map(([location, observations]) => {
      const distance = calculateDistance(
        parseFloat(lat),
        parseFloat(lng),
        observations[0].lat,
        observations[0].lng
      );
      return { location, observations, distance };
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
      locations: sortedLocations.map(({ location, observations, distance }) => ({
        name: location,
        lat: observations[0].lat,
        lng: observations[0].lng,
        locId: observations[0].locId,
        distance: parseFloat(distance.toFixed(1)),
        speciesCount: observations.length,
        species: observations.map((obs) => ({
          commonName: obs.comName,
          speciesCode: obs.speciesCode,
          count: obs.howMany || "?",
          date: obs.obsDt,
        })),
      })),
    };

    res.status(200).json(mapData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Helper functions
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
    `${API_ROOT}/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&maxResults=10000`,
    requestOptions
  );
  return response.json();
}

async function recentSpeciesObservations(speciesCode, lat, lng, dist, back, requestOptions) {
  const response = await fetch(
    `${API_ROOT}/data/obs/geo/recent/${speciesCode}?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}`,
    requestOptions
  );
  return response.json();
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
