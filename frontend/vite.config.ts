import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET ?? "http://localhost:1997";
  const devPluginProxyTarget = env.VITE_DEV_PLUGIN_PROXY_TARGET ?? "http://localhost:3000";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
        },
        "/plugin-api": {
          target: devPluginProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/plugin-api/, "/api/v1"),
        },
      },
    },
  };
});
