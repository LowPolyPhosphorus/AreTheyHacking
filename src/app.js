require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const { checkHackatimeStatus } = require("./hackatime");
const { getToken, saveToken } = require("./store");
const axios = require("axios");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// ─── Health check ─────────────────────────────────────────────────────────────
receiver.router.get("/health", (req, res) => res.send("OK"));

// ─── OAuth callback from Hackatime ────────────────────────────────────────────
receiver.router.get("/auth/callback", async (req, res) => {
  const { code, state: slackUserId, error } = req.query;

  if (error || !code || !slackUserId) {
    return res.send("Authorization denied or something went wrong. You can close this tab.");
  }

  try {
    const tokenRes = await axios.post(
      "https://hackatime.hackclub.com/oauth/token",
      {
        client_id: process.env.HACKATIME_CLIENT_ID,
        client_secret: process.env.HACKATIME_CLIENT_SECRET,
        code,
        redirect_uri: process.env.APP_URL + "/auth/callback",
        grant_type: "authorization_code",
      }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error("No access token in response");

    const meRes = await axios.get(
      "https://hackatime.hackclub.com/api/v1/authenticated/me",
      { headers: { Authorization: "Bearer " + accessToken } }
    );

    const hackatimeUser = meRes.data;
    await saveToken(slackUserId, accessToken, hackatimeUser);

    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: slackUserId,
      text: "✅ You're registered! When someone @mentions you, I'll let them know if you're hacking.",
    });

    res.send("All good! You're registered. You can close this tab and go back to hacking. 🟢");
  } catch (err) {
    console.error("[oauth callback]", err.response?.data ?? err.message);
    res.send("Something went wrong exchanging your token. Try /register again.");
  }
});

// ─── /register ────────────────────────────────────────────────────────────────
app.command("/register", async ({ command, ack, client }) => {
  await ack();

  const authUrl =
    "https://hackatime.hackclub.com/oauth/authorize" +
    "?client_id=" + process.env.HACKATIME_CLIENT_ID +
    "&redirect_uri=" + encodeURIComponent(process.env.APP_URL + "/auth/callback") +
    "&response_type=code" +
    "&scope=profile+read" +
    "&state=" + command.user_id;

  await client.chat.postMessage({
    channel: command.user_id,
    text: "👋 Click here to link your Hackatime account:\n" + authUrl + "\n\nThis lets the bot check if you're currently hacking when someone @mentions you.",
  });

  await client.chat.postEphemeral({
    channel: command.channel_id,
    user: command.user_id,
    text: "📬 Check your DMs — I sent you a link to connect your Hackatime account!",
  });
});

// ─── /aretheyhacking ──────────────────────────────────────────────────────────
app.command("/aretheyhacking", async ({ command, ack, respond, client }) => {
  await ack();

  let targetUserId;
  let targetDisplayName;

  const arg = command.text.trim();
  console.log("[debug] command arg:", JSON.stringify(arg));

  if (!arg) {
    targetUserId = command.user_id;
    targetDisplayName = "<@" + command.user_id + ">";
  } else {
    const mentionMatch = arg.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/);
    if (mentionMatch) {
      targetUserId = mentionMatch[1];
      targetDisplayName = "<@" + mentionMatch[1] + ">";
    } else {
      try {
        const list = await client.users.list();
        const clean = arg.replace(/^@/, "");
        const found = list.members.find(
          (m) => m.name === clean || m.profile?.display_name === clean
        );
        if (found) {
          targetUserId = found.id;
          targetDisplayName = "<@" + found.id + ">";
        } else {
          await respond({ response_type: "ephemeral", text: "Couldn't find user `" + arg + "`." });
          return;
        }
      } catch {
        await respond({ response_type: "ephemeral", text: "Couldn't look up that user." });
        return;
      }
    }
  }

  const token = await getToken(targetUserId);
  if (!token) {
    await respond({
      response_type: "in_channel",
      text: "🤷 " + targetDisplayName + " hasn't linked their Hackatime account yet. They can run `/register` to connect.",
    });
    return;
  }

  const status = await checkHackatimeStatus(token);

  await respond({
    response_type: "in_channel",
    blocks: buildStatusBlocks(targetDisplayName, status),
    text: status.coding
      ? targetDisplayName + " is currently hacking!"
      : targetDisplayName + " isn't hacking right now.",
  });
});

// ─── Passive @mention listener (works in public + private channels) ───────────
async function handleMentionEvent(event, say) {
  if (event.subtype || event.bot_id || !event.text) return;

  const mentionedIds = [...event.text.matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
  if (mentionedIds.length === 0) return;

  console.log("[debug] message event channel_type:", event.channel_type, "mentions:", mentionedIds);

  for (const userId of mentionedIds) {
    if (userId === event.user) continue;

    const token = await getToken(userId);
    if (!token) continue;

    const status = await checkHackatimeStatus(token);
    if (!status.coding) continue;

    await say({
      channel: event.channel,
      thread_ts: event.ts,
      blocks: buildStatusBlocks("<@" + userId + ">", status),
      text: "Heads up — <@" + userId + "> is currently hacking!",
    });
  }
}

app.event("message", async ({ event, say }) => handleMentionEvent(event, say));

// ─── Block builder ────────────────────────────────────────────────────────────
function buildStatusBlocks(displayName, status) {
  if (!status.coding) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚫ *" + displayName + " isn't currently hacking.*\nNo activity in the last 2 minutes — they should be free!",
        },
      },
    ];
  }

  const langEmoji = getLangEmoji(status.language);
  const durationText = status.todaySeconds
    ? Math.floor(status.todaySeconds / 3600) + "h " + Math.floor((status.todaySeconds % 3600) / 60) + "m coded today"
    : null;

  const fields = [
    { type: "mrkdwn", text: "*Project*\n📁 " + (status.project || "Unknown") },
    { type: "mrkdwn", text: "*Language*\n" + langEmoji + " " + (status.language || "Unknown") },
  ];
  if (status.editor) fields.push({ type: "mrkdwn", text: "*Editor*\n🖥️ " + status.editor });
  if (durationText) fields.push({ type: "mrkdwn", text: "*Today*\n⏱️ " + durationText });

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🟢 *" + displayName + " is currently hacking!*\nThey may be heads-down — expect some delays.",
      },
    },
    { type: "section", fields },
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "Powered by Hackatime" }],
    },
  ];
}

function getLangEmoji(language) {
  if (!language) return "💻";
  const l = language.toLowerCase();
  if (l.includes("python")) return "🐍";
  if (l.includes("javascript") || l.includes("typescript")) return "🟨";
  if (l.includes("rust")) return "🦀";
  if (l.includes("go")) return "🐹";
  if (l.includes("java")) return "☕";
  if (l.includes("c++") || l.includes("cpp")) return "⚙️";
  if (l.includes("ruby")) return "💎";
  if (l.includes("html") || l.includes("css")) return "🌐";
  if (l.includes("shell") || l.includes("bash")) return "🐚";
  return "💻";
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
(async () => {
  await app.start(PORT);
  console.log("⚡ AreTheyHacking running on port " + PORT);
})();
