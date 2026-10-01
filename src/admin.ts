import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Collection,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type Role,
} from "discord.js";

import { getOwnerId } from "./owner.js";
import { setAutoroleId } from "./store.js";
import { delay, replyEphemeral } from "./util.js";

/** Any guild channel we can read history from (text, news, voice, threads). */
type PurgableChannel = Extract<GuildBasedChannel, { messages: unknown }>;

interface BulkDeletable {
  bulkDelete: (
    ids: string[],
    filterOld?: boolean,
  ) => Promise<Collection<string, Message>>;
}

const MAX_SCAN_PER_CHANNEL = 2000;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function isPurgable(channel: GuildBasedChannel | null): channel is PurgableChannel {
  return (
    !!channel && channel.isTextBased() && !channel.isDMBased() && "messages" in channel
  );
}

async function purgeChannel(
  channel: PurgableChannel,
  userId: string,
  cutoff: number,
): Promise<number> {
  const buckets: { found: Message[] } = { found: [] };
  let before: string | undefined;
  let scanned = 0;

  while (scanned < MAX_SCAN_PER_CHANNEL) {
    const batch: Collection<string, Message> = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (batch.size === 0) break;

    scanned += batch.size;
    for (const message of batch.values()) {
      if (message.author.id === userId) buckets.found.push(message);
    }

    const oldest = batch.last();
    before = oldest?.id;
    if (batch.size < 100 || !before) break;
  }

  const found = buckets.found;
  if (found.length === 0) return 0;

  const recentIds = found
    .filter((message) => message.createdTimestamp > cutoff)
    .map((message) => message.id);
  const tooOld = found.filter((message) => message.createdTimestamp <= cutoff);

  let deleted = 0;

  const bulkDelete = (channel as Partial<BulkDeletable>).bulkDelete;

  for (let index = 0; index < recentIds.length; index += 100) {
    const chunk = recentIds.slice(index, index + 100);
    try {
      if (chunk.length === 1 || typeof bulkDelete !== "function") {
        for (const id of chunk) {
          await channel.messages.delete(id);
          deleted += 1;
        }
      } else {
        const removed = await bulkDelete.call(channel, chunk, true);
        deleted += removed.size;
      }
    } catch {
      for (const id of chunk) {
        try {
          await channel.messages.delete(id);
          deleted += 1;
        } catch {
          /* ignore individual failures */
        }
      }
    }
  }

  for (const message of tooOld) {
    try {
      await message.delete();
      deleted += 1;
    } catch {
      /* ignore */
    }
  }

  return deleted;
}

async function purgeUserEverywhere(guild: Guild, userId: string): Promise<number> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const cutoff = Date.now() - TWO_WEEKS_MS;
  let deleted = 0;

  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!isPurgable(channel)) continue;

    const permissions = me ? channel.permissionsFor(me) : null;
    const canPurge =
      permissions?.has(PermissionFlagsBits.ViewChannel) &&
      permissions.has(PermissionFlagsBits.ManageMessages);
    if (!canPurge) continue;

    try {
      deleted += await purgeChannel(channel, userId, cutoff);
    } catch (err) {
      console.warn(`[ban] could not purge channel ${channel.id}:`, err);
    }
  }

  return deleted;
}

/** /say — the bot posts publicly, the confirmation is only visible to the invoker. */
export async function handleSay(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString("message", true);
  const channel = interaction.channel;

  if (!channel || !channel.isSendable()) {
    await replyEphemeral(interaction, "I can't send messages in this channel.");
    return;
  }

  await interaction.reply({ content: "Sending…", flags: MessageFlags.Ephemeral });

  try {
    await channel.send({ content: message, allowedMentions: { parse: ["users", "roles"] } });
    await interaction.editReply("Message sent.");
  } catch (err) {
    console.error("[say] failed:", err);
    await interaction.editReply("I couldn't send that message here (check my permissions).");
  }
}

/** /ban — erase everything from a user, then ban them. */
export async function handleBan(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyEphemeral(interaction, "Use this command inside a server.");
    return;
  }

  const picked = interaction.options.getUser("user");
  const typed = interaction.options.getString("userid")?.trim();
  const userId = picked?.id ?? typed;

  if (!userId || !/^\d{15,25}$/.test(userId)) {
    await replyEphemeral(interaction, "Provide a user, or a valid user ID in the userid option.");
    return;
  }
  if (userId === getOwnerId()) {
    await replyEphemeral(interaction, "You can't ban the bot owner.");
    return;
  }
  if (userId === interaction.client.user.id) {
    await replyEphemeral(interaction, "I can't ban myself.");
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply("Deleting their messages…");

  const deleted = await purgeUserEverywhere(guild, userId);

  let banned = false;
  try {
    await guild.bans.create(userId, {
      deleteMessageSeconds: 604800,
      reason: `Erased by ${interaction.user.tag} via /ban`,
    });
    banned = true;
  } catch (err) {
    console.warn("[ban] ban failed:", err);
  }

  await interaction.editReply(
    `Deleted **${deleted}** messages from <@${userId}>. Ban: ${
      banned ? "applied" : "failed — check my Ban Members permission and role position"
    }.`,
  );
}

/** /dmall — DM every member. */
export async function handleDmAll(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyEphemeral(interaction, "Use this command inside a server.");
    return;
  }

  const content = interaction.options.getString("message", true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply("Sending DMs to every member… this can take a while.");

  const members = await guild.members.fetch();
  let sent = 0;
  let failed = 0;

  for (const member of members.values()) {
    if (member.user.bot) continue;
    try {
      await member.send({ content, allowedMentions: { parse: [] } });
      sent += 1;
    } catch {
      failed += 1;
    }
    await delay(250);
  }

  const summary = `DMed **${sent}** members. **${failed}** could not be reached (DMs closed).`;
  try {
    await interaction.editReply(summary);
  } catch {
    await interaction.followUp({ content: summary, flags: MessageFlags.Ephemeral });
  }
}

/** /autorole — give a role to everyone now and to every new member. */
export async function handleAutoRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyEphemeral(interaction, "Use this command inside a server.");
    return;
  }

  const role = interaction.options.getRole("role", true) as Role;
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await replyEphemeral(interaction, "I need the **Manage Roles** permission to do that.");
    return;
  }
  if (role.managed || role.id === guild.roles.everyone.id) {
    await replyEphemeral(interaction, "That role can't be assigned by the bot.");
    return;
  }
  if (role.position >= me.roles.highest.position) {
    await replyEphemeral(
      interaction,
      `**${role.name}** is higher than my highest role, so I can't give it out. Move my role above it.`,
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setAutoroleId(guild.id, role.id);
  await interaction.editReply(`Applying **${role.name}** to every member…`);

  const members = await guild.members.fetch();
  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const member of members.values()) {
    if (member.user.bot || member.roles.cache.has(role.id)) {
      skipped += 1;
      continue;
    }
    try {
      await member.roles.add(role, "Autorole");
      added += 1;
    } catch {
      failed += 1;
    }
    await delay(120);
  }

  const summary =
    `Autorole is now **${role.name}**.\n` +
    `Added to **${added}** members (${skipped} already had it, ${failed} failed).\n` +
    "Every new member will get it automatically.";
  try {
    await interaction.editReply(summary);
  } catch {
    await interaction.followUp({ content: summary, flags: MessageFlags.Ephemeral });
  }
}
