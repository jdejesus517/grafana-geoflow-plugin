import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { DataFrame, FieldType, GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import {
  Combobox,
  ComboboxOption,
  Field,
  Icon,
  IconButton,
  Input,
  RadioButtonGroup,
  Stack,
  Switch,
  useStyles2,
} from '@grafana/ui';
import {
  BoundLayer,
  LayerConfig,
  LayerRole,
  bindLayers,
  bindPerFrame,
  defaultIdField,
  detectEdgeFields,
  detectGeometryField,
  networkLayers,
} from '../adapter';
import { GeoFlowOptions } from './options';

const getStyles = (theme: GrafanaTheme2) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    margin-bottom: ${theme.spacing(2)};
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    min-height: ${theme.spacing(4)};
    padding: ${theme.spacing(0, 1)};
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    cursor: pointer;

    & > * {
      flex-shrink: 0;
    }
  `,
  selected: css`
    border-color: ${theme.colors.primary.border};
  `,
  name: css`
    flex: 1 1 auto !important;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    color: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    border: none;
  `,
  hidden: css`
    color: ${theme.colors.text.secondary};
  `,
  secondary: css`
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
  `,
  id: css`
    flex-shrink: 1 !important;
    max-width: 25%;
    overflow: hidden;
    color: ${theme.colors.text.secondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  warning: css`
    color: ${theme.colors.warning.text};
    white-space: nowrap;
  `,
  heading: css`
    margin-bottom: ${theme.spacing(1)};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  note: css`
    color: ${theme.colors.text.secondary};
  `,
});

const ROLES: Array<{ label: string; value: LayerRole }> = [
  { label: 'Geometry', value: 'geometry' },
  { label: 'Nodes', value: 'nodes' },
  { label: 'Edges', value: 'edges' },
];

/**
 * The Layers list (docs/phase_7.md, Design §4): one row per layer, top layer first, with
 * visibility and move buttons, and the settings of the selected layer below. The rows follow the
 * panel's queries; saved settings whose layer is gone stay until removed. Any change saves every
 * layer in its current order, each with only the settings that differ from the defaults.
 *
 * A layer's role makes it part of the panel's network (docs/node-edge/phase_2.md): its settings
 * follow the role, and a role change that would draw edges above their nodes reorders them.
 */
export const LayersEditor = ({
  value,
  onChange,
  context,
}: StandardEditorProps<LayerConfig[] | undefined, unknown, GeoFlowOptions>) => {
  const styles = useStyles2(getStyles);
  const frames = useMemo(() => context.data ?? [], [context.data]);
  const layers = bindLayers(frames, value, context.options?.layerBinding);
  // The names layers get without a typed one, for the Name placeholder.
  const defaultNames = useMemo(
    () => new Map(bindPerFrame(frames, []).map((layer) => [layer.id, layer.name])),
    [frames]
  );
  const [selectedId, setSelectedId] = useState<string>();
  const selected = layers.find((layer) => layer.id === selectedId) ?? layers[0];

  const save = (next: BoundLayer[], patch?: { id: string; changes: Partial<LayerConfig> }) =>
    onChange(
      next.map((layer) => {
        const config = { ...(layer.config ?? { id: layer.id }), ...(patch?.id === layer.id && patch.changes) };
        return withoutDefaults(config);
      })
    );
  const update = (id: string, changes: Partial<LayerConfig>) => save(layers, { id, changes });
  const move = (index: number, by: number) => {
    const next = [...layers];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    save(next);
  };
  const setRole = (layer: BoundLayer, role: LayerRole) =>
    save(withRoleOrder(layers, layer, role), { id: layer.id, changes: { role } });
  const network = networkLayers(layers);

  if (layers.length === 0) {
    return <div className={styles.note}>Run the panel&apos;s queries to list their layers.</div>;
  }

  return (
    <div data-testid="geoflow-layers-editor">
      <div className={styles.list}>
        {layers.map((layer, index) => {
          const frame = frameOf(frames, layer);
          const problem = frame && layer.role !== 'edges' && geometryProblem(frame, layer);
          const usedInstead = network.extras.includes(layer)
            ? layer.role === 'nodes'
              ? network.nodes
              : network.edges
            : undefined;
          return (
            <div
              key={layer.id}
              className={cx(styles.row, layer === selected && styles.selected)}
              onClick={() => setSelectedId(layer.id)}
              data-testid={`geoflow-layer-row-${layer.id}`}
            >
              {frame ? (
                <IconButton
                  name={layer.visible ? 'eye' : 'eye-slash'}
                  tooltip={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    update(layer.id, { visible: !layer.visible });
                  }}
                />
              ) : (
                <Icon name="exclamation-triangle" className={styles.secondary} />
              )}
              <button
                type="button"
                className={cx(styles.name, !layer.visible && styles.hidden)}
                title={layer.name}
                aria-pressed={layer === selected}
              >
                {layer.name}
              </button>
              {layer.role !== 'geometry' && (
                <span className={styles.secondary}>{layer.role === 'nodes' ? 'Nodes' : 'Edges'}</span>
              )}
              {usedInstead && (
                <span className={styles.warning} title={`The network uses ${usedInstead.name}`}>
                  Not used
                </span>
              )}
              {!frame && <span className={styles.secondary}>No data</span>}
              {problem && <span className={styles.warning}>No geometry</span>}
              <span className={styles.id} title={layer.id}>
                {layer.id}
              </span>
              <IconButton
                name="arrow-up"
                tooltip={`Move ${layer.name} up`}
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  move(index, -1);
                }}
              />
              <IconButton
                name="arrow-down"
                tooltip={`Move ${layer.name} down`}
                disabled={index === layers.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  move(index, 1);
                }}
              />
              {!frame && (
                <IconButton
                  name="trash-alt"
                  tooltip={`Remove the settings of ${layer.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    save(layers.filter(({ id }) => id !== layer.id));
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {selected && (
        <LayerSettings
          key={selected.id}
          layer={selected}
          frame={frameOf(frames, selected)}
          defaultName={defaultNames.get(selected.id) ?? selected.id}
          onChange={(changes) => update(selected.id, changes)}
          onRoleChange={(role) => setRole(selected, role)}
        />
      )}
    </div>
  );
};

interface SettingsProps {
  layer: BoundLayer;
  frame: DataFrame | undefined;
  defaultName: string;
  onChange: (changes: Partial<LayerConfig>) => void;
  onRoleChange: (role: LayerRole) => void;
}

function LayerSettings({ layer, frame, defaultName, onChange, onRoleChange }: SettingsProps) {
  const styles = useStyles2(getStyles);
  const id = `geoflow-layer-${layer.id}`;
  if (!frame) {
    return (
      <div className={styles.note} data-testid="geoflow-layer-settings">
        No query returns this layer now. Its settings are kept until you remove them.
      </div>
    );
  }
  const geometryOptions = columnOptions(frame, (type) => type === FieldType.string || type === FieldType.other);
  const detected = detectGeometryField(frame);
  const idDefault = defaultIdField(frame)?.name;
  const problem = geometryProblem(frame, layer);
  const nodes = layer.role === 'nodes';
  const edges = layer.role === 'edges';

  return (
    <div data-testid="geoflow-layer-settings">
      <div className={styles.heading}>{layer.name}</div>
      <Stack direction="column" gap={0}>
        <Field label="Role" description="Nodes and Edges draw a network: edges join nodes by id.">
          <RadioButtonGroup
            id={`${id}-role`}
            size="sm"
            options={ROLES}
            value={layer.role}
            onChange={(role) => role !== layer.role && onRoleChange(role)}
          />
        </Field>
        <Field label="Name" description="Shown in tooltips, the legend and the data summary.">
          {/* Uncontrolled, committed on blur, like CheckedTextEditor. */}
          <Input
            key={layer.config?.name ?? ''}
            id={`${id}-name`}
            defaultValue={layer.config?.name ?? ''}
            placeholder={defaultName}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (name !== (layer.config?.name ?? '')) {
                onChange({ name: name || undefined });
              }
            }}
          />
        </Field>
        {edges && <EdgeColumns layer={layer} frame={frame} id={id} onChange={onChange} />}
        {!edges && (
          <Field
            label="Geometry column"
            description="The column with GeoJSON geometry."
            invalid={!!problem}
            error={problem}
          >
            <Combobox
              id={`${id}-geometry`}
              options={geometryOptions}
              value={layer.geometryField ?? null}
              placeholder={detected.found ? `Auto: ${detected.field.name}` : 'Auto: none found'}
              isClearable
              onChange={(option) => onChange({ geometryField: option?.value })}
            />
          </Field>
        )}
        {!edges && (
          <Field
            label="ID column"
            description={
              nodes
                ? 'Edges find nodes by this column. Keep it unique.'
                : 'Unique ids keep tooltips on the same feature across refreshes.'
            }
            invalid={nodes && !layer.idField && !idDefault}
            error={nodes && !layer.idField && !idDefault ? 'Edges find nodes by id: choose a column' : undefined}
          >
            <Combobox
              id={`${id}-id`}
              options={columnOptions(frame, () => true)}
              value={layer.idField ?? null}
              placeholder={idDefault ? `Auto: ${idDefault}` : nodes ? 'None: choose one' : 'Auto: row number'}
              isClearable
              onChange={(option) => onChange({ idField: option?.value })}
            />
          </Field>
        )}
        <Field label="Tooltips" description="Off: the layer is drawn, but its features can't be hovered or clicked.">
          <Switch
            id={`${id}-tooltips`}
            value={layer.tooltips}
            onChange={() => onChange({ tooltips: !layer.tooltips })}
          />
        </Field>
      </Stack>
    </div>
  );
}

