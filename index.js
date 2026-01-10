// ================= KEEPALIVE =================
const express = require("express");
const app = express();
app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);

// ================= IMPORTS =================
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType,
  PermissionsBitField
} = require("discord.js");
const fs = require("fs");

// ================= CONFIG =================
const PREFIX = "!";
const CHECK_INTERVAL = 60_000;
const BOT_OWNER_ID = "1426918952906522786"; // 🔴 CHANGE IF NEEDED

// ================= FILES =================
const DATA_FILE = "./data.json";
const ACTIVITY_FILE = "./database.json";

// ================= GAME MAP =================
const GAME_MAP = {
  2534724415: "Emergency Hamburg 🚨",
  4924922222: "Brookhaven 🏡RP",
  920587237: "Adopt Me 🐶",
  2753915549: "Blox Fruits 🍏"
};

// ================= LOAD DATA =================
let data = { tracked: {}, channels: {}, messages: {}, playtime: {} };
if (fs.existsSync(DATA_FILE))
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

const saveData = () =>
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

function loadActivityDB() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8"));
  } catch {
    return { activityWins: {}, activityReactCount: {} };
  }
}

function saveActivityDB(db) {
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(db, null, 2));
}

// ================= HELPERS =================
const isBotOwner = id => id === BOT_OWNER_ID;
const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;
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

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ================= ROBLOX API =================
async function getRobloxUser(username) {
  const r = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username] })
  });
  const d = await r.json();
  return d.data?.[0] || null;
}

async function getPresence(id) {
  const r = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [id] })
  });
  const d = await r.json();
  return d.userPresences?.[0] || null;
}

async function getAvatar(id) {
  const r = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png`
  );
  const d = await r.json();
  return d.data?.[0]?.imageUrl || null;
}

const resolveGame = p =>
  p.placeId && GAME_MAP[p.placeId]
    ? GAME_MAP[p.placeId]
    : p.lastLocation && !["In Game", "Website"].includes(p.lastLocation)
    ? p.lastLocation
    : "Playing Roblox 🎮";

// ================= TRACK LOOP =================
async function checkUsers() {
  for (const id in data.tracked) {
    const { robloxId, displayName } = data.tracked[id];
    const channel = await client.channels
      .fetch(data.channels[id])
      .catch(() => null);
    if (!channel) continue;

    const presence = await getPresence(robloxId);

    data.playtime[id] ??= {
      daily: 0,
      weekly: 0,
      monthly: 0,
      d: dayId(),
      w: weekId(),
      m: monthId()
    };

    const pt = data.playtime[id];
    if (pt.d !== dayId()) (pt.daily = 0), (pt.d = dayId());
    if (pt.w !== weekId()) (pt.weekly = 0), (pt.w = weekId());
    if (pt.m !== monthId()) (pt.monthly = 0), (pt.m = monthId());

    if (!presence || presence.userPresenceType !== 2) {
      if (data.messages[id]) {
        channel.messages.delete(data.messages[id]).catch(() => {});
        delete data.messages[id];
        saveData();
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
      .setFooter({ text: "Roblox Live Presence • updates every minute" });

    if (data.messages[id]) {
      const m = await channel.messages.fetch(data.messages[id]).catch(() => null);
      if (m) await m.edit({ embeds: [embed] });
    } else {
      const m = await channel.send({ embeds: [embed] });
      data.messages[id] = m.id;
      saveData();
    }
  }
}

// ================= ACTIVITY CHECK =================
async function startActivityCheck(channel) {
  const msg = await channel.send({
    content:
      "@everyone 📢 **ACTIVITY CHECK STARTED!**\nReact with ✅\nFirst **3 users** win!",
    allowedMentions: { parse: ["everyone"] }
  });
  await msg.react("✅");

  const db = loadActivityDB();
  const winners = [];

  const collector = msg.createReactionCollector({
    filter: (r, u) => r.emoji.name === "✅" && !u.bot,
    time: 10 * 60 * 1000
  });

  collector.on("collect", (_, u) => {
    if (!winners.includes(u.id)) winners.push(u.id);
    if (winners.length === 3) collector.stop("DONE");
  });

  collector.on("end", (_, reason) => {
    if (reason !== "DONE")
      return channel.send("⏳ Not enough participants.");

    winners.forEach(id => {
      db.activityWins[id] = (db.activityWins[id] || 0) + 1;
      db.activityReactCount[id] =
        (db.activityReactCount[id] || 0) + 1;
    });
    saveActivityDB(db);

    channel.send(
      `🏆 Winners:\n🥇 <@${winners[0]}>\n🥈 <@${winners[1]}>\n🥉 <@${winners[2]}>`
    );
  });
}

// ================= SLASH COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Track a Roblox user")
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),
  new SlashCommandBuilder().setName("remove").setDescription("Stop tracking"),
  new SlashCommandBuilder().setName("stats").setDescription("Your playtime"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Playtime leaderboard")
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
    ),
  new SlashCommandBuilder()
    .setName("activitycheck")
    .setDescription("Start activity check")
].map(c => c.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands
  });
})();

// ================= READY =================
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox Tracking", {
    type: ActivityType.Watching
  });
  setInterval(checkUsers, CHECK_INTERVAL);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "activitycheck") {
    if (
      !isBotOwner(i.user.id) &&
      !i.member.permissions.has(PermissionsBitField.Flags.Administrator)
    )
      return i.reply({ content: "Admin or bot owner only", ephemeral: true });

i.reply({ content: "Activity check started", ephemeral: true });
startActivityCheck(i.channel);

  if (i.commandName === "add") {
    const u = await getRobloxUser(i.options.getString("username"));
    if (!u) return i.reply({ content: "User not found", ephemeral: true });
    data.tracked[i.user.id] = {
      robloxId: u.id,
      displayName: u.displayName || u.name
    };
    data.channels[i.user.id] = i.channelId;
    saveData();
    i.reply({ content: "Tracking started", ephemeral: true });
    checkUsers();
  }

  if (i.commandName === "remove") {
    delete data.tracked[i.user.id];
    delete data.playtime[i.user.id];
    saveData();
    i.reply({ content: "Tracking removed", ephemeral: true });
  }

  if (i.commandName === "stats") {
    const pt = data.playtime[i.user.id];
    if (!pt) return i.reply({ content: "No data", ephemeral: true });
    i.reply(
      `Today: ${fmt(pt.daily)}\nWeek: ${fmt(pt.weekly)}\nMonth: ${fmt(
        pt.monthly
      )}`
    );
  }

  if (i.commandName === "leaderboard") {
    const t = i.options.getString("type");
    const list = Object.entries(data.playtime)
      .sort((a, b) => b[1][t] - a[1][t])
      .slice(0, 10)
      .map(([id, v], i) => `**${i + 1}.** <@${id}> — ${fmt(v[t])}`)
      .join("\n");
    i.reply(`🏆 ${t.toUpperCase()} Leaderboard\n${list || "No data"}`);
  }
});

// ================= PREFIX =================
client.on("messageCreate", m => {
  if (m.author.bot || !m.content.startsWith(PREFIX)) return;
  if (m.content === "!activitycheck") {
    if (
      !isBotOwner(m.author.id) &&
      !m.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    )
      return m.reply("Admin or bot owner only");
    startActivityCheck(m.channel);
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
