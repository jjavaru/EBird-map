import https from "https";
import fs from "fs";

const API_ROOT = "https://api.ebird.org/v2";
const API_KEY = process.env.EBIRD_API_KEY;
const home = { lat: "39.95", long: "-82.99", regionCode: "US-OH-123" }; // Columbus, OH
//const home = { lat: "49.2888", long: "-123.1111", regionCode: "CA-BC-001" }; // Vancouver, BC
//const home = { lat: "41.51", long: "-82.94", regionCode: "US-OH-049" }; // Port Clinton, OH

const DAYS_BACK = 7;

// CSV rows
const TAXON = 1;
const COMMON_NAME = 3;
const SCIENTIFIC_NAME = 4;
const LOCATION = 6;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Only use for testing/development
});

const requestOptions = {
  method: "GET",
  redirect: "follow",
  headers: { "x-ebirdapitoken": API_KEY },
  agent: httpsAgent,
};

// Load life list from local CSV file
const lifeListCsvFile = "ebird_world_life_list.csv";
//const lifeListCsvFile = "ebird_world_year_list.csv";
let lifeListData;

if (fs.existsSync(lifeListCsvFile)) {
  console.log(`Reading life list from ${lifeListCsvFile}...`);
  const csvContent = fs.readFileSync(lifeListCsvFile, "utf-8");
  lifeListData = parseLifeListCsv(csvContent);
} else {
  console.error(`Error: ${lifeListCsvFile} not found!`);
  console.log("Please download your life list CSV from eBird and save it as ebird_world_life_list.csv");
  process.exit(1);
}

if (lifeListData) {
  console.log(`Total species in life list: ${lifeListData.length}`);
  console.log("First 5 species:", lifeListData.slice(0, 5));
}

// Find nearby birds not on life list
console.log("\n=== Finding nearby birds you need ===\n");

// Create a Set of common names from life list for fast lookup
const lifeListSpecies = new Set(lifeListData.map((bird) => bird.commonName));
console.log(`Life list contains ${lifeListSpecies.size} unique species`);

// Cache nearby observations to avoid repeated API calls
const nearbyObsCacheFile = "nearby-observations-cache.json";
let recentObservations;

// if (fs.existsSync(nearbyObsCacheFile)) {
//   console.log("Loading nearby observations from cache...");
//   const cacheData = fs.readFileSync(nearbyObsCacheFile, "utf-8");
//   recentObservations = JSON.parse(cacheData);
// } else {
  console.log("Fetching nearby observations from eBird...");
  recentObservations = await recentObservationsNearby(
    home.lat,
    home.long,
    50, // distance in km (eBird API uses km)
    DAYS_BACK // days back
  );
  if (recentObservations) {
    fs.writeFileSync(nearbyObsCacheFile, JSON.stringify(recentObservations, null, 2));
    console.log(`Nearby observations cached to ${nearbyObsCacheFile}`);
  }
//}

