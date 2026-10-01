import { ChannelType, SlashCommandBuilder } from "discord.js";

export const commandData = [
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message as the bot in this channel (only you see the confirmation)")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What the bot should say")
        .setRequired(true)
        .setMaxLength(2000),
    ),

  new SlashCommandBuilder()
    .setName("ticketpurchase")
    .setDescription("Post a purchase ticket panel with a Purchase button")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Text shown on the ticket panel")
        .setRequired(true)
        .setMaxLength(2000),
    ),

  new SlashCommandBuilder()
    .setName("ticketpurchasecategory")
    .setDescription("Choose the category where purchase tickets are created")
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription("Category for purchase tickets")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Delete every message from a user, then ban them")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to erase and ban").setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("userid")
        .setDescription("A user ID instead of picking the user")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("dmall")
    .setDescription("Send a direct message to every member of this server")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to DM everyone")
        .setRequired(true)
        .setMaxLength(2000),
    ),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Give a role to everyone now, and to every new member")
    .addRoleOption((option) =>
      option.setName("role").setDescription("The role everyone should get").setRequired(true),
    ),
].map((command) => command.toJSON());
