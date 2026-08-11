import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
  ...(site ? { site } : {}),
});
