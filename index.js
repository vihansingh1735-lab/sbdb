// ================== KEEPALIVE (RENDER) ==================
const express = require("express");
const app = express();
app.get("/", (_, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

// ================== IMPORTS ==================
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionsBitField,
  REST,
  Routes,
  ActivityType
} = require("discord.js");
const fs = require("fs");

// ================== CONFIG ==================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BOT_OWNER_ID = process.env.OWNER_ID; // your Discord ID
const PREFIX = "!";
const CHECK_INTERVAL = 60_000;
const DB_FILE = "./data.json";

// ================== HELPERS ==================
const isBotOwner = id => id === BOT_OWNER_ID;
const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;

const dayId = () => new Date().toDateString();
const weekId = () => {
  const d = new Date();
  return `${d.getFullYear()}-W${Math.ceil(
    ((d - new Date(d.getFullYear(), 0, 1)) / 86400000 +
      new Date(d.getFullYear(), 0, 1).getDay() +
      1) / 7
  )}`;
};
const monthId = () =>
  `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;

// ================== DATABASE ==================
let data = { tracked: {}, channels: {}, messages: {}, playtime: {} };
if (fs.existsSync(DB_FILE)) {
  data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// ================== ROBLOX API ==================
async function getRobloxUser(username) {
  const r = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username] })
  });
  const j = await r.json();
  return j.data?.[0] || null;
}

async function getPresence(id) {
  const r = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [id] })
  });
  const j = await r.json();
  return j.userPresences?.[0] || null;
}

// ================== CLIENT ==================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// ================== ACTIVITY CHECK ==================
async function startActivityCheck(channel) {
  const msg = await channel.send("@everyone

ACTIVITY CHECK



Let's keep this server alive and thriving! React ✅ to show you're active.

Top 3 responders will be highlighted !



Help us keep the community strong and engaging 💬🎉**");
  await msg.react("✅");

  const winners = new Set();
  const collector = msg.createReactionCollector({
    filter: (r, u) => r.emoji.name === "✅" && !u.bot,
    time: 600000
  });

  collector.on("collect", (_, user) => {
    winners.add(user.id);
    if (winners.size === 3) collector.stop();
  });

  collector.on("end", () => {
    if (winners.size < 3)
      return channel.send("⏳ Not enough participants.");
    const [a, b, c] = [...winners];
    channel.send(
      `🏆 **Winners**\n🥇 <@${a}>\n🥈 <@${b}>\n🥉 <@${c}>`
    );
  });
}

// ================== TRACK LOOP ==================
async function checkUsers() {
  for (const did in data.tracked) {
    const { robloxId } = data.tracked[did];
    const channel = await client.channels
      .fetch(data.channels[did])
      .catch(() => null);
    if (!channel) continue;

    const presence = await getPresence(robloxId);
    if (!presence || presence.userPresenceType !== 2) continue;

    data.playtime[did] ??= {
      daily: 0,
      weekly: 0,
      monthly: 0,
      d: dayId(),
      w: weekId(),
      m: monthId()
    };

    const pt = data.playtime[did];
    if (pt.d !== dayId()) (pt.daily = 0), (pt.d = dayId());
    if (pt.w !== weekId()) (pt.weekly = 0), (pt.w = weekId());
    if (pt.m !== monthId()) (pt.monthly = 0), (pt.m = monthId());

    pt.daily += 60;
    pt.weekly += 60;
    pt.monthly += 60;
    save();
  }
}

// ================== SLASH COMMANDS ==================
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
    .setDescription("Your playtime"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top playtime")
    .addStringOption(o =>
      o.setName("type")
      .setDescription("Leaderboard Type") 
        .setRequired(true)
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Weekly", value: "weekly" },
          { name: "Monthly", value: "monthly" }
        )
    ),
  new SlashCommandBuilder()
    .setName("activitycheck")
    .setDescription("Start activity check")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
})();

// ================== READY ==================
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox Playtime", {
    type: ActivityType.Watching
  });
  setInterval(checkUsers, CHECK_INTERVAL);
});

// ================== INTERACTIONS ==================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "activitycheck") {
    if (
      !isBotOwner(i.user.id) &&
      !i.member.permissions.has(PermissionsBitField.Flags.Administrator)
    )
      return i.reply({ content: "Admin or bot owner only", ephemeral: true });

    i.reply({ content: "Started", ephemeral: true });
    startActivityCheck(i.channel);
  }

  if (i.commandName === "add") {
    const u = await getRobloxUser(i.options.getString("username"));
    if (!u) return i.reply({ content: "User not found", ephemeral: true });

    data.tracked[i.user.id] = { robloxId: u.id };
    data.channels[i.user.id] = i.channelId;
    save();
    i.reply({ content: "Tracking started", ephemeral: true });
  }

  if (i.commandName === "remove") {
    delete data.tracked[i.user.id];
    delete data.playtime[i.user.id];
    save();
    i.reply({ content: "Tracking removed", ephemeral: true });
  }

  if (i.commandName === "stats") {
    const pt = data.playtime[i.user.id];
    if (!pt) return i.reply({ content: "No data", ephemeral: true });

    i.reply(
      `📊 **Playtime**
Today: ${fmt(pt.daily)}
Week: ${fmt(pt.weekly)}
Month: ${fmt(pt.monthly)}`
    );
  }

  if (i.commandName === "leaderboard") {
    const t = i.options.getString("type");
    const list = Object.entries(data.playtime)
      .sort((a, b) => b[1][t] - a[1][t])
      .slice(0, 10)
      .map(([id, v], i) => `**${i + 1}.** <@${id}> — ${fmt(v[t])}`)
      .join("\n");

    i.reply(`🏆 **${t.toUpperCase()}**\n${list || "No data"}`);
  }
});

// ================== PREFIX ==================
client.on("messageCreate", m => {
  if (m.author.bot || !m.content.startsWith(PREFIX)) return;
  if (m.content === "!activitycheck") {
    if (
      !isBotOwner(m.author.id) &&
      !m.member.permissions.has(PermissionsBitField.Flags.Administrator)
    )
      return m.reply("Admin or bot owner only");
    startActivityCheck(m.channel);
  }
});

// ================== LOGIN ==================
client.login(TOKEN);
