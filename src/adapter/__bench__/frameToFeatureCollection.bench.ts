// Conversion timing sanity check (docs/phase_1.md, step 1.7). Not part of test:ci, because
// timings on shared CI runners are noisy. Run with: npm run bench:adapter
import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { frameToFeatureCollection } from '../frameToFeatureCollection';

const ROWS = 100_000;
const BUDGET_MS = 1000;

// Half Points, half 5-vertex LineStrings, spread over the Cary fixture area.
function geometryAt(i: number): object {
  const lon = -78.9 + (i % 1000) * 0.00016;
  const lat = 35.7 + Math.floor(i / 1000) * 0.0014;
  if (i % 2 === 0) {
    return { type: 'Point', coordinates: [lon, lat] };
  }
  const coordinates = [];
  for (let v = 0; v < 5; v++) {
    coordinates.push([lon + v * 0.0001, lat + v * 0.0001]);
  }
  return { type: 'LineString', coordinates };
}

function buildFrame(asText: boolean): DataFrame {
  const ids: number[] = [];
  const names: string[] = [];
  const tiers: string[] = [];
  const geometries: unknown[] = [];
  for (let i = 0; i < ROWS; i++) {
    ids.push(i + 1);
    names.push(`SL-${i + 1}`);
    tiers.push(['300M', '1G', '2G', '5G'][i % 4]);
    const geometry = geometryAt(i);
    geometries.push(asText ? JSON.stringify(geometry) : geometry);
  }
  return toDataFrame({
    refId: 'A',
    fields: [
      { name: 'id', type: FieldType.number, values: ids },
      { name: 'name', type: FieldType.string, values: names },
      { name: 'service_tier', type: FieldType.string, values: tiers },
      { name: 'geometry', type: asText ? FieldType.string : FieldType.other, values: geometries },
    ],
  });
}

function timeConversion(frame: DataFrame): { medianMs: number; minMs: number; features: number } {
  frameToFeatureCollection(frame); // warm-up
  const timings: number[] = [];
  let features = 0;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    features = frameToFeatureCollection(frame).featureCollection.features.length;
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return { medianMs: timings[2], minMs: timings[0], features };
}

describe(`frameToFeatureCollection with ${ROWS.toLocaleString('en-US')} rows`, () => {
  it.each([
    ['GeoJSON text (ST_AsGeoJSON)', true],
    ['parsed objects (jsonb)', false],
  ])(`%s converts within ${BUDGET_MS} ms`, (label, asText) => {
    const { medianMs, minMs, features } = timeConversion(buildFrame(asText));
    // Not console.log: Grafana's plugin validator flags console logging anywhere in src/.
    process.stdout.write(`${label}: median ${medianMs.toFixed(0)} ms, min ${minMs.toFixed(0)} ms, ${features} features\n`);

    expect(features).toBe(ROWS);
    expect(medianMs).toBeLessThan(BUDGET_MS);
  });
});
