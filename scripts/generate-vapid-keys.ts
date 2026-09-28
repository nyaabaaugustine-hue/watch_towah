/**
 * Generates a VAPID key pair for Web Push and prints the lines to paste into
 * .env.local. Run with: npm run keygen:vapid
 *
 * The keys are written to stdout only. Nothing here touches .env.local, so the
 * private key never lands in a file the app might commit or a log the user
 * forgets to clear.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webpush = require("web-push") as { generateVAPIDKeys: () => { publicKey: string; privateKey: string } };

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("Add these to .env.local:\n");
console.log(`VAPID_PUBLIC_KEY="${publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`);
console.log('VAPID_SUBJECT_MAILTO="mailto:you@example.com"');
console.log("\nVAPID_SUBJECT_MAILTO must be a mailto: or https: URL identifying the sender.");
console.log("Keep VAPID_PRIVATE_KEY secret. Losing it means every existing");
console.log("subscription has to be re-registered on each device.");
