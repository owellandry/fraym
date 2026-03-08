import { defineConfig, type Plugin } from "vite";
import { builtinModules } from "module";
import openvite from "openvite";

// Plugin to externalize Node.js built-ins in RSC build
function nodeExternals(): Plugin {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ]);
  return {
    name: "node-externals",
    enforce: "pre",
    resolveId(id) {
      if (builtins.has(id)) {
        return { id, external: true };
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeExternals(), openvite()],
  server: {
    port: parseInt(process.env.PORT || "3000"),
    host: "0.0.0.0",
  },
  preview: {
    port: parseInt(process.env.PORT || "3000"),
    host: "0.0.0.0",
  },
});
