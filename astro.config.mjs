// @ts-check
import { defineConfig } from 'astro/config';

const localServerAdapter = {
	name: 'watchtower-local-server-adapter',
	entrypointResolution: 'auto',
	serverEntrypoint: 'astro/app/node',
	supportedAstroFeatures: {
		serverOutput: 'stable',
		staticOutput: 'stable',
		hybridOutput: 'stable',
		sharpImageService: 'stable',
	},
};

function localServerIntegration() {
	return {
		name: 'watchtower-local-server-integration',
		hooks: {
			'astro:config:done': ({ setAdapter }) => setAdapter(localServerAdapter),
		},
	};
}

// Dynamic authenticated app routes need server output so direct URLs such as
// /app/projects/{uuid} resolve in development and production.
export default defineConfig({
	output: 'server',
	adapter: localServerAdapter,
	integrations: [localServerIntegration()],
});
