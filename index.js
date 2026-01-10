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
  ActivityType
} = require("discord.js");
const fs = require("fs");

// ================== CONFIG ==================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;
const CHECK_INTERVAL = 30_000;
const DB_FILE = "./data.json";

// ================== HELPERS ==================
const isOwner = id => id === OWNER_ID;
const fmt = s => `${Math.floor(s / 60)}m ${s % 60}s`;
const dayKey = () => new Date().toDateString();
const weekKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-W${Math.ceil(
    ((d - new Date(d.getFullYear(), 0, 1)) / 86400000 +
      new Date(d.getFullYear(), 0, 1).getDay() +
      1) / 7
  )}`;
};

// ================== DATABASE ==================
let data = { guilds: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    data = { guilds: {} };
  }
}
const save = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

function getGuild(guildId) {
  if (!guildId) return null;
  if (!data.guilds) data.guilds = {};
  if (!data.guilds[guildId] || typeof data.guilds[guildId] !== "object") {
    data.guilds[guildId] = { tracked: {} };
    save();
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

// ================== PRESENCE LOOP ==================
async function checkUsers() {
  if (!data.guilds) return;

  for (const guildId in data.guilds) {
    const guild = getGuild(guildId);
    if (!guild?.tracked) continue;

    for (const did in guild.tracked) {
      const u = guild.tracked[did];
      const presence = await getPresence(u.robloxId);
      const channel = await client.channels
        .fetch(u.channelId)
        .catch(() => null);
      if (!channel) continue;

      const now = Date.now();

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

        channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle(u.displayName)
              .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
              .setThumbnail(await getAvatar(u.robloxId))
              .setDescription(`🟢 **Joined Game**\n🎮 ${u.game}`)
              .setTimestamp()
          ]
        });
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

        channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle(u.displayName)
              .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
              .setThumbnail(await getAvatar(u.robloxId))
              .setDescription(`🔴 **Left Game**\n⏱ ${fmt(played)}`)
              .setTimestamp()
          ]
        });
      }
    }
  }
}

// ================== SLASH COMMANDS ==================
const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Track a Roblox user")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove tracked user")
    .addUserOption(o => o.setName("user").setRequired(true)),

  new SlashCommandBuilder().setName("list").setDescription("List tracked users"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show playtime stats")
    .addUserOption(o => o.setName("user")),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Playtime leaderboard")
    .addStringOption(o =>
      o
        .setName("type")
        .setDescription ("type of lb") 
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
  if (!i.guildId)
    return i.reply({ content: "Use this in a server.", ephemeral: true });

  const guild = getGuild(i.guildId);

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

  if (i.commandName === "remove") {
    delete guild.tracked[i.options.getUser("user").id];
    save();
    return i.reply({ content: "User removed", ephemeral: true });
  }

  if (i.commandName === "list") {
    const users = Object.values(guild.tracked);
    if (!users.length)
      return i.reply({ content: "No users tracked", ephemeral: true });

    for (const u of users) {
      await i.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(u.displayName)
            .setURL(`https://www.roblox.com/users/${u.robloxId}/profile`)
            .setThumbnail(await getAvatar(u.robloxId))
        ]
      });
    }
    return i.reply({ content: "Listed", ephemeral: true });
  }

  if (i.commandName === "stats") {
    const user = i.options.getUser("user") || i.user;
    const u = guild.tracked[user.id];
    if (!u)
      return i.reply({ content: "User not tracked", ephemeral: true });

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(u.displayName)
          .setDescription(
            `Daily: ${fmt(u.stats.daily)}\nWeekly: ${fmt(
              u.stats.weekly
            )}\nTotal: ${fmt(u.stats.total)}`
          )
      ]
    });
  }

  if (i.commandName === "leaderboard") {
    const type = i.options.getString("type");
    const list = Object.entries(guild.tracked)
      .sort((a, b) => b[1].stats[type] - a[1].stats[type])
      .slice(0, 10)
      .map(
        ([id, u], i) =>
          `**${i + 1}.** <@${id}> — ${fmt(u.stats[type])}`
      )
      .join("\n");

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`${type.toUpperCase()} Leaderboard`)
          .setDescription(list || "No data")
      ]
    });
  }

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

// ================== LOGIN ==================
client.login(TOKEN);
