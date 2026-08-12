import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;
const base = process.env.BASE;

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
  ...(site ? { site } : {}),
  ...(base ? { base } : {}),
});
