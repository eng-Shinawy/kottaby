import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../frontend/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
    "msw-storybook-addon",
  ],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  async viteFinal(cfg) {
    return mergeConfig(cfg, {
      resolve: {
        alias: {
          "@": path.resolve(projectRoot, ".."),
        },
      },
    });
  },
};
export default config;
