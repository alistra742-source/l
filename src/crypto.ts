import { ethers } from 'ethers';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import type { Currency } from './db.js';

const bip32 = BIP32Factory(ecc);
const ltcNetwork = { messagePrefix: '\x19Litecoin Signed Message:\n', bech32: 'ltc', bip32: { public: 0x019da462, private: 0x019d9cfe }, pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 };
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`${key} is required`); return value; };

export function addressFor(currency: Currency, index: number) {
  if (currency === 'ETH') {
    const wallet = ethers.HDNodeWallet.fromPhrase(required('ETH_SEED_PHRASE'), undefined, `m/44'/60'/0'/0/${index}`);
    return wallet.address;
  }
  if (currency === 'LTC') {
    const seed = bip39.mnemonicToSeedSync(required('LTC_SEED_PHRASE'));
    const node = bip32.fromSeed(seed, ltcNetwork).derivePath(`m/44'/2'/0'/0/${index}`);
    return bitcoin.payments.p2pkh({ pubkey: Buffer.from(node.publicKey), network: ltcNetwork }).address!;
  }
  const seed = bip39.mnemonicToSeedSync(required('SOL_SEED_PHRASE'));
  const derived = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex')).key;
  return Keypair.fromSeed(Uint8Array.from(derived)).publicKey.toBase58();
}

async function ltcRpc(method: string, params: unknown[]) {
  const response = await fetch(required('LTC_RPC_URL'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
  const body = await response.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

export async function paymentState(currency: Currency, address: string) {
  if (currency === 'ETH') {
    const provider = new ethers.JsonRpcProvider(required('ETH_RPC_URL'));
    const balance = await provider.getBalance(address);
    return { amount: balance, tx: `eth:${address}:${balance.toString()}` };
  }
  if (currency === 'LTC') {
    const amount = Number(await ltcRpc('getreceivedbyaddress', [address, 0]));
    return { amount: BigInt(Math.round(amount * 100_000_000)), tx: `ltc:${address}:${amount}` };
  }
  const connection = new Connection(required('SOL_RPC_URL'), 'confirmed');
  const amount = BigInt(await connection.getBalance(new PublicKey(address)));
  return { amount, tx: `sol:${address}:${amount.toString()}` };
}

export async function quoteAmount(currency: Currency, usd: number) {
  const envPrice = Number(process.env[`${currency}_USD_PRICE`]);
  const ids = { LTC: 'litecoin', ETH: 'ethereum', SOL: 'solana' } as const;
  const response = envPrice > 0 ? undefined : await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids[currency]}&vs_currencies=usd`, { signal: AbortSignal.timeout(8_000) });
  const body = response ? await response.json() as Record<string, { usd: number }> : undefined;
  const price = envPrice > 0 ? envPrice : Number(body?.[ids[currency]]?.usd);
  if (!price || !Number.isFinite(price)) throw new Error(`Unable to get ${currency} USD price; set ${currency}_USD_PRICE`);
  const decimals = currency === 'ETH' ? 18 : currency === 'LTC' ? 8 : 9;
  const human = (usd / price).toFixed(Math.min(decimals, 8));
  const base = ethers.parseUnits(human, decimals);
  const tolerance = ethers.parseUnits((0.10 / price).toFixed(Math.min(decimals, 8)), decimals);
  return { human, base: base.toString(), tolerance: tolerance.toString() };
}

export async function forwardFunds(currency: Currency, index: number, address: string) {
  if (currency === 'ETH') {
    const provider = new ethers.JsonRpcProvider(required('ETH_RPC_URL'));
    const wallet = ethers.HDNodeWallet.fromPhrase(required('ETH_SEED_PHRASE'), undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
    const balance = await provider.getBalance(address);
    const fee = (await provider.getFeeData()).maxFeePerGas ?? (await provider.getFeeData()).gasPrice ?? 0n;
    const gas = fee * 21_000n;
    if (balance <= gas) return null;
    const tx = await wallet.sendTransaction({ to: required('ETH_OWNER_ADDRESS'), value: balance - gas });
    return tx.hash;
  }
  if (currency === 'LTC') {
    const seed = bip39.mnemonicToSeedSync(required('LTC_SEED_PHRASE'));
    const node = bip32.fromSeed(seed, ltcNetwork).derivePath(`m/44'/2'/0'/0/${index}`);
    await ltcRpc('importprivkey', [node.toWIF(), `ticket-${index}`, false]);
    return String(await ltcRpc('sendtoaddress', [required('LTC_OWNER_ADDRESS'), await ltcRpc('getreceivedbyaddress', [address, 0])]));
  }
  const connection = new Connection(required('SOL_RPC_URL'), 'confirmed');
  const seed = bip39.mnemonicToSeedSync(required('SOL_SEED_PHRASE'));
  const derived = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex')).key;
  const signer = Keypair.fromSeed(Uint8Array.from(derived));
  const balance = await connection.getBalance(signer.publicKey);
  const fee = 5_000;
  if (balance <= fee) return null;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(required('SOL_OWNER_ADDRESS')), lamports: balance - fee }));
  return connection.sendTransaction(tx, [signer]);
}
