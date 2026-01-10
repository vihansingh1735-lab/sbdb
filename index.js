// ===== KEEPALIVE =====
const express = require("express");
const app = express();
app.get("/", (_, res) => res.send("Bot alive"));
const PORT = process.env.PORT || 3000;
app.listen(PORT);

// ===== IMPORTS =====
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType
} = require("discord.js");
const fs = require("fs");

// ===== CONSTANTS =====
const CHECK_INTERVAL = 60_000;
const DATA_FILE = "./data.json";

// ===== GAME MAP =====
const GAME_MAP = {
  2534724415: "Emergency Hamburg 🚨",
  4924922222: "Brookhaven 🏡RP",
  920587237: "Adopt Me 🐶",
  2753915549: "Blox Fruits 🍏"
};

// ===== LOAD DATA =====
let data = { tracked: {}, channels: {}, messages: {}, playtime: {} };
if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
const save = () =>
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ===== CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===== ROBLOX API =====
async function getRobloxUser(username) {
  const r = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username] })
  });
  const d = await r.json();
  return d.data?.[0] || null;
}

async function getPresence(userId) {
  const r = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [userId] })
  });
  const d = await r.json();
  return d.userPresences?.[0] || null;
}

async function getAvatar(userId) {
  const r = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`
  );
  const d = await r.json();
  return d.data?.[0]?.imageUrl || null;
}

// ===== TIME HELPERS =====
const dayId = () => new Date().toDateString();
const weekId = () => {
  const d = new Date();
  return `${d.getFullYear()}-${Math.ceil(
    ((d - new Date(d.getFullYear(), 0, 1)) / 86400000 +
      new Date(d.getFullYear(), 0, 1).getDay() +
      1) / 7
  )}`;
};
const monthId = () =>
  `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;

const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;

function resolveGame(p) {
  if (p.placeId && GAME_MAP[p.placeId]) return GAME_MAP[p.placeId];
  if (p.lastLocation && !["In Game", "Website"].includes(p.lastLocation))
    return p.lastLocation;
  return "Playing Roblox 🎮";
}

// ===== TRACK LOOP =====
async function checkUsers() {
  for (const discordId in data.tracked) {
    const { robloxId, displayName } = data.tracked[discordId];
    const channelId = data.channels[discordId];
    if (!channelId) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    const presence = await getPresence(robloxId);

    data.playtime[discordId] ??= {
      daily: 0,
      weekly: 0,
      monthly: 0,
      d: dayId(),
      w: weekId(),
      m: monthId()
    };

    const pt = data.playtime[discordId];

    if (pt.d !== dayId()) (pt.daily = 0), (pt.d = dayId());
    if (pt.w !== weekId()) (pt.weekly = 0), (pt.w = weekId());
    if (pt.m !== monthId()) (pt.monthly = 0), (pt.m = monthId());

    if (!presence || presence.userPresenceType !== 2) {
      if (data.messages[discordId]) {
        await channel.messages
          .delete(data.messages[discordId])
          .catch(() => {});
        delete data.messages[discordId];
        save();
      }
      continue;
    }

    pt.daily += 60;
    pt.weekly += 60;
    pt.monthly += 60;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(displayName)
      .setURL(`https://www.roblox.com/users/${robloxId}/profile`)
      .setThumbnail(await getAvatar(robloxId))
      .addFields(
        { name: "Game", value: `**${resolveGame(presence)}**` },
        { name: "Today", value: fmt(pt.daily) },
        { name: "Week", value: fmt(pt.weekly) },
        { name: "Month", value: fmt(pt.monthly) }
      )
      .setFooter({ text: "Roblox Live Presence • updates every minute" })
      .setTimestamp();

    if (data.messages[discordId]) {
      const msg = await channel.messages
        .fetch(data.messages[discordId])
        .catch(() => null);
      if (msg) await msg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      data.messages[discordId] = msg.id;
      save();
    }
  }
}

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Track a Roblox user")
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Stop tracking"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View your playtime"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View leaderboard")
    .addStringOption(o =>
      o
        .setName("type")
        .setDescription("daily / weekly / monthly")
        .setRequired(true)
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Weekly", value: "weekly" },
          { name: "Monthly", value: "monthly" }
        )
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

// ===== READY =====
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox playtime", {
    type: ActivityType.Watching
  });
  setInterval(checkUsers, CHECK_INTERVAL);
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "add") {
    const user = await getRobloxUser(i.options.getString("username"));
    if (!user)
      return i.reply({ content: "User not found", ephemeral: true });

    data.tracked[i.user.id] = {
      robloxId: user.id,
      displayName: user.displayName || user.name
    };
    data.channels[i.user.id] = i.channelId;
    save();

    await i.reply({ content: "✅ Tracking started", ephemeral: true });
    checkUsers();
  }

  if (i.commandName === "remove") {
    delete data.tracked[i.user.id];
    delete data.playtime[i.user.id];
    delete data.channels[i.user.id];
    save();
    i.reply({ content: "🗑️ Tracking removed", ephemeral: true });
  }

  if (i.commandName === "stats") {
    const pt = data.playtime[i.user.id];
    if (!pt)
      return i.reply({ content: "No data yet", ephemeral: true });

    i.reply(
      `📊 **Your Playtime**\nToday: ${fmt(pt.daily)}\nWeek: ${fmt(
        pt.weekly
      )}\nMonth: ${fmt(pt.monthly)}`
    );
  }

  if (i.commandName === "leaderboard") {
    const type = i.options.getString("type");
    const list = Object.entries(data.playtime)
      .sort((a, b) => b[1][type] - a[1][type])
      .slice(0, 10)
      .map(
        ([id, v], i) =>
          `**${i + 1}.** <@${id}> — ${fmt(v[type])}`
      )
      .join("\n");

    i.reply(`🏆 **${type.toUpperCase()} Leaderboard**\n${list || "No data"}`);
  }
});

// ===== LOGIN =====
client.login(process.env.TOKEN);
