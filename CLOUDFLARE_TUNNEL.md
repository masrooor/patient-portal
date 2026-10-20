# Cloudflare tunnel

Start the portal in the project directory:

```powershell
npm.cmd run dev
```

Open http://localhost:4174/ locally. In a second terminal, start a quick tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:4174 --http-host-header localhost
```

Keep both terminals running. Cloudflared prints the public HTTPS URL. Each new quick tunnel usually gets a different URL; a disconnected older URL may show error 1033.

The localhost Host header lets Vite accept the forwarded request without allowing arbitrary hostnames. The previous tunnel hostname is also explicitly allowed. For a tunnel preserving its public Host header, add its hostname (no scheme or path) to the root `.env` and restart the server:

```dotenv
CLOUDFLARE_TUNNEL_HOST=your-new-host.trycloudflare.com
```

The port is fixed at 4174. If it is occupied, stop this project's existing server rather than pointing the tunnel at a different process. Patient access still requires Supabase sign-in; tunnel and localhost have separate browser sessions.
