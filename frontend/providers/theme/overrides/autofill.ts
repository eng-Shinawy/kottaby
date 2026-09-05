/**
 * CSS-variable-based autofill color tokens.
 *
 * With `cssVariables: true`, MUI bakes a single stylesheet that serves both
 * light and dark modes. Literal hex strings baked at theme creation time (the
 * previous approach) locked autofill colors to the *default* color scheme,
 * so switching to a non-default mode mismatched the palette and browser
 * autofill themes reappeared. Using CSS variable references lets the browser
 * resolve autofill colors at runtime per the active color scheme.
 *
 * Background: matches the surface behind the input (transparent inputs sit on
 * either background.default or background.paper); we use surface because it is
 * the elevated card surface where form inputs live.
 * Text: matches the primary text color.
 */
export const AUTOFILL_BACKGROUND_VAR = "var(--mui-palette-surface, var(--mui-palette-background-default))";
export const AUTOFILL_TEXT_VAR = "var(--mui-palette-text-primary)";
