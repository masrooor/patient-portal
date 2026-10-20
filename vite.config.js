import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const envDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const tunnelHost = env.CLOUDFLARE_TUNNEL_HOST?.trim();
  return {
    envDir,
    server: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: true,
      allowedHosts: [
        "technological-missed-remarkable-flashers.trycloudflare.com",
        ...(tunnelHost ? [tunnelHost] : []),
      ],
    },
  };
});
