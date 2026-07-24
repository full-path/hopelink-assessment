import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built assets resolve correctly under a GitHub Pages
  // project subpath (https://<user>.github.io/<repo>/) without hardcoding the
  // repo name here.
  base: "./",
});
