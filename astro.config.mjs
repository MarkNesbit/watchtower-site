// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Dynamic authenticated app routes need server output so direct URLs such as
// /app/projects/{uuid} resolve in development and production on Cloudflare.
export default defineConfig({
	output: 'server',
	session: {
		driver: 'unstorage/drivers/null',
	},
	adapter: cloudflare({
		imageService: 'compile',
	}),
});
