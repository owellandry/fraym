// One-time YouTube OAuth2 setup — run: bun run setup:yt
import { Innertube, UniversalCache } from "youtubei.js";
import path from "path";
import fs from "fs/promises";

const CACHE_DIR = path.join(process.cwd(), "tmp", ".ytcache");
await fs.mkdir(CACHE_DIR, { recursive: true });

console.log("\n  fraym — YouTube Authentication Setup");
console.log("  ────────────────────────────────────\n");

const yt = await Innertube.create({
  cache: new UniversalCache(true, CACHE_DIR),
});

let done = false;

yt.session.on("auth-pending", (data: any) => {
  console.log("  Abre esta URL en cualquier dispositivo e inicia sesión con tu cuenta de Google:");
  console.log(`\n  → ${data.verification_url}\n`);
  console.log(`  Código: ${data.user_code}\n`);
  console.log("  Esperando autenticación...\n");
});

yt.session.on("auth", async () => {
  console.log("  ✓ ¡Autenticado! Credenciales guardadas en cache.");
  console.log("  Reinicia el servicio: docker compose restart\n");
  done = true;
});

yt.session.on("auth-error", (err: any) => {
  console.error("  ✗ Error de autenticación:", err.message ?? err);
  process.exit(1);
});

// This will check cache first; if no credentials, starts device flow
await yt.session.oauth.init();

if (!done) {
  // Credentials loaded from cache, verify they work
  console.log("  ✓ Credenciales cargadas del cache. Logged in:", yt.session.logged_in);

  // Test with a video
  try {
    const info = await yt.getInfo("dQw4w9WgXcQ");
    console.log("  ✓ Test OK — Video:", info.basic_info.title);
  } catch (e: any) {
    console.log("  ✗ Test failed:", e.message);
  }
  process.exit(0);
}

// Wait for fresh auth
while (!done) {
  await new Promise(r => setTimeout(r, 500));
}

process.exit(0);
