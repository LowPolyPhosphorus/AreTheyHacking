const axios = require("axios");

/**
 * Check if a user is currently hacking using their OAuth access token.
 * Uses /api/v1/authenticated/heartbeats/latest to get their most recent heartbeat.
 *
 * @param {string} accessToken - The user's Hackatime OAuth access token
 * @returns {{ coding: boolean, project?: string, language?: string, editor?: string, todaySeconds?: number }}
 */
async function checkHackatimeStatus(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    // Get latest heartbeat
    const heartbeatRes = await axios.get(
      "https://hackatime.hackclub.com/api/v1/authenticated/heartbeats/latest",
      { headers, timeout: 5000 }
    );

    const heartbeat = heartbeatRes.data;

    console.log("[debug] latest heartbeat:", JSON.stringify(heartbeat));
    console.log("[debug] now:", new Date().toISOString());

    if (!heartbeat?.created_at) return { coding: false };

    const coding = isRecent(heartbeat.created_at);
    if (!coding) return { coding: false };

    // Get today's total seconds
    let todaySeconds = null;
    try {
      const hoursRes = await axios.get(
        "https://hackatime.hackclub.com/api/v1/authenticated/hours",
        {
          headers,
          params: {
            start_date: new Date().toISOString().split("T")[0],
            end_date: new Date().toISOString().split("T")[0],
          },
          timeout: 5000,
        }
      );
      todaySeconds = hoursRes.data?.total_seconds ?? null;
    } catch {
      // non-fatal
    }

    return {
      coding: true,
      project: heartbeat.project ?? null,
      language: heartbeat.language ?? null,
      editor: heartbeat.editor ?? null,
      todaySeconds,
    };
  } catch (err) {
    console.error("[hackatime]", err.response?.status, err.response?.data ?? err.message);
    return { coding: false };
  }
}

/**
 * True if the ISO timestamp is within the last 2 minutes.
 */
function isRecent(isoString) {
  const ts = new Date(isoString).getTime();
  return Date.now() - ts < 2 * 60 * 1000;
}

module.exports = { checkHackatimeStatus };
