// YouTube OAuth2 credential storage
import path from "path";
import fs from "fs/promises";

const AUTH_FILE = path.join(process.cwd(), "tmp", ".ytauth.json");

export async function loadCredentials(): Promise<Record<string, any> | undefined> {
  try {
    const data = await fs.readFile(AUTH_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export async function saveCredentials(credentials: Record<string, any>) {
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify(credentials, null, 2), "utf-8");
}
