import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";

import { getOwnerId, isOwner } from "./owner.js";
import { getTicketCategoryId, setTicketCategoryId } from "./store.js";
import { replyEphemeral } from "./util.js";

export const TICKET_BUTTON_ID = "purchase_open";
export const TICKET_MODAL_ID = "purchase_modal";
export const TICKET_CLOSE_ID = "purchase_close";

const TICKET_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

const BRAND_COLOR = 0x5865f2;

function panelEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Purchase")
    .setColor(BRAND_COLOR)
    .setDescription(message)
    .setFooter({ text: "Press Purchase to open a private ticket" });
}

function channelName(username: string): string {
  const safe = username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `purchase-${safe || "ticket"}`;
}

/** /ticketpurchase — posts the panel with the Purchase button. */
export async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "Use this command inside a server.");
    return;
  }

  const message = interaction.options.getString("message", true);
  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await replyEphemeral(interaction, "I can't post a ticket panel in this channel.");
    return;
  }

  await interaction.reply({ content: "Posting the ticket panel…", flags: MessageFlags.Ephemeral });

  try {
    await channel.send({
      embeds: [panelEmbed(message)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(TICKET_BUTTON_ID)
            .setLabel("Purchase")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🛒"),
        ),
      ],
    });
    await interaction.editReply("Ticket panel posted.");
  } catch (err) {
    console.error("[tickets] failed to post panel:", err);
    await interaction.editReply("I couldn't post the panel here (check my permissions).");
  }
}

/** /ticketpurchasecategory — where new purchase tickets are created. */
export async function setTicketCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "Use this command inside a server.");
    return;
  }

  const category = interaction.options.getChannel("category", true);
  if (category.type !== ChannelType.GuildCategory) {
    await replyEphemeral(interaction, "That is not a category channel.");
    return;
  }

  setTicketCategoryId(interaction.guild.id, category.id);
  await replyEphemeral(
    interaction,
    `Done. New purchase tickets will be created in the **${(category as CategoryChannel).name}** category.`,
  );
}

/** Purchase button — opens the 3-question modal. */
export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId(TICKET_MODAL_ID).setTitle("Purchase");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("buying")
        .setLabel("What are you buying?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("payment")
        .setLabel("Which payment method are you using?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("agree")
        .setLabel("Do you agree to our rules?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200),
    ),
  );

  await interaction.showModal(modal);
}

/** Modal submitted — create the private ticket channel. */
export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyEphemeral(interaction, "Tickets can only be created in a server.");
    return;
  }

  const categoryId = getTicketCategoryId(guild.id);
  if (!categoryId) {
    await replyEphemeral(
      interaction,
      "Tickets are not set up yet. An admin must run `/ticketpurchasecategory` first.",
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const buying = interaction.fields.getTextInputValue("buying");
  const payment = interaction.fields.getTextInputValue("payment");
  const agree = interaction.fields.getTextInputValue("agree");

  const ownerId = getOwnerId();
  const botId = interaction.client.user.id;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: TICKET_PERMISSIONS },
    { id: botId, allow: TICKET_PERMISSIONS },
  ];

  // Only add the owner if they are actually in this server (unknown overwrite ids error).
  const ownerMember = await guild.members.fetch(ownerId).catch(() => null);
  if (ownerMember) {
    overwrites.push({ id: ownerId, allow: TICKET_PERMISSIONS });
  }

  try {
    const channel = await guild.channels.create({
      name: channelName(interaction.user.username),
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `Purchase ticket — ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: overwrites,
    });

    const embed = new EmbedBuilder()
      .setTitle("Purchase Ticket")
      .setColor(BRAND_COLOR)
      .addFields(
        { name: "Customer", value: `<@${interaction.user.id}>` },
        { name: "What are you buying?", value: buying },
        { name: "Payment method", value: payment },
        { name: "Agrees to the rules?", value: agree },
      )
      .setTimestamp();

    await channel.send({
      content: `<@${interaction.user.id}>${ownerMember ? ` <@${ownerId}>` : ""}`,
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(TICKET_CLOSE_ID)
            .setLabel("Close Ticket")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
      allowedMentions: { users: [interaction.user.id] },
    });

    await interaction.editReply({ content: `Ticket created: <#${channel.id}>` });
  } catch (err) {
    console.error("[tickets] failed to create ticket:", err);
    await interaction.editReply(
      "I couldn't create the ticket channel. Check that I can Manage Channels in that category.",
    );
  }
}

/** Close Ticket button — ticket owner or staff. */
export async function handleTicketClose(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || !channel || !channel.isTextBased()) {
    await replyEphemeral(interaction, "I can't close this channel.");
    return;
  }

  const member = interaction.member as GuildMember | null;
  const topic = "topic" in channel ? ((channel as TextChannel).topic ?? "") : "";
  const isStaff =
    member?.permissions.has(PermissionFlagsBits.ManageChannels) ??
    false;
  const isTicketOwner = topic.includes(interaction.user.id);

  if (!isOwner(interaction.user.id) && !isStaff && !isTicketOwner) {
    await replyEphemeral(interaction, "Only the ticket owner or staff can close this ticket.");
    return;
  }

  await replyEphemeral(interaction, "Closing this ticket…");
  setTimeout(() => {
    if ("delete" in channel) {
      void (channel as TextChannel).delete("Ticket closed").catch(() => {});
    }
  }, 3000);
}