interface EdgeColumnsProps {
  layer: BoundLayer;
  frame: DataFrame;
  id: string;
  onChange: (changes: Partial<LayerConfig>) => void;
}

/**
 * An edge layer's From and To columns. Unset, each shows the column detection finds, which
 * follows the other when only one is chosen, as the panel's join does (detectEdgeFields).
 */
function EdgeColumns({ layer, frame, id, onChange }: EdgeColumnsProps) {
  const detection = detectEdgeFields(frame, layer.fromField, layer.toField);
  const options = columnOptions(frame, () => true);
  // A problem shows on the column it names ("To column: no column named x"), without the name,
  // which the field's label already says. One about both columns shows on From.
  const problem = detection.found ? undefined : detection.detail;
  const errors = {
    from: problem && !problem.startsWith('To column') ? problem.replace(/^From column: /, '') : undefined,
    to: problem?.startsWith('To column') ? problem.replace(/^To column: /, '') : undefined,
  };
  const picker = (label: 'From column' | 'To column', key: 'fromField' | 'toField', side: 'from' | 'to') => (
    <Field
      label={label}
      description={
        side === 'from' ? 'The id of the node each edge starts at.' : 'The id of the node each edge ends at.'
      }
      invalid={!!errors[side]}
      error={errors[side]}
    >
      <Combobox
        id={`${id}-${side}`}
        options={options}
        value={layer[key] ?? null}
        placeholder={detection.found ? `Auto: ${detection[side].name}` : 'Auto: none found'}
        isClearable
        onChange={(option) => onChange({ [key]: option?.value })}
      />
    </Field>
  );
  return (
    <>
      {picker('From column', 'fromField', 'from')}
      {picker('To column', 'toField', 'to')}
    </>
  );
}

