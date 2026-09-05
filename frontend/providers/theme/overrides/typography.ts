import type { Components, Theme } from "@mui/material/styles";

/**
 * Custom typography variants default to `<span>` without a mapping, which makes
 * consecutive titles/subtitles render inline and overlap. Map every text-like
 * variant to a block element. Inline-only variants (button / buttonText /
 * labelSm / overline) stay as `span`. Pair with `display: "block"` on the
 * matching entries in `typography.ts` so styled wrappers stay stacked too.
 */
export const getMuiTypography = (): Components<Omit<Theme, "components">>["MuiTypography"] => ({
  defaultProps: {
    variantMapping: {
      // Built-in
      h1: "h1",
      h2: "h2",
      h3: "h3",
      h4: "h4",
      h5: "h5",
      h6: "h6",
      subtitle1: "h6",
      subtitle2: "h6",
      body1: "p",
      body2: "p",
      inherit: "p",
      caption: "p",
      overline: "span",
      button: "span",
      // Design-system
      display: "h1",
      headlineLg: "h2",
      headlineMd: "h3",
      titleLg: "h4",
      bodyLg: "p",
      bodyMd: "p",
      labelMd: "p",
      labelSm: "span",
      labelUppercase: "p",
      buttonText: "span",
    },
  },
});
