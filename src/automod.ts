import { EmbedBuilder, PermissionFlagsBits, type Message } from "discord.js";

import { getOwnerId } from "./owner.js";

interface PromoPattern {
  label: string;
  regex: RegExp;
}

/**
 * Promotion detection. Matching messages are deleted.
 * Keep patterns here — add more freely.
 */
const PATTERNS: PromoPattern[] = [
  {
    label: "Discord invite",
    regex: /\b(?:discord(?:app)?\.(?:gg|me|io|li)\/|discord(?:app)?\.com\/invite\/)\S+/i,
  },
  {
    label: "Discord invite",
    regex: /\bdiscord\.gg\/\S+/i,
  },
  {
    label: "Link",
    regex: /https?:\/\/\S+/i,
  },
  {
    label: "Link",
    regex: /\bwww\.\S+/i,
  },
  {
    // bare domains such as spam-site.com
    label: "Link",
    regex:
      /\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ru|me|co|uk|dev|app|shop|store|link|info|biz|tv|cloud|site|online|live|us|de|fr|nl|se|to|cc|ws|tk|ml|ga|cf|gq|top|vip|club|fun|space|website|pro|one|page)\b/i,
  },
  {
    label: "Promotion text",
    regex:
      /\b(?:free\s+nitro|nitro\s+giveaway|promo\s*code|use\s+code|referral\s+code|dm\s+me\s+to\s+buy|buy\s+now|join\s+my\s+(?:server|discord)|check\s+my\s+(?:server|bio|profile)|sub\s*4\s*sub|sub4sub|follow\s*4\s*follow|advertis(?:e|ing)\s+(?:my|our|this))\b/i,
  },
];

/** Returns the label of the first matching promotion rule, or null. */
export function findPromotion(content: string): string | null {
  const text = content.replace(/\u200b/g, "").replace(/\s+/g, " ");
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(text)) return pattern.label;
  }
  return null;
}

async function logDeletion(message: Message, reason: string): Promise<void> {
  const logChannelId = process.env.AUTOMOD_LOG_CHANNEL_ID?.trim();
  if (!logChannelId) return;

  try {
    const channel = await message.client.channels.fetch(logChannelId).catch(() => null);
    if (!channel || !channel.isSendable()) return;

    const snippet = message.content.slice(0, 900) || "*[no text]*";
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Deleted a promotion message")
          .setColor(0xed4245)
          .addFields(
            { name: "User", value: `<@${message.author.id}> (${message.author.tag})` },
            { name: "Channel", value: `<#${message.channelId}>` },
            { name: "Reason", value: reason },
            { name: "Message", value: snippet },
          )
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.warn("[automod] could not write the log:", err);
  }
}

/** Deletes promotion/spam messages. Staff and the owner are never touched. */
export async function handleAutomod(message: Message): Promise<void> {
  try {
    if (!message.inGuild()) return;
    if (message.author.bot) return;
    if (!message.content) return;
    if (message.author.id === getOwnerId()) return;

    const member = message.member;
    const isStaff =
      member?.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member?.permissions.has(PermissionFlagsBits.Administrator);
    if (isStaff) return;

    const reason = findPromotion(message.content);
    if (!reason) return;

    if (!message.deletable) return;
    await message.delete();

    console.log(
      `[automod] deleted a ${reason} message from ${message.author.tag} in channel ${message.channelId}`,
    );
    await logDeletion(message, reason);
  } catch (err) {
    console.warn("[automod] failed:", err);
  }
}
