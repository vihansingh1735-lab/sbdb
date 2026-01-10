// ================== KEEPALIVE ==================
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
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType
} = require("discord.js");
const fs = require("fs");

// ================== CONFIG ==================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;
const CHECK_INTERVAL = 30_000;
const DB_FILE = "./data.json";

// ================== GAME ICONS ==================
const GAME_ICONS = {
  "Emergency Hamburg": "https://tr.rbxcdn.com/0f1f3b0d1f.png",
  "Brookhaven": "https://tr.rbxcdn.com/9c7e2c.png",
  "Adopt Me": "https://tr.rbxcdn.com/ab13f.png"
};
const DEFAULT_GAME_ICON =
  "https://tr.rbxcdn.com/1a2b3c.png";

// ================== HELPERS ==================
const isOwner = id => id === OWNER_ID;
const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;
const dayKey = () => new Date().toDateString();
const weekKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${Math.ceil(
    ((d - new Date(d.getFullYear(), 0, 1)) / 86400000 +
      new Date(d.getFullYear(), 0, 1).getDay() +
      1) / 7
  )}`;
};

// ================== DATABASE ==================
let data = { guilds: {} };
if (fs.existsSync(DB_FILE)) {
  data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
const save = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { tracked: {} };
  }
  return data.guilds[guildId];
}

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

async function getAvatar(id) {
  const r = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png`
  );
  const j = await r.json();
  return j.data?.[0]?.imageUrl;
}

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// ================== TRACK LOOP ==================
async function checkUsers() {
  for (const guildId in data.guilds) {
    const guild = data.guilds[guildId];

    for (const did in guild.tracked) {
      const u = guild.tracked[did];
      const presence = await getPresence(u.robloxId);
      const channel = await client.channels
        .fetch(u.channelId)
        .catch(() => null);
      if (!channel) continue;

      const now = Date.now();

      // Reset day/week
      if (u.stats.day !== dayKey()) {
        u.stats.day = dayKey();
        u.stats.daily = 0;
      }
      if (u.stats.week !== weekKey()) {
        u.stats.week = weekKey();
        u.stats.weekly = 0;
      }

      // JOIN
      if (presence?.userPresenceType === 2 && u.state !== "ingame") {
        u.state = "ingame";
        u.join = now;
        u.game = presence.lastLocation || "Roblox";
        save();

        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(u.displayName)
          .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
          .setThumbnail(await getAvatar(u.robloxId))
          .setDescription(`🟢 **Joined**\n🎮 ${u.game}`)
          .setTimestamp();

        channel.send({ embeds: [embed] });
      }

      // LEAVE
      if (
        (!presence || presence.userPresenceType !== 2) &&
        u.state === "ingame"
      ) {
        const played = Math.floor((now - u.join) / 1000);

        u.stats.daily += played;
        u.stats.weekly += played;
        u.stats.total += played;

        u.state = "offline";
        u.join = null;
        save();

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(u.displayName)
          .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
          .setThumbnail(await getAvatar(u.robloxId))
          .setDescription(
            `🔴 **Left Game**\n⏱ ${fmt(played)}`
          )
          .setTimestamp();

        channel.send({ embeds: [embed] });
      }
    }
  }
}

// ================== SLASH COMMANDS ==================
const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Track a Roblox user")
    .addUserOption(o =>
      o.setName("user").setDescription("Discord user").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove tracked user")
    .addUserOption(o =>
      o.setName("user").setDescription("Discord user").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("list")
    .setDescription("List tracked users"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("User playtime stats")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Playtime leaderboard")
    .addStringOption(o =>
      o
        .setName("type")
        .setDescription("daily / weekly / total")
        .setRequired(true)
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Weekly", value: "weekly" },
          { name: "Total", value: "total" }
        )
    ),

  new SlashCommandBuilder()
    .setName("activitycheck")
    .setDescription("Start activity check")
].map(c => c.toJSON());

// ================== REGISTER ==================
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
})();

// ================== READY ==================
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox Presence", {
    type: ActivityType.Watching
  });
  setInterval(checkUsers, CHECK_INTERVAL);
});

// ================== INTERACTIONS ==================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  const guild = getGuild(i.guildId);

  // ADD
  if (i.commandName === "add") {
    const target = i.options.getUser("user");
    const rbx = await getRobloxUser(i.options.getString("username"));
    if (!rbx)
      return i.reply({ content: "Roblox user not found", ephemeral: true });

    guild.tracked[target.id] = {
      robloxId: rbx.id,
      displayName: rbx.displayName || rbx.name,
      channelId: i.channelId,
      state: "offline",
      join: null,
      game: null,
      stats: {
        daily: 0,
        weekly: 0,
        total: 0,
        day: dayKey(),
        week: weekKey()
      }
    };
    save();
    return i.reply({ content: "User added", ephemeral: true });
  }

  // REMOVE
  if (i.commandName === "remove") {
    const target = i.options.getUser("user");
    delete guild.tracked[target.id];
    save();
    return i.reply({ content: "User removed", ephemeral: true });
  }

  // LIST
  if (i.commandName === "list") {
    const users = Object.values(guild.tracked);
    if (!users.length)
      return i.reply({ content: "No users tracked", ephemeral: true });

    for (const u of users) {
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(u.displayName)
        .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
        .setThumbnail(await getAvatar(u.robloxId));
      await i.channel.send({ embeds: [embed] });
    }
    return i.reply({ content: "Listed", ephemeral: true });
  }

  // STATS
  if (i.commandName === "stats") {
    const user = i.options.getUser("user") || i.user;
    const u = guild.tracked[user.id];
    if (!u)
      return i.reply({ content: "User not tracked", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(u.displayName)
      .setDescription(
        `📅 Daily: ${fmt(u.stats.daily)}\n` +
        `📆 Weekly: ${fmt(u.stats.weekly)}\n` +
        `🏆 Total: ${fmt(u.stats.total)}`
      );
    return i.reply({ embeds: [embed] });
  }

  // LEADERBOARD
  if (i.commandName === "leaderboard") {
    const type = i.options.getString("type");
    const entries = Object.entries(guild.tracked)
      .sort((a, b) => b[1].stats[type] - a[1].stats[type])
      .slice(0, 10);

    if (!entries.length)
      return i.reply({ content: "No data", ephemeral: true });

    const desc = entries
      .map(
        ([id, u], i) =>
          `**${i + 1}.** <@${id}> — ${fmt(u.stats[type])}`
      )
      .join("\n");

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`🏆 ${type.toUpperCase()} Leaderboard`)
          .setDescription(desc)
      ]
    });
  }

  // ACTIVITY CHECK
  if (i.commandName === "activitycheck") {
    if (
      !isOwner(i.user.id) &&
      !i.member.permissions.has(PermissionsBitField.Flags.Administrator)
    )
      return i.reply({ content: "No permission", ephemeral: true });

    const msg = await i.channel.send(
      "@everyone **ACTIVITY CHECK**\nReact ✅"
    );
    await msg.react("✅");
    return i.reply({ content: "Started", ephemeral: true });
  }
});

// ================== PREFIX ==================
client.on("messageCreate", m => {
  if (m.author.bot || m.content !== "!activitycheck") return;
  if (
    !isOwner(m.author.id) &&
    !m.member.permissions.has(PermissionsBitField.Flags.Administrator)
  )
    return m.reply("No permission");

  startActivityCheck(m.channel);
});

// ================== LOGIN ==================
client.login(TOKEN);
