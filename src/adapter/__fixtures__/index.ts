// Real frames captured from Grafana 13.2 against the docker/postgres fixtures by
// scripts/capture-frames.mjs. Test-only: nothing here is imported by module.ts.
import { DataFrame, DataFrameJSON, dataFrameFromJSON } from '@grafana/data';
import buildings from './buildings.json';
import edge_cases from './edge_cases.json';
import fiber_cables from './fiber_cables.json';
import network_assets from './network_assets.json';
import no_geometry from './no_geometry.json';
import patch_panels_jsonb from './patch_panels_jsonb.json';
import raw_wkb from './raw_wkb.json';
import splice_cases_feature from './splice_cases_feature.json';
import stateplane from './stateplane.json';

const fixtures = {
  buildings,
  edge_cases,
  fiber_cables,
  network_assets,
  no_geometry,
  patch_panels_jsonb,
  raw_wkb,
  splice_cases_feature,
  stateplane,
};

export type FixtureName = keyof typeof fixtures;

export const FIXTURE_NAMES = Object.keys(fixtures) as FixtureName[];

export function loadFixture(name: FixtureName, refId = 'A'): DataFrame {
  // JSON imports type field "type" as string rather than FieldType, hence the unknown cast.
  return { ...dataFrameFromJSON(fixtures[name] as unknown as DataFrameJSON), refId };
}