/**
 * `layers` (top first) with `layer` moved for its new role, when the network would otherwise draw
 * upside down (docs/node-edge/phase_2.md, decision 3): an edge layer above its nodes moves to just
 * below them, a node layer below its edges to just above them. Otherwise the order is kept.
 */
export function withRoleOrder(layers: BoundLayer[], layer: BoundLayer, role: LayerRole): BoundLayer[] {
  const counterpartRole = role === 'edges' ? 'nodes' : role === 'nodes' ? 'edges' : undefined;
  const counterpart = layers.find(
    (other) => other !== layer && other.role === counterpartRole && other.frameIndex !== undefined
  );
  const [from, to] = [layers.indexOf(layer), counterpart ? layers.indexOf(counterpart) : -1];
  const upsideDown = counterpart && (role === 'edges' ? from < to : from > to);
  if (!upsideDown) {
    return layers;
  }
  const next = layers.filter((other) => other !== layer);
  const at = next.indexOf(counterpart);
  next.splice(role === 'edges' ? at + 1 : at, 0, layer);
  return next;
}

function frameOf(frames: DataFrame[], layer: BoundLayer): DataFrame | undefined {
  return layer.frameIndex === undefined ? undefined : frames[layer.frameIndex];
}

/** Why the layer has no geometry column, or undefined when it has one. */
function geometryProblem(frame: DataFrame, layer: BoundLayer): string | undefined {
  const detection = detectGeometryField(frame, layer.geometryField);
  return detection.found ? undefined : detection.detail;
}

function columnOptions(frame: DataFrame, include: (type: FieldType) => boolean): Array<ComboboxOption<string>> {
  return frame.fields.filter((field) => include(field.type)).map(({ name }) => ({ label: name, value: name }));
}

/** Settings whose value is the default, and so isn't saved. Unset and empty values aren't either. */
const DEFAULTS: Partial<LayerConfig> = { visible: true, tooltips: true, role: 'geometry', showDirection: true };

/**
 * The config with only what differs from the defaults, so saved dashboards stay small. Every
 * other setting is kept, including ones added after this was written: a list of settings to keep
 * dropped the network roles and columns (docs/node-edge/phase_2.md, decision 4). Edge settings
 * (from and to columns, Show direction) are dropped off layers that aren't edges, where they no
 * longer apply.
 */
export function withoutDefaults(config: LayerConfig): LayerConfig {
  const saved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== '' && value !== DEFAULTS[key as keyof LayerConfig]) {
      saved[key] = value;
    }
  }
  if (saved.role !== 'edges') {
    delete saved.fromField;
    delete saved.toField;
    delete saved.showDirection;
  }
  return saved as unknown as LayerConfig;
}
