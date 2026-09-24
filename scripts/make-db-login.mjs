// Creates Armada's database login: a random password written to .env.local,
// and the SCRAM verifier (a one-way hash) that goes into the database.
// The plain password never leaves this machine except inside the connection string.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRef = process.argv[2];
const poolerHost = process.argv[3];
if (!projectRef || !poolerHost) {
  console.error("usage: node scripts/make-db-login.mjs <project-ref> <pooler-host>");
  process.exit(1);
}

const password = crypto.randomBytes(24).toString("base64url").replace(/[-_]/g, "x");
const salt = crypto.randomBytes(16);
const iterations = 4096;
const salted = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
const storedKey = crypto.createHash("sha256").update(clientKey).digest();
const serverKey = crypto.createHmac("sha256", salted).update("Server Key").digest();
const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;

const url = `postgresql://armada_app.${projectRef}:${password}@${poolerHost}:6543/postgres`;
const envPath = path.join(process.cwd(), ".env.local");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
env = env.replace(/^DATABASE_URL=.*\n?/m, "");
env += `DATABASE_URL=${url}\n`;
fs.writeFileSync(envPath, env);

fs.writeFileSync(path.join(process.cwd(), ".db-verifier.tmp"), verifier);
console.log("wrote DATABASE_URL to .env.local and the verifier to .db-verifier.tmp");
