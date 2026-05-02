require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const { checkHackatimeStatus } = require("./hackatime");
const { getUser, saveUser } = require("./store");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Health check for Render
receiver.router.get("/health", (req, res) => res.send("OK"));

// ─── /hackatime slash command ─────────────────────────────────────────────────
app.command("/hackatime", async ({ command, ack, respond }) => {
  await ack();

  const parts = command.text.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (sub === "connect" && parts[1]) {
    const hackatimeUsername = parts[1].trim();
    await saveUser(command.user_id, hackatimeUsername);
    await respond({
      response_type: "ephemeral",
      text: `✅ Linked! I'll now watch for when you get @mentioned and let the channel know you're hacking.`,
    });
    return;
  }

  if (sub === "status") {
    const linked = await getUser(command.user_id);
    if (!linked) {
      await respond({
        response_type: "ephemeral",
        text: `You haven't linked a Hackatime account yet. Run \`/hackatime connect <your-username>\` to set it up.`,
      });
      return;
    }
    const status = await checkHackatimeStatus(linked);
    await respond({
      response_type: "ephemeral",
      text: status.coding
        ? `🟢 You're currently hacking — working on *${status.project || "something"}* in *${status.language || "unknown language"}*.`
        : `⚫ No active Hackatime session detected right now.`,
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `*Hackatime Bot commands:*\n• \`/hackatime connect <username>\` — link your Hackatime account\n• \`/hackatime status\` — check your own current status`,
  });
});

// ─── Silently watch ALL messages for @mentions of linked users ────────────────
// No need to @bot. Only replies when the mentioned person IS actively coding.
// Complete silence if not coding, not linked, or message is from a bot.
app.event("message", async ({ event, say }) => {
  // Ignore bot messages, edits, deletions, anything without text
  if (event.subtype || event.bot_id || !event.text) return;

  // Extract all @mentioned Slack user IDs
  const mentionedIds = [...event.text.matchAll(/<@([A-Z0-9]+)>/g)].map(
    (m) => m[1]
  );
  if (mentionedIds.length === 0) return;

  for (const userId of mentionedIds) {
    // Skip self-mentions
    if (userId === event.user) continue;

    // Only act on users who have linked their Hackatime account
    const hackatimeUsername = await getUser(userId);
    if (!hackatimeUsername) continue; // not linked — stay silent

    const status = await checkHackatimeStatus(hackatimeUsername);
    if (!status.coding) continue; // not coding — stay silent

    // Only reaches here if: linked AND actively coding right now
    await say({
      channel: event.channel,
      thread_ts: event.ts,
      blocks: buildCodingBlocks(userId, hackatimeUsername, status),
      text: `Heads up — <@${userId}> is currently hacking on ${status.project || "a project"}!`,
    });
  }
});

// ─── Block builder ────────────────────────────────────────────────────────────

function buildCodingBlocks(userId, username, status) {
  const langEmoji = getLangEmoji(status.language);
  const durationText = status.todaySeconds
    ? `${Math.floor(status.todaySeconds / 3600)}h ${Math.floor((status.todaySeconds % 3600) / 60)}m coded today`
    : null;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🟢 *<@${userId}> is currently hacking!*\nThey may be heads-down — you might want to expect some delays in their response.`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Project*\n📁 ${status.project || "Unknown"}`,
        },
        {
          type: "mrkdwn",
          text: `*Language*\n${langEmoji} ${status.language || "Unknown"}`,
        },
        ...(status.editor
          ? [{ type: "mrkdwn", text: `*Editor*\n🖥️ ${status.editor}` }]
          : []),
        ...(durationText
          ? [{ type: "mrkdwn", text: `*Today's Session*\n⏱️ ${durationText}` }]
          : []),
      ],
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Powered by Hackatime • \`${username}\``,
        },
      ],
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
  console.log(`⚡ Hackatime Slack Bot running on port ${PORT}`);
})();
