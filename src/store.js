const axios = require("axios");

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`;
const HEADERS = {
  "X-Master-Key": process.env.JSONBIN_API_KEY,
  "Content-Type": "application/json",
};

async function load() {
  const res = await axios.get(JSONBIN_URL, { headers: HEADERS });
  return res.data.record ?? {};
}

async function save(data) {
  await axios.put(JSONBIN_URL, data, { headers: HEADERS });
}

async function getToken(slackUserId) {
  const store = await load();
  return store[slackUserId]?.access_token ?? null;
}

async function saveToken(slackUserId, accessToken, hackatimeUser) {
  const store = await load();
  store[slackUserId] = {
    access_token: accessToken,
    hackatime_id: hackatimeUser?.id ?? null,
    slack_id: hackatimeUser?.slack_id ?? null,
    registered_at: new Date().toISOString(),
  };
  await save(store);
}

module.exports = { getToken, saveToken };
