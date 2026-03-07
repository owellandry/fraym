// One-time YouTube OAuth2 setup — run: bun run setup:yt
import { Innertube } from "youtubei.js";
import { saveCredentials } from "../lib/ytauth";

console.log("\n  fraym — YouTube Authentication Setup");
console.log("  ────────────────────────────────────\n");

const yt = await Innertube.create();

let done = false;

yt.session.on("auth-pending", (data: any) => {
  console.log("  Abre esta URL en cualquier dispositivo e inicia sesión con tu cuenta de Google:");
  console.log(`\n  → ${data.verification_url}\n`);
  console.log(`  Código: ${data.user_code}\n`);
  console.log("  Esperando autenticación...\n");
});

yt.session.on("auth", async ({ credentials }: any) => {
  await saveCredentials(credentials);
  console.log("  ✓ ¡Autenticado! Credenciales guardadas.");
  console.log("  Reinicia el servicio: docker compose restart\n");
  done = true;
});

yt.session.on("auth-error", (err: any) => {
  console.error("  ✗ Error de autenticación:", err.message ?? err);
  process.exit(1);
});

await yt.session.oauth.init();

// Wait for auth
while (!done) {
  await new Promise(r => setTimeout(r, 500));
}

process.exit(0);
