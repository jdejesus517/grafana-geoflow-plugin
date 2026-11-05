import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Field, Input } from '@grafana/ui';

export interface CheckedTextEditorSettings {
  placeholder?: string;
  /** Returns why the text can't be used, or undefined when it can. */
  validate: (text: string | undefined) => string | undefined;
}

/**
 * A text option that explains an unusable value right below the input: a basemap URL (the panel
 * falls back to no basemap, see basemapFromOptions) or a dash pattern (the line draws solid).
 * This is where the user finds out why. Commits on blur, like Grafana's own text option, so the
 * map isn't restyled on every keystroke. Works as a panel option and as a field option.
 */
export const CheckedTextEditor = ({
  value,
  onChange,
  item,
  id,
}: StandardEditorProps<string | undefined, CheckedTextEditorSettings>) => {
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
