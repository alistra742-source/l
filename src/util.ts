import { MessageFlags, type RepliableInteraction } from "discord.js";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reply privately (only the user who ran the command can see it). */
export async function replyEphemeral(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  try {
    const payload = { content, flags: MessageFlags.Ephemeral as const };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.warn("[reply] could not send ephemeral reply:", err);
  }
}
