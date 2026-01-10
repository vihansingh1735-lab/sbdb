require("dotenv").config();
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
// ================= KEEP-ALIVE SERVER (RENDER) =================
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Roblox Live Presence Tracker is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});
/* ================= CONFIG ================= */
const CHECK_INTERVAL = 60_000; // 1 minute
const DATA_FILE = "./data.json";

/* ================= GAME MAP ================= */
const GAME_MAP = {
  2534724415: "Emergency Hamburg 🚨",
  4924922222: "Brookhaven 🏡RP",
  920587237: "Adopt Me 🐶",
  2753915549: "Blox Fruits 🍏",
  9872472334: "Grow a Garden 🌱"
};

/* ================= LOAD DATA ================= */
let data = { tracked: {}, playtime: {}, channels: {}, messages: {} };

if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= ROBLOX API ================= */
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

/* ================= UTILS ================= */
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function resolveGame(presence) {
  if (presence.placeId && GAME_MAP[presence.placeId]) {
    return GAME_MAP[presence.placeId];
  }
  if (
    typeof presence.lastLocation === "string" &&
    presence.lastLocation !== "In Game" &&
    presence.lastLocation !== "Website"
  ) {
    return presence.lastLocation;
  }
  return "Playing Roblox 🎮";
}

/* ================= TRACK LOOP ================= */
async function checkUsers() {
  for (const discordId in data.tracked) {
    const robloxId = data.tracked[discordId];
    const channelId = data.channels[discordId];
    if (!channelId) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    const presence = await getPresence(robloxId);

    // Not in game
    if (!presence || presence.userPresenceType !== 2) {
      if (data.messages[discordId]) {
        channel.messages.delete(data.messages[discordId]).catch(() => {});
        delete data.messages[discordId];
        saveData();
      }
      continue;
    }

    // In game → add time
    data.playtime[discordId] = (data.playtime[discordId] || 0) + 60;

    const profileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
    const avatar = await getAvatar(robloxId);
    const game = resolveGame(presence);

    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle(presence.lastLocation || "Roblox User")
      .setURL(profileUrl) // 🔗 CLICKABLE TITLE
      .setThumbnail(avatar)
      .addFields(
        { name: "Status", value: "🟢 In Game", inline: true },
        { name: "Game", value: game, inline: true },
        {
          name: "Playtime Today",
          value: formatTime(data.playtime[discordId]),
          inline: true
        }
      )
      .setFooter({ text: "Roblox Live Presence Tracker • updates every minute" })
      .setTimestamp();

    if (data.messages[discordId]) {
      const msg = await channel.messages
        .fetch(data.messages[discordId])
        .catch(() => null);
      if (msg) await msg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      data.messages[discordId] = msg.id;
      saveData();
    }
  }
}

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Track a Roblox user")
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Stop tracking a Roblox user")
    .addStringOption(o =>
      o.setName("username").setDescription("Roblox username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show your playtime today")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Slash commands registered");
})();

/* ================= READY ================= */
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("tracking Roblox playtime ⏱️", {
    type: ActivityType.Watching
  });
  setInterval(checkUsers, CHECK_INTERVAL);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "add") {
    const user = await getRobloxUser(i.options.getString("username"));
    if (!user)
      return i.reply({ content: "❌ Roblox user not found", ephemeral: true });

    data.tracked[i.user.id] = user.id;
    data.playtime[i.user.id] = 0;
    data.channels[i.user.id] = i.channelId;
    saveData();

    await i.reply(`✅ Tracking **${user.name}**`);
    checkUsers();
  }

  if (i.commandName === "remove") {
    delete data.tracked[i.user.id];
    delete data.playtime[i.user.id];
    delete data.channels[i.user.id];
    saveData();

    await i.reply("🗑️ Tracking removed");
  }

  if (i.commandName === "stats") {
    const t = data.playtime[i.user.id] || 0;
    await i.reply(`⏱️ Playtime today: **${formatTime(t)}**`);
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
