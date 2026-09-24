// Runs eBay's account-deletion check against the live address and compares the answer with the
// hash computed locally from .env.local. Prints only match / no match.
import crypto from "node:crypto";

const token = process.env.EBAY_VERIFICATION_TOKEN;
const endpoint = process.env.EBAY_DELETION_ENDPOINT;
const challenge = crypto.randomBytes(12).toString("hex");
const res = await fetch(`${endpoint}?challenge_code=${challenge}`);
const body = await res.json().catch(() => ({}));
const expected = crypto.createHash("sha256").update(challenge + token + endpoint).digest("hex");
console.log(`status ${res.status}, content-type ${res.headers.get("content-type")}, ${body.challengeResponse === expected ? "answer matches" : "ANSWER DOES NOT MATCH"}`);
const post = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { notificationId: "armada-selfcheck", data: { username: "nobody-selfcheck", userId: "nobody-selfcheck" } } }) });
console.log(`notice POST answered ${post.status}`);
