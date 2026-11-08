import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Combobox, Field, Stack } from '@grafana/ui';
import { PROVIDERS, PresetChoice, SAME_STYLE, isProviderId, presetStyles } from './basemapPresets';
import { GeoFlowOptions } from './options';

/**
 * A preset provider's Style and Dark theme style (docs/phase_12.md, Design §3). The choices
 * depend on the provider picked under Basemap, so one editor shows both, from the providers table.
 * Unset values show the defaults they resolve to, and only what the user picks is saved.
 */
export const PresetEditor = ({
  value,
  onChange,
  context,
  id,
}: StandardEditorProps<PresetChoice | undefined, unknown, GeoFlowOptions>) => {
  const kind = context.options?.basemap?.kind;
  if (!isProviderId(kind)) {
    return null;
  }
  const provider = PROVIDERS[kind];
  const { light, dark } = presetStyles(provider, value);
  const options = (styles: Array<{ id: string; label: string }>) =>
    styles.map((s) => ({ value: s.id, label: s.label }));
  const sameLabel = provider.spec(light, undefined, true).kind === 'raster' ? 'Same as light, dimmed' : 'Same as light';

  return (
    <Stack direction="column" gap={0}>
      <Field label="Style" noMargin>
        <Combobox
          id={`${id}-style`}
          options={options(provider.light)}
          value={light}
          // Picking another light style also resets the dark one to that style's pair.
          onChange={(option) => onChange({ style: option.value })}
        />
      </Field>
      <Field label="Dark theme style" description="Used while Grafana's theme is dark." noMargin>
        <Combobox
          id={`${id}-dark`}
          options={[...options(provider.dark), { value: SAME_STYLE, label: sameLabel }]}
          value={dark}
          onChange={(option) => onChange({ ...value, style: light, dark: option.value })}
        />
      </Field>
    </Stack>
  );
};
