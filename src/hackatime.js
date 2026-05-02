const axios = require("axios");

const BASE_URL = "https://hackatime.hackclub.com/api/v1";

/**
 * Check if a Hackatime user is currently coding.
 * Uses the /users/:username/status endpoint (heartbeat-based, ~2 min window).
 *
 * @param {string} username - Hackatime username
 * @returns {{ coding: boolean, project?: string, language?: string, editor?: string, todaySeconds?: number }}
 */
async function checkHackatimeStatus(username) {
  try {
    // Current status / heartbeat (last 2 minutes)
    const statusRes = await axios.get(`${BASE_URL}/users/${username}/status`, {
      headers: buildHeaders(),
      timeout: 5000,
    });

    const data = statusRes.data?.data ?? statusRes.data;

    // Hackatime returns is_coding_activity or a heartbeat object
    const coding =
      data?.is_coding_activity === true ||
      (data?.heartbeat_at && isRecent(data.heartbeat_at));

    if (!coding) {
      return { coding: false };
    }

    // Also fetch today's summary for total time
    let todaySeconds = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const summaryRes = await axios.get(
        `${BASE_URL}/users/${username}/summaries`,
        {
          headers: buildHeaders(),
          params: { start: today, end: today },
          timeout: 5000,
        }
      );
      const summary = summaryRes.data?.data?.[0];
      todaySeconds = summary?.grand_total?.total_seconds ?? null;
    } catch {
      // Non-fatal — status still works without today's total
    }

    return {
      coding: true,
      project: data?.project ?? data?.heartbeat?.project ?? null,
      language: data?.language ?? data?.heartbeat?.language ?? null,
      editor: data?.editor ?? data?.heartbeat?.editor ?? null,
      todaySeconds,
    };
  } catch (err) {
    console.error(
      `[hackatime] Error fetching status for ${username}:`,
      err.response?.data ?? err.message
    );
    // Return not-coding rather than crashing
    return { coding: false };
  }
}

function buildHeaders() {
  const headers = {};
  if (process.env.HACKATIME_SECRET) {
    headers["Authorization"] = `Bearer ${process.env.HACKATIME_SECRET}`;
  }
  return headers;
}

/**
 * True if the ISO timestamp is within the last 2 minutes.
 */
function isRecent(isoString) {
  const ts = new Date(isoString).getTime();
  return Date.now() - ts < 2 * 60 * 1000;
}

module.exports = { checkHackatimeStatus };
