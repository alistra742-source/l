import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Currency = 'LTC' | 'ETH' | 'SOL';
export type ProductKey = 'astra' | 'fable' | 'inf_astra' | 'script_maker';

export const products: Record<ProductKey, { label: string; usd: number }> = {
  astra: { label: 'Astra', usd: 30 },
  fable: { label: 'Fable 5.1', usd: 30 },
  inf_astra: { label: 'Inf usage Astra', usd: 25 },
  script_maker: { label: 'AI Script Maker', usd: 15 },
};

type Ticket = { id: string; guild_id: string; channel_id: string; user_id: string; currency: Currency; address: string; address_index: number; status: string; created_at: string };
type Payment = { id: string; ticket_id: string; product: ProductKey; usd: number; expected_amount: string; tolerance_amount: string; received_amount?: string; tx_hash?: string; status: string; expires_at: string };
type Delivery = { content?: string; attachment_url?: string; attachment_name?: string; updated_at: string };
type Store = { settings: Record<string, string>; counters: Record<string, number>; tickets: Ticket[]; payments: Payment[]; deliveries: Partial<Record<ProductKey, Delivery>> };

const DATA_FILE = resolve(process.env.DATA_FILE ?? 'data/shop.json');
const empty = (): Store => ({ settings: {}, counters: {}, tickets: [], payments: [], deliveries: {} });

let store: Store = empty();
let writes: Promise<void> = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  writes = writes
    .then(() => {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      const temp = `${DATA_FILE}.tmp`;
      writeFileSync(temp, snapshot);
      renameSync(temp, DATA_FILE);
    })
    .catch((error: unknown) => console.error('data write failed', error));
  return writes;
}

/** Loads the local data file and seeds first-run defaults. No external service required. */
export async function initDb() {
  try {
    store = { ...empty(), ...JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<Store> };
  } catch {
    store = empty();
  }
  store.settings.shop_name ??= '30K';
  store.settings.owners ??= process.env.OWNER_ID ?? '1526647973986046034';
  await persist();
  console.log(`Data file ready at ${DATA_FILE}`);
}

export async function nextCounter(name: string) {
  store.counters[name] = (store.counters[name] ?? 0) + 1;
  await persist();
  return store.counters[name];
}

export async function getSetting(key: string) {
  return store.settings[key];
}

export async function setSetting(key: string, value: string) {
  store.settings[key] = value;
  await persist();
}

export async function owners() {
  return new Set((store.settings.owners ?? '').split(',').map((id) => id.trim()).filter(Boolean));
}

export async function createTicket(data: { id: string; guildId: string; channelId: string; userId: string; currency: Currency; address: string; addressIndex: number }) {
  store.tickets.push({ id: data.id, guild_id: data.guildId, channel_id: data.channelId, user_id: data.userId, currency: data.currency, address: data.address, address_index: data.addressIndex, status: 'open', created_at: new Date().toISOString() });
  await persist();
}

export async function getTicket(id: string) {
  return store.tickets.find((ticket) => ticket.id === id);
}

export async function openTickets() {
  return store.tickets.filter((ticket) => ticket.status === 'open');
}

export async function closeTicket(id: string) {
  const ticket = store.tickets.find((entry) => entry.id === id);
  if (ticket) { ticket.status = 'closed'; await persist(); }
}

export async function createPayment(data: { id: string; ticketId: string; product: ProductKey; usd: number; expected: string; tolerance: string; expiresAt: Date }) {
  store.payments.push({ id: data.id, ticket_id: data.ticketId, product: data.product, usd: data.usd, expected_amount: data.expected, tolerance_amount: data.tolerance, status: 'waiting', expires_at: data.expiresAt.toISOString() });
  await persist();
}

export async function pendingPayments() {
  return store.payments
    .filter((payment) => payment.status === 'waiting')
    .map((payment) => {
      const ticket = store.tickets.find((entry) => entry.id === payment.ticket_id);
      return { ...payment, address: ticket?.address ?? '', currency: ticket?.currency ?? 'LTC' as Currency, channel_id: ticket?.channel_id ?? '', user_id: ticket?.user_id ?? '' };
    });
}

export async function markPaymentPaid(id: string, received: string, txHash: string) {
  const payment = store.payments.find((entry) => entry.id === id);
  if (payment) { payment.status = 'paid'; payment.received_amount = received; payment.tx_hash = txHash; await persist(); }
}

export async function expirePayment(id: string) {
  const payment = store.payments.find((entry) => entry.id === id);
  if (payment) { payment.status = 'expired'; await persist(); }
}

export async function saveDelivery(product: ProductKey, content?: string, attachmentUrl?: string, attachmentName?: string) {
  store.deliveries[product] = { content, attachment_url: attachmentUrl, attachment_name: attachmentName, updated_at: new Date().toISOString() };
  await persist();
}

export async function getDelivery(product: ProductKey) {
  return store.deliveries[product];
}

export async function getPayment(id: string) {
  const payment = store.payments.find((entry) => entry.id === id);
  if (!payment) return undefined;
  const ticket = store.tickets.find((entry) => entry.id === payment.ticket_id);
  return { id: payment.id, product: payment.product, status: payment.status, user_id: ticket?.user_id ?? '', channel_id: ticket?.channel_id ?? '' };
}
