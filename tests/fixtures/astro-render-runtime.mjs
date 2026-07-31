export * from 'astro/runtime/server/index.js';

// The compiler metadata helper is normally injected by Astro's Vite runtime.
// Component rendering tests do not consume that metadata, so this minimal
// equivalent lets the compiled server renderer execute in Node.
export const createMetadata = () => ({});
