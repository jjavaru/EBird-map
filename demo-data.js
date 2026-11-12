// Fake data for demo mode (open the app with ?demo, or run `npm run demo`).
// Returns the same shape as /api/birds, with dates relative to today so the
// days slider always has something to show. Hotspots are placed around
// whatever point is searched, so clicking the map to search elsewhere works too.
//
// URL options:
//   ?demo          normal demo data
//   ?demo=warning  also shows the partial-results (rate limit) warning
window.buildDemoData = function buildDemoData(lat, lng, listType, excludeCodes) {
  const SPECIES = {
    sabgul:  "Sabine's Gull",
    redkno:  'Red Knot',
    whimbr:  'Whimbrel',
    hudgod:  'Hudsonian Godwit',
    kirwar:  "Kirtland's Warbler",
    conwar:  'Connecticut Warbler',
    lecspa:  "Le Conte's Sparrow",
    nelspa:  "Nelson's Sparrow",
    yelrai:  'Yellow Rail',
    kinrai4: 'King Rail',
    amgplo:  'American Golden-Plover',
    bubsan:  'Buff-breasted Sandpiper',
    renpha:  'Red-necked Phalarope',
    parjae:  'Parasitic Jaeger',
    snobun:  'Snow Bunting',
    laplon:  'Lapland Longspur',
    nswowl:  'Northern Saw-whet Owl',
    loeowl:  'Long-eared Owl',
    // Only shown on the year list
    bkcchi:  'Black-capped Chickadee',
    rehwoo:  'Red-headed Woodpecker',
  };
  const YEAR_ONLY = new Set(['bkcchi', 'rehwoo']);

  // [name, lat offset, lng offset, [species codes], days ago for each]
  // The first few sit close together to exercise overlapping markers and popups.
  const HOTSPOTS = [
    ['Demo Marsh North',      0.10,  0.09, ['yelrai', 'kinrai4', 'lecspa', 'nelspa', 'sabgul', 'rehwoo'], [0, 1, 1, 2, 0, 3]],
    ['Demo Marsh South',      0.09,  0.10, ['yelrai', 'nelspa', 'conwar'], [1, 2, 5]],
    ['Demo Marsh Boardwalk',  0.105, 0.105, ['kinrai4'], [0]],
    ['Demo Reservoir Dam',    0.17,  0.12, ['sabgul', 'parjae', 'renpha', 'redkno'], [0, 2, 3, 6]],
    ['Demo Mudflats',        -0.06, -0.23, ['redkno', 'whimbr', 'hudgod', 'amgplo', 'bubsan'], [1, 1, 4, 2, 0]],
    ['Demo Sod Farm',        -0.20, -0.10, ['amgplo', 'bubsan', 'laplon'], [3, 3, 6]],
    ['Demo Pine Grove',       0.25, -0.15, ['nswowl', 'loeowl', 'bkcchi'], [2, 5, 0]],
    ['Demo Lakefront Park',   0.30,  0.25, ['snobun', 'laplon'], [4, 4]],
    ['Demo Warbler Woods',   -0.12,  0.20, ['kirwar', 'conwar'], [6, 1]],
    ["Demo Farmer's Field",  -0.28,  0.05, ['whimbr'], [5]],
    ['Demo Private Yard',     0.02, -0.04, ['loeowl'], [2]],
  ];

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const pad = (x) => String(x).padStart(2, '0');
    // Same format eBird uses for obsDt
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(7 + (n % 10))}:${pad((n * 17) % 60)}`;
  }

  function miles(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  lat = parseFloat(lat);
  lng = parseFloat(lng);
  const exclude = new Set(excludeCodes);

  // In ?demo=warning mode, mimic the rate limit by only "loading" a batch of species
  // per request. Excluded codes (checked off, or loaded by an earlier batch) don't count.
  const demoParam = new URLSearchParams(window.location.search).get('demo');
  const BATCH_SIZE = 6;
  const candidateCodes = Object.keys(SPECIES)
    .filter((code) => listType === 'year' || !YEAR_ONLY.has(code))
    .filter((code) => !exclude.has(code));
  const loadedSpeciesCodes = demoParam === 'warning'
    ? candidateCodes.slice(0, BATCH_SIZE)
    : candidateCodes;
  const loaded = new Set(loadedSpeciesCodes);

  const locations = HOTSPOTS.map(([name, dLat, dLng, codes, ages], i) => {
    const species = codes
      .map((code, j) => ({ code, age: ages[j] }))
      .filter(({ code }) => listType === 'year' || !YEAR_ONLY.has(code))
      .filter(({ code }) => loaded.has(code)) // the real API skips checked-off species
      .map(({ code, age }, j) => ({
        commonName: SPECIES[code],
        speciesCode: code,
        count: (i + j) % 4 === 0 ? '?' : ((i + j) % 4),
        date: daysAgo(age),
        subId: `S${100000000 + i * 100 + j}`,
      }));
    const locLat = +(lat + dLat).toFixed(4);
    const locLng = +(lng + dLng).toFixed(4);
    return {
      name,
      lat: locLat,
      lng: locLng,
      locId: `Ldemo${i}`,
      distance: +miles(lat, lng, locLat, locLng).toFixed(1),
      speciesCount: species.length,
      species,
    };
  })
    .filter((loc) => loc.species.length > 0)
    .sort((a, b) => b.speciesCount - a.speciesCount || a.distance - b.distance);

  return {
    home: { lat, lng },
    locations,
    warning: loadedSpeciesCodes.length < candidateCodes.length
      ? `Demo: eBird rate limit reached: only ${loadedSpeciesCodes.length} of ${candidateCodes.length} species were loaded. Results are incomplete.`
      : null,
    loadedSpeciesCodes,
  };
};
