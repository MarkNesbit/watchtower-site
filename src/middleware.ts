import { defineMiddleware } from 'astro:middleware';

// This site currently builds as static output, so middleware cannot prove a
// Supabase session at the edge/server. Do not treat client-written marker
// cookies as authentication; protected pages perform a real Supabase session
// check in the browser before revealing placeholder app content.
export const onRequest = defineMiddleware((_context, next) => next());
