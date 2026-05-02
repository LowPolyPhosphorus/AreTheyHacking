const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../tokens.json");

function load() {
  if (!fs.existsSync(STORE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function save(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

async function getToken(slackUserId) {
  const store = load();
  return store[slackUserId]?.access_token ?? null;
}

async function saveToken(slackUserId, accessToken, hackatimeUser) {
  const store = load();
  store[slackUserId] = {
    access_token: accessToken,
    hackatime_id: hackatimeUser?.id ?? null,
    slack_id: hackatimeUser?.slack_id ?? null,
    registered_at: new Date().toISOString(),
  };
  save(store);
}

module.exports = { getToken, saveToken };
