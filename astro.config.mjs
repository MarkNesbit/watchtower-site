// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Dynamic authenticated app routes need server output so direct URLs such as
// /app/projects/{uuid} resolve in development and production.
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
});
