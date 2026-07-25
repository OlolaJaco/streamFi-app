/**
 * Explicit PostCSS pipeline for Tailwind.
 *
 * Next.js can infer a default Tailwind/autoprefixer PostCSS config when none
 * is present, but that default has changed across Next major versions and is
 * undocumented behavior to depend on — the exact failure mode reported here
 * (utility classes, including flex/flexbox ones, silently not applied in a
 * production build while looking fine in dev) is what happens when the
 * PostCSS plugin chain that runs `@tailwind` directives isn't wired up the
 * same way for both. Declaring it explicitly removes that ambiguity (fixes
 * #192).
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
