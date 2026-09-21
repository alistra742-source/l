import 'dotenv/config';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, Events,
  GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, TextChannel, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { addressFor, forwardFunds, paymentState, quoteAmount } from './crypto.js';
import { closeTicket, createPayment, createTicket, expirePayment, getDelivery, getPayment, getSetting, getTicket, initDb, markPaymentPaid, nextCounter, openTickets, owners, pendingPayments, products, saveDelivery, setSetting, type Currency, type ProductKey } from './db.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const ownerOnly = async (userId: string) => (await owners()).has(userId);
const productOptions = Object.entries(products).map(([value, product]) => ({ label: `${product.label} — $${product.usd}`, value }));
const currencyOptions = ['LTC', 'ETH', 'SOL'].map((value) => ({ label: value, value }));
const commandData = [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the shop ticket panel'),
  new SlashCommandBuilder().setName('ownerid').setDescription('Add an owner').addStringOption((o) => o.setName('id').setDescription('Discord user ID').setRequired(true)),
  new SlashCommandBuilder().setName('shoprename').setDescription('Rename the shop').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)),
  new SlashCommandBuilder().setName('ethaddy').setDescription('Set the ETH forwarding address').addStringOption((o) => o.setName('address').setDescription('Address').setRequired(true)),
  new SlashCommandBuilder().setName('ltcaddy').setDescription('Set the LTC forwarding address').addStringOption((o) => o.setName('address').setDescription('Address').setRequired(true)),
  new SlashCommandBuilder().setName('soladdy').setDescription('Set the SOL forwarding address').addStringOption((o) => o.setName('address').setDescription('Address').setRequired(true)),
  ...(['fable', 'astra', 'inf_astra', 'script_maker'] as ProductKey[]).map((product) => new SlashCommandBuilder().setName(`${product}return`).setDescription('Store a product delivery').addStringOption((o) => o.setName('text').setDescription('Delivery text').setRequired(false))),
  new SlashCommandBuilder().setName('sale').setDescription('Remove a user from this server').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
].map((command) => command.toJSON());

async function panel(channel: TextChannel) {
  const name = await getSetting('shop_name') ?? '30K';
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x111827).setTitle(`${name} • Crypto Shop`).setDescription('Choose a currency to open a private payment ticket.\n\nLTC • ETH • SOL\n\nPayments are monitored for one hour.')], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('ticket:create').setLabel('Create Ticket').setStyle(ButtonStyle.Primary))] });
}

async function createTicketModal(interaction: StringSelectMenuInteraction) {
  const currency = interaction.values[0] as Currency;
  const modal = new ModalBuilder().setCustomId(`ticket:modal:${currency}`).setTitle(`${currency} payment ticket`);
  const confirm = new TextInputBuilder().setCustomId('confirm').setLabel('Type CREATE to continue').setPlaceholder('CREATE').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirm));
  await interaction.showModal(modal);
}

async function paymentButtons(ticketId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`product:${ticketId}`).setLabel('Choose product').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Secondary));
}

async function pollPayments() {
  const pending = await pendingPayments().catch((error: unknown) => { console.error('payment poll failed', error); return []; });
  for (const payment of pending) {
    try {
      if (Date.now() > new Date(payment.expires_at).getTime()) { await expirePayment(payment.id); const channel = await client.channels.fetch(payment.channel_id); if (channel && 'send' in channel) await channel.send('This payment window expired after one hour.'); continue; }
      const state = await paymentState(payment.currency, payment.address);
      if (state.amount + BigInt(payment.tolerance_amount ?? '0') >= BigInt(payment.expected_amount)) {
        await markPaymentPaid(payment.id, state.amount.toString(), state.tx);
        const forwarded = await forwardFunds(payment.currency, Number((await getTicket(payment.ticket_id))?.address_index ?? 0), payment.address).catch((error: unknown) => { console.error('forwarding failed', error); return null; });
        const channel = await client.channels.fetch(payment.channel_id);
        if (channel && 'send' in channel) await channel.send(`Payment confirmed. Funds forwarded to the owner${forwarded ? ` (${forwarded})` : ''}.`);
        const delivery = await getDelivery(payment.product);
        const user = await client.users.fetch(payment.user_id);
        if (delivery?.attachment_url) await user.send({ content: 'Your order is ready.', files: [{ attachment: delivery.attachment_url, name: delivery.attachment_name ?? 'delivery.bin' }] });
        else if (delivery?.content) await user.send(`Your order is ready:\n${delivery.content}`);
        else await user.send('Payment confirmed. Your delivery has not been uploaded yet; the owner will provide it shortly.');
      }
    } catch (error) { console.error('payment poll failed', error); }
  }
}