if (recentObservations) {
  console.log(`Found ${recentObservations.length} recent observations nearby`);

  // Filter to find species NOT on life list (by common name)
  const needs = recentObservations.filter(
    (obs) => !lifeListSpecies.has(obs.comName)
  );

  console.log(`\n🎯 Found ${needs.length} observations of species you need!\n`);

  if (needs.length > 0) {
    // Get unique species codes from the needs
    const uniqueSpeciesCodes = [...new Set(needs.map(obs => obs.speciesCode))];
    console.log(`Found ${uniqueSpeciesCodes.length} unique species. Fetching detailed observations...\n`);

    // Fetch all observations for each species
    const allObservations = [];
    for (const speciesCode of uniqueSpeciesCodes) {
      const speciesObs = await recentSpeciesObservations(speciesCode, home.lat, home.long);
      if (speciesObs && speciesObs.length > 0) {
        allObservations.push(...speciesObs);
        console.log(`  ${speciesObs[0].comName}: ${speciesObs.length} observations`);
      }
    }

    console.log(`\nTotal observations collected: ${allObservations.length}\n`);

    // Use the expanded observations for the rest of the processing
    const expandedNeeds = allObservations;

  if (expandedNeeds.length > 0) {
    // Group by location to show productive spots
    const byLocation = expandedNeeds.reduce((acc, obs) => {
      const locName = obs.locName || obs.locId;
      if (!acc[locName]) {
        acc[locName] = [];
      }
      acc[locName].push(obs);
      return acc;
    }, {});

    // Calculate distance for each location once
    const locationsWithDistance = Object.entries(byLocation).map(([location, observations]) => {
      const distance = calculateDistance(
        parseFloat(home.lat),
        parseFloat(home.long),
        observations[0].lat,
        observations[0].lng
      );
      return { location, observations, distance };
    });

    // Sort by number of observations (descending), then by distance (ascending)
    const sortedLocations = locationsWithDistance.sort((a, b) => {
      const countDiff = b.observations.length - a.observations.length;
      if (countDiff !== 0) return countDiff;
      return a.distance - b.distance; // closer locations first if same count
    });

    console.log("📍 Best locations for finding new species:\n");
    sortedLocations.forEach(({ location, observations, distance }) => {
      console.log(`${location}, ${distance.toFixed(1)} mi away (${observations.length} species):`);

      observations.forEach((obs) => {
        console.log(
          `  - ${obs.comName} (${obs.speciesCode}) - seen ${obs.howMany || "?"} on ${obs.obsDt}`
        );
      });
      console.log("");
    });

    // Generate JSON data for the map
    const mapData = {
      home: {
        lat: parseFloat(home.lat),
        lng: parseFloat(home.long),
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

    const mapDataFile = "bird-map-data.js";
    const jsContent = `window.birdMapData = ${JSON.stringify(mapData, null, 2)};`;
    fs.writeFileSync(mapDataFile, jsContent);
    console.log(`\n✅ Map data written to ${mapDataFile}`);
    console.log(`   Open bird-map.html in a browser to view the map\n`);
  }
  }
}

// ------------------------------------------ //
// Library
// ------------------------------------------ //

function nearbyRegions(regionCode) {
  return fetch(
    `${API_ROOT}/ref/adjacent/${regionCode}`,
    requestOptions
  )
    .then((response) => response.json())
    .catch((error) => console.log("error", error));
}

function speciesList(regionCode) {
  return fetch(
    `${API_ROOT}/product/spplist/${regionCode}`,
    requestOptions
  )
    .then((response) => response.json())
    .catch((error) => console.log("error", error));
}

function nearestObservation(speciesCode, lat, lng) {
  return fetch(
    `${API_ROOT}/data/nearest/geo/recent/${speciesCode}?lat=${lat}&lng=${lng}&dist=50&maxResults=1`,
    requestOptions
  )
    .then((response) => response.json())
    .catch((error) => console.log("error", error));
}

function parseLifeListCsv(csvContent) {
  const rows = csvContent.split("\n").slice(1); // Skip header row
  return rows
    .filter(row => row.trim().length > 0) // Skip empty rows
    .map((row) => {
      const cols = row.split(",");
      return {
        taxon: cols[TAXON],
        commonName: cols[COMMON_NAME],
        scientificName: cols[SCIENTIFIC_NAME],
        location: cols[LOCATION],
      };
    });
}

function recentObservationsNearby(lat, lng, dist = 50, back = DAYS_BACK) {
  return fetch(
    `${API_ROOT}/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&maxResults=10000`,
    requestOptions
  )
    .then((response) => response.json())
    .catch((error) => console.log("error", error));
}

function recentSpeciesObservations(speciesCode, lat, lng, dist = 50, back = DAYS_BACK) {
  return fetch(
    `${API_ROOT}/data/obs/geo/recent/${speciesCode}?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}`,
    requestOptions
  )
    .then((response) => response.json())
    .catch((error) => console.log("error", error));
}

// Calculate distance between two lat/lng points using Haversine formula
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
