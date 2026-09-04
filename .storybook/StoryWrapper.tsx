import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { Box, CssBaseline, GlobalStyles, type PaletteMode } from "@mui/material";
import { ThemeProvider, useColorScheme } from "@mui/material/styles";
import type { StoryContext, StoryFn } from "@storybook/nextjs-vite";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import rtlPlugin from "stylis-plugin-rtl";
import { ThemeContext } from "@/frontend/context/ThemeContext";
import { LocaleProvider } from "@/frontend/providers/LocaleProvider";
import { createAppCssVarsTheme } from "@/frontend/providers/theme/theme";
import { ViewportProvider } from "@/frontend/providers/theme/ViewportProvider";

// Create Emotion caches for Storybook
const cacheLtr = createCache({
  key: "sb-ltr",
  prepend: true,
});

// Omit stylis `prefixer` — it crashes on `::placeholder` when paired with RTL.
const cacheRtl = createCache({
  key: "sb-rtl",
  prepend: true,
  stylisPlugins: [rtlPlugin],
});

function isLocale(value: unknown): value is "ar" | "en" {
  return value === "ar" || value === "en";
}

function isViewport(value: unknown): value is "mobile" | "tablet" | "desktop" {
  return value === "mobile" || value === "tablet" || value === "desktop";
}

function isPaletteMode(value: unknown): value is PaletteMode {
  return value === "light" || value === "dark";
}

type ViewportGlobal = "mobile" | "tablet" | "desktop";

const VIEWPORT_MAX_WIDTH: Record<ViewportGlobal, number | "none"> = {
  mobile: 600,
  tablet: 900,
  desktop: "none",
};

function checkIsUiComponent(context: StoryContext): boolean {
  if (context.parameters?.fileName?.includes("frontend/components/ui/")) {
    return true;
  }
  if (context.title?.startsWith("UI/")) {
    return true;
  }
  return context.title?.startsWith("Form/") ?? false;
}

/**
 * Syncs Storybook's `theme` global to MUI's `useColorScheme()` and the DOM
 * attributes that scope CSS variable palettes (`data-theme`, `data-mui-color-scheme`).
 */
function StorybookColorSchemeBridge({
  mode,
  direction,
  locale,
  children,
}: Readonly<{
  mode: PaletteMode;
  direction: "rtl" | "ltr";
  locale: "ar" | "en";
  children: ReactNode;
}>) {
  const { setMode } = useColorScheme();

  useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.muiColorScheme = mode;
    root.style.colorScheme = mode;
    root.dir = direction;
    root.lang = locale;
  }, [mode, direction, locale]);

  return children;
}

export const StoryWrapper = ({ Story, context }: { Story: StoryFn; context: StoryContext }) => {
  const globals = context.globals as Record<string, unknown>;
  const locale = isLocale(globals.locale) ? globals.locale : "ar";
  const themeMode: PaletteMode = isPaletteMode(globals.theme) ? globals.theme : "dark";
  const viewport = isViewport(globals.viewport) ? globals.viewport : "desktop";
  const direction: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";

  // CSS-variables theme matches the App Router provider; mode toggles via useColorScheme.
  const theme = useMemo(() => createAppCssVarsTheme(direction, locale, themeMode), [direction, locale, themeMode]);
  const cache = direction === "rtl" ? cacheRtl : cacheLtr;

  const themeContextValue = useMemo(
    () => ({
      mode: themeMode,
      toggleTheme: () => undefined,
      isThemeChanging: false,
      setIsThemeChanging: () => undefined,
    }),
    [themeMode]
  );

  const isUiComponent = checkIsUiComponent(context);

  const content = (
    <Suspense fallback={<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 4 }} />}>
      <RenderStory Story={Story} context={context} />
    </Suspense>
  );

  // Calculate maxWidth based on viewport global
  const maxWidth = VIEWPORT_MAX_WIDTH[viewport];

  return (
    <LocaleProvider locale={locale}>
      <ThemeContext.Provider value={themeContextValue}>
        <CacheProvider value={cache}>
          <ThemeProvider
            theme={theme}
            defaultMode={themeMode}
            forceThemeRerender
            // Isolate from the app's `theme` localStorage key so the Storybook toolbar
            // controls the active palette instead of a persisted app preference.
            modeStorageKey="sb-theme"
          >
            <CssBaseline />
            <StorybookColorSchemeBridge mode={themeMode} direction={direction} locale={locale}>
              <GlobalStyles
                styles={muiTheme => ({
                  ".sbdocs-wrapper": {
                    maxWidth: "100% !important",
                    padding: "2rem !important",
                    backgroundColor: `${muiTheme.palette.background.default} !important`,
                  },
                  ".sbdocs-preview, .docs-story, .innerZoomElementWrapper, .docs-story > div, .sbdocs [role='toolbar']":
                    {
                      backgroundColor: `${muiTheme.palette.background.default} !important`,
                      borderColor: `${muiTheme.palette.divider} !important`,
                      color: `${muiTheme.palette.text.primary} !important`,
                    },
                  ".sbdocs-content": {
                    maxWidth: "100% !important",
                    width: "100% !important",
                  },
                  ".sbdocs-title, .sbdocs-h1, .sbdocs-h2, .sbdocs-h3": {
                    color: `${muiTheme.palette.text.primary} !important`,
                  },
                  ".sbdocs-p, .sbdocs-li, .sbdocs-a": {
                    color: `${muiTheme.palette.text.secondary} !important`,
                  },
                  ".sbdocs button, .sbdocs a, .sbdocs [role='toolbar'] button": {
                    color: `${muiTheme.palette.text.primary} !important`,
                  },
                })}
              />
              <ViewportProvider viewport={viewport}>
                {isUiComponent ? (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      minHeight: "100vh",
                      width: "100%",
                      padding: 4,
                      boxSizing: "border-box",
                      maxWidth: maxWidth === "none" ? "100%" : maxWidth,
                      mx: "auto",
                    }}
                  >
                    {content}
                  </Box>
                ) : (
                  content
                )}
              </ViewportProvider>
            </StorybookColorSchemeBridge>
          </ThemeProvider>
        </CacheProvider>
      </ThemeContext.Provider>
    </LocaleProvider>
  );
};

/**
 * A small helper component to render the story function.
 * This ensures that hooks called within the story are executed
 * within a child component's render cycle, properly inheriting
 * context from providers in StoryWrapper.
 */
function RenderStory({ Story, context }: Readonly<{ Story: StoryFn; context: StoryContext }>) {
  return <>{Story(context.args, context)}</>;
}