client.on(Events.Error, (error) => console.error('Discord client error', error));
client.once(Events.ClientReady, (ready) => { console.log(`Logged in as ${ready.user.tag}`); setInterval(() => void pollPayments(), 30_000); });
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      // Acknowledge immediately: the database round trip below can exceed Discord's 3 second window.
      await interaction.deferReply({ ephemeral: true });
      if (interaction.commandName === 'sale') {
        if (!(await ownerOnly(interaction.user.id))) return void interaction.editReply({ content: 'Not authorized.' });
        const user = interaction.options.getUser('user', true); const member = await interaction.guild?.members.fetch(user.id); if (member) await member.kick('Sale'); return void interaction.editReply({ content: 'Done.' });
      }
      if (!(await ownerOnly(interaction.user.id))) return void interaction.editReply({ content: 'Not authorized.' });
      if (interaction.commandName === 'ticketpanel') { await panel(interaction.channel as TextChannel); return void interaction.editReply({ content: 'Done.' }); }
      if (interaction.commandName === 'ownerid') { const id = interaction.options.getString('id', true); const current = await owners(); current.add(id); await setSetting('owners', [...current].join(',')); return void interaction.editReply({ content: 'Done.' }); }
      if (interaction.commandName === 'shoprename') { await setSetting('shop_name', interaction.options.getString('name', true)); return void interaction.editReply({ content: 'Done.' }); }
      if (['ethaddy', 'ltcaddy', 'soladdy'].includes(interaction.commandName)) { await setSetting(`${interaction.commandName}_address`, interaction.options.getString('address', true)); return void interaction.editReply({ content: 'Done.' }); }
      const product = interaction.commandName.replace('return', '') as ProductKey;
      if (product in products) { const text = interaction.options.getString('text'); if (text) await saveDelivery(product, text); else await setSetting('awaiting_delivery', product); return void interaction.editReply({ content: 'Waiting for message/file' }); }
    }
    if (interaction.isButton() && interaction.customId === 'ticket:create') {
      return void interaction.reply({ content: 'Select a payment currency.', ephemeral: true, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:currency').setPlaceholder('Currency').addOptions(currencyOptions))] });
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:currency') return void createTicketModal(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:modal:')) {
      const currency = interaction.customId.split(':')[2] as Currency; const confirmation = interaction.fields.getTextInputValue('confirm').trim().toUpperCase();
      if (confirmation !== 'CREATE') return void interaction.reply({ content: 'Cancelled.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild!; const category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === 'ticketcategory');
      const channel = await guild.channels.create({ name: `${currency.toLowerCase()}-${interaction.user.username}`, type: ChannelType.GuildText, parent: category?.id, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
      const index = await nextCounter(`address_${currency}`); const address = addressFor(currency, index); const ticketId = randomUUID(); await createTicket({ id: ticketId, guildId: guild.id, channelId: channel.id, userId: interaction.user.id, currency, address, addressIndex: index });
      await channel.send({ content: `Payment ticket for **${currency}**\nAddress:\n\`\`\`${address}\`\`\`\nChoose your product below.`, components: [await paymentButtons(ticketId)] });
      return void interaction.editReply({ content: `Ticket created: ${channel}` });
    }
    if (interaction.isButton() && interaction.customId.startsWith('product:')) {
      await interaction.deferReply({ ephemeral: true });
      const ticketId = interaction.customId.split(':')[1]; const ticket = await getTicket(ticketId); if (!ticket || ticket.user_id !== interaction.user.id) return void interaction.editReply({ content: 'Not authorized.' });
      return void interaction.editReply({ content: 'Choose a product.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`product:select:${ticketId}`).setPlaceholder('Product').addOptions(productOptions))] });
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('product:select:')) {
      await interaction.deferUpdate();
      const ticketId = interaction.customId.split(':')[2]; const product = interaction.values[0] as ProductKey; const ticket = await getTicket(ticketId); if (!ticket) return;
      const quote = await quoteAmount(ticket.currency, products[product].usd);
      await createPayment({ id: randomUUID(), ticketId, product, usd: products[product].usd, expected: quote.base, tolerance: quote.tolerance, expiresAt: new Date(Date.now() + 3_600_000) });
      return void interaction.editReply({ content: `**${products[product].label}** — $${products[product].usd}\nSend **${quote.human} ${ticket.currency}** to:\n\`\`\`${ticket.address}\`\`\`\nThis address is monitored for one hour.`, components: [] });
    }
    if (interaction.isButton() && interaction.customId.startsWith('close:')) {
      const id = interaction.customId.split(':')[1]; const allowed = (await ownerOnly(interaction.user.id)) || (await getTicket(id))?.user_id === interaction.user.id;
      if (!allowed) return void interaction.reply({ content: 'Not authorized.', ephemeral: true });
      await interaction.deferUpdate(); await closeTicket(id); await interaction.channel?.delete().catch(() => {});
    }
  } catch (error) {
    console.error(error);
    if (!interaction.isRepliable()) return;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !(await ownerOnly(message.author.id))) return;
    const product = (await getSetting('awaiting_delivery')) as ProductKey | undefined; if (!product) return;
    const attachment = message.attachments.first(); await saveDelivery(product, attachment ? undefined : message.content, attachment?.url, attachment?.name); await setSetting('awaiting_delivery', '');
  } catch (error) { console.error('delivery message failed', error); }
});

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN is required');
const rest = new REST({ version: '10' }).setToken(token);
const applicationId = process.env.APPLICATION_ID;
if (!applicationId) throw new Error('APPLICATION_ID is required');
await rest.put(Routes.applicationCommands(applicationId), { body: commandData });
try {
  await initDb();
} catch (error) {
  console.error('Database setup failed, so the bot cannot start.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
await client.login(token);
