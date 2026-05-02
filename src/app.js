require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const { checkHackatimeStatus } = require("./hackatime");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Health check for Render
receiver.router.get("/health", (req, res) => res.send("OK"));

// ─── /aretheyhacking [username] ───────────────────────────────────────────────
// No args → check yourself
// With username → check that person
app.command("/aretheyhacking", async ({ command, ack, respond, client }) => {
  await ack();

  let targetSlackUsername;
  let targetDisplayName;

  const arg = command.text.trim();

  if (!arg) {
    // No argument — check the person who ran the command
    const userInfo = await client.users.info({ user: command.user_id });
    targetSlackUsername = userInfo.user.name; // Hack Club SSO username
    targetDisplayName = `<@${command.user_id}>`;
  } else {
    // Strip <@U...> mention format if they @mentioned someone
    const mentionMatch = arg.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/);
    if (mentionMatch) {
      const userInfo = await client.users.info({ user: mentionMatch[1] });
      targetSlackUsername = userInfo.user.name;
      targetDisplayName = `<@${mentionMatch[1]}>`;
    } else {
      // Plain text username
      targetSlackUsername = arg.replace(/^@/, "");
      targetDisplayName = `@${targetSlackUsername}`;
    }
  }

  const status = await checkHackatimeStatus(targetSlackUsername);

  await respond({
    response_type: "in_channel",
    blocks: buildStatusBlocks(targetDisplayName, targetSlackUsername, status),
    text: status.coding
      ? `${targetDisplayName} is currently hacking on ${status.project || "a project"}!`
      : `${targetDisplayName} doesn't appear to be hacking right now.`,
  });
});

// ─── Silently watch ALL messages for @mentions ────────────────────────────────
// Only replies if the mentioned person is actively coding on Hackatime.
app.event("message", async ({ event, client, say }) => {
  if (event.subtype || event.bot_id || !event.text) return;

  const mentionedIds = [...event.text.matchAll(/<@([A-Z0-9]+)>/g)].map(
    (m) => m[1]
  );
  if (mentionedIds.length === 0) return;

  for (const userId of mentionedIds) {
    if (userId === event.user) continue;

    let slackUsername;
    try {
      const userInfo = await client.users.info({ user: userId });
      slackUsername = userInfo.user.name;
    } catch {
      continue;
    }

    const status = await checkHackatimeStatus(slackUsername);
    if (!status.coding) continue; // silent if not coding

    await say({
      channel: event.channel,
      thread_ts: event.ts,
      blocks: buildStatusBlocks(`<@${userId}>`, slackUsername, status),
      text: `Heads up — <@${userId}> is currently hacking on ${status.project || "a project"}!`,
    });
  }
});

// ─── Block builder ────────────────────────────────────────────────────────────

function buildStatusBlocks(displayName, username, status) {
  if (!status.coding) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚫ *${displayName} isn't currently hacking.*\nNo Hackatime activity in the last 2 minutes — they should be free!`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Hackatime user: \`${username}\`` }],
      },
    ];
  }

  const langEmoji = getLangEmoji(status.language);
  const durationText = status.todaySeconds
    ? `${Math.floor(status.todaySeconds / 3600)}h ${Math.floor((status.todaySeconds % 3600) / 60)}m coded today`
    : null;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🟢 *${displayName} is currently hacking!*\nThey may be heads-down — expect some delays in their response.`,
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
        { type: "mrkdwn", text: `Powered by Hackatime • \`${username}\`` },
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
