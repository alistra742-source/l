import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);

export type Currency = 'LTC' | 'ETH' | 'SOL';
export type ProductKey = 'astra' | 'fable' | 'inf_astra' | 'script_maker';

export const products: Record<ProductKey, { label: string; usd: number }> = {
  astra: { label: 'Astra', usd: 30 },
  fable: { label: 'Fable 5.1', usd: 30 },
  inf_astra: { label: 'Inf usage Astra', usd: 25 },
  script_maker: { label: 'AI Script Maker', usd: 15 },
};

export async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value integer NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS tickets (
    id text PRIMARY KEY, guild_id text NOT NULL, channel_id text NOT NULL, user_id text NOT NULL,
    currency text NOT NULL, address text NOT NULL UNIQUE, address_index integer NOT NULL,
    status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS payments (
    id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES tickets(id), product text NOT NULL,
    usd numeric NOT NULL, expected_amount numeric, received_amount numeric DEFAULT 0,
    tx_hash text, status text NOT NULL DEFAULT 'waiting', expires_at timestamptz NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS deliveries (
    product text PRIMARY KEY, content text, attachment_url text, attachment_name text, updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`INSERT INTO settings (key, value) VALUES ('shop_name', '30K') ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO settings (key, value) VALUES ('owners', ${process.env.OWNER_ID ?? '1526647973986046034'}) ON CONFLICT (key) DO NOTHING`;
}

export async function nextCounter(name: string) {
  const rows = await sql`
    INSERT INTO counters (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

export async function getSetting(key: string) {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value as string | undefined;
}

export async function setSetting(key: string, value: string) {
  await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

export async function owners() {
  return new Set((await getSetting('owners') ?? '').split(',').map((id) => id.trim()).filter(Boolean));
}

export async function createTicket(data: { id: string; guildId: string; channelId: string; userId: string; currency: Currency; address: string; addressIndex: number }) {
  await sql`INSERT INTO tickets (id, guild_id, channel_id, user_id, currency, address, address_index) VALUES (${data.id}, ${data.guildId}, ${data.channelId}, ${data.userId}, ${data.currency}, ${data.address}, ${data.addressIndex})`;
}

export async function getTicket(id: string) {
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  return rows[0] as { id: string; guild_id: string; channel_id: string; user_id: string; currency: Currency; address: string; address_index: number; status: string } | undefined;
}

export async function openTickets() {
  return await sql`SELECT * FROM tickets WHERE status = 'open'` as Array<{ id: string; currency: Currency; address: string; channel_id: string; user_id: string }>;
}

export async function closeTicket(id: string) { await sql`UPDATE tickets SET status = 'closed' WHERE id = ${id}`; }

export async function createPayment(data: { id: string; ticketId: string; product: ProductKey; usd: number; expected: string; expiresAt: Date }) {
  await sql`INSERT INTO payments (id, ticket_id, product, usd, expected_amount, expires_at) VALUES (${data.id}, ${data.ticketId}, ${data.product}, ${data.usd}, ${data.expected}, ${data.expiresAt.toISOString()})`;
}

export async function pendingPayments() {
  return await sql`SELECT p.*, t.address, t.currency, t.channel_id, t.user_id FROM payments p JOIN tickets t ON t.id = p.ticket_id WHERE p.status = 'waiting'` as Array<{ id: string; ticket_id: string; product: ProductKey; expected_amount: string; expires_at: string; address: string; currency: Currency; channel_id: string; user_id: string }>;
}

export async function markPaymentPaid(id: string, received: string, txHash: string) {
  await sql`UPDATE payments SET status = 'paid', received_amount = ${received}, tx_hash = ${txHash} WHERE id = ${id}`;
}
export async function expirePayment(id: string) { await sql`UPDATE payments SET status = 'expired' WHERE id = ${id}`; }

export async function saveDelivery(product: ProductKey, content?: string, attachmentUrl?: string, attachmentName?: string) {
  await sql`INSERT INTO deliveries (product, content, attachment_url, attachment_name) VALUES (${product}, ${content ?? null}, ${attachmentUrl ?? null}, ${attachmentName ?? null}) ON CONFLICT (product) DO UPDATE SET content = EXCLUDED.content, attachment_url = EXCLUDED.attachment_url, attachment_name = EXCLUDED.attachment_name, updated_at = now()`;
}
export async function getDelivery(product: ProductKey) {
  const rows = await sql`SELECT * FROM deliveries WHERE product = ${product}`;
  return rows[0] as { content?: string; attachment_url?: string; attachment_name?: string } | undefined;
}

export async function getPayment(id: string) {
  const rows = await sql`SELECT p.*, t.user_id, t.channel_id FROM payments p JOIN tickets t ON t.id = p.ticket_id WHERE p.id = ${id}`;
  return rows[0] as { id: string; product: ProductKey; status: string; user_id: string; channel_id: string } | undefined;
}
