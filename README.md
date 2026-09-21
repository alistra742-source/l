# 30K Discord Shop Bot

Railway-ready TypeScript Discord bot for private crypto payment tickets and digital delivery.

## Setup

1. Create a Discord application, add a bot, and copy the bot token and application ID. Enable **Message Content Intent**.
3. Add these variables in Railway (never commit seed phrases):

```text
BOT_TOKEN
APPLICATION_ID
OWNER_ID=1526647973986046034
ETH_SEED_PHRASE
LTC_SEED_PHRASE
SOL_SEED_PHRASE
ETH_RPC_URL
LTC_RPC_URL
SOL_RPC_URL
ETH_OWNER_ADDRESS
LTC_OWNER_ADDRESS
SOL_OWNER_ADDRESS
# Optional fixed prices; otherwise CoinGecko is queried when a product is selected
LTC_USD_PRICE
ETH_USD_PRICE
SOL_USD_PRICE
```

The seed phrases must be dedicated hot-wallet seeds with only the funds needed for sales. Back them up securely and test each forwarding destination with a small amount before selling. The bot derives a different address index for every ticket and stores payment state in a local JSON file (`data/shop.json`, override with `DATA_FILE`) instead of an external database. Back up that file and mount a persistent volume for it if you host the bot in a container.

## Commands

The initial owner is `1526647973986046034`. Owners can add more owners with `/ownerid`. Other owner-only commands are `/ticketpanel`, `/shoprename`, `/ethaddy`, `/ltcaddy`, `/soladdy`, `/fable_return`, `/astra_return`, `/inf_astra_return`, `/script_maker_return`, and `/sale`.

`/ticketpanel` posts the custom 30K panel. Buyers select LTC, ETH, or SOL, then a product. LTC and ETH use the derived wallet addresses; SOL uses the derived Solana addresses. Payments are checked every 30 seconds and expire after one hour. A confirmed payment is forwarded to the configured owner address before delivery is sent.

For a delivery, run the matching return command with text, or run it without text and then send the file/text as the owner. The bot stores the delivery in its local data file and sends it to future confirmed buyers. Buyers may underpay by up to $0.10 and still be confirmed.

## Run

```bash
bun install
bun run typecheck
bun run start
```
