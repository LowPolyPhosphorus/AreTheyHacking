const fs = require("fs");
const path = require("path");

// On Render, /tmp persists for the lifetime of the instance.
// For true persistence across deploys, swap this out for a DB or Render's disk.
const STORE_PATH = path.join(process.env.STORE_DIR || "/tmp", "users.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/**
 * Get Hackatime username for a Slack user ID.
 * @param {string} slackUserId
 * @returns {string|null}
 */
async function getUser(slackUserId) {
  const db = load();
  return db[slackUserId] ?? null;
}

/**
 * Save Hackatime username for a Slack user ID.
 * @param {string} slackUserId
 * @param {string} hackatimeUsername
 */
async function saveUser(slackUserId, hackatimeUsername) {
  const db = load();
  db[slackUserId] = hackatimeUsername;
  save(db);
}

module.exports = { getUser, saveUser };
