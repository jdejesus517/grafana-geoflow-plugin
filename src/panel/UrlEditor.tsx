import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Field, Input } from '@grafana/ui';

export interface UrlEditorSettings {
  placeholder?: string;
  /** Returns why a URL can't be used, or undefined when it can. */
  validate: (url: string | undefined) => string | undefined;
}

/**
 * A text option that explains an unusable URL right below the input. The panel falls back to no
 * basemap for such a URL (basemapFromOptions), so this is where the user finds out why.
 * Commits on blur, like Grafana's own text option, so the map isn't restyled on every keystroke.
 */
export const UrlEditor = ({ value, onChange, item, id }: StandardEditorProps<string, UrlEditorSettings>) => {
  const problem = item.settings?.validate(value);

  return (
    <Field invalid={!!problem} error={problem} noMargin>
      {/* Uncontrolled, and re-created when the saved value changes from elsewhere (undo, JSON edit). */}
      <Input
        key={value}
        id={id}
        defaultValue={value ?? ''}
        placeholder={item.settings?.placeholder}
        onBlur={(e) => e.currentTarget.value !== (value ?? '') && onChange(e.currentTarget.value)}
      />
    </Field>
  );
};
