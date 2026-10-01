import "dotenv/config";

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";

import { commandData } from "./commands.js";
import { handleAutoRole, handleBan, handleDmAll, handleSay } from "./admin.js";
import { handleAutomod } from "./automod.js";
import { isOwner } from "./owner.js";
import { getAutoroleId } from "./store.js";
import {
  TICKET_BUTTON_ID,
  TICKET_CLOSE_ID,
  TICKET_MODAL_ID,
  handleTicketButton,
  handleTicketClose,
  handleTicketModal,
  postTicketPanel,
  setTicketCategory,
} from "./tickets.js";

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error("BOT_TOKEN is missing. Add it to the Railway variables and restart.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token!);
  const applicationId = client.user?.id;
  if (!applicationId) throw new Error("Client user is not ready yet.");

  const guildId = process.env.GUILD_ID?.trim();
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commandData });
    console.log(`Registered ${commandData.length} commands in guild ${guildId} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(applicationId), { body: commandData });
    console.log(
      `Registered ${commandData.length} global commands. They can take up to an hour to appear.`,
    );
  }
}

async function replyFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    const payload = {
      content: "Something went wrong handling that. Check the bot logs.",
      flags: MessageFlags.Ephemeral as const,
    };
    const repliable = interaction as RepliableInteraction;
    if (repliable.deferred || repliable.replied) await repliable.followUp(payload);
    else await repliable.reply(payload);
  } catch {
    /* nothing else we can do */
  }
}

async function routeCommand(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "You are not authorized to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (interaction.commandName) {
    case "say":
      return handleSay(interaction);
    case "ticketpurchase":
      return postTicketPanel(interaction);
    case "ticketpurchasecategory":
      return setTicketCategory(interaction);
    case "ban":
      return handleBan(interaction);
    case "dmall":
      return handleDmAll(interaction);
    case "autorole":
      return handleAutoRole(interaction);
    default:
      await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("[commands] registration failed:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await routeCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      if (interaction.customId === TICKET_BUTTON_ID) await handleTicketButton(interaction);
      else if (interaction.customId === TICKET_CLOSE_ID) await handleTicketClose(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === TICKET_MODAL_ID) await handleTicketModal(interaction);
    }
  } catch (err) {
    console.error("[interaction] unhandled error:", err);
    await replyFailure(interaction);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const roleId = getAutoroleId(member.guild.id);
  if (!roleId) return;

  const role = member.guild.roles.cache.get(roleId);
  if (!role) return;

  try {
    await member.roles.add(role, "Autorole");
  } catch (err) {
    console.warn(`[autorole] could not add role to ${member.user.tag}:`, err);
  }
});

client.on(Events.MessageCreate, (message) => {
  void handleAutomod(message);
});

client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
  void handleAutomod(newMessage);
});

process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

await client.login(token);
