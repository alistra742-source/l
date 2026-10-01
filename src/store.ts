import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface GuildConfig {
  ticketCategoryId?: string;
  autoroleId?: string;
}

type ConfigShape = Record<string, GuildConfig>;

const dataFile = resolve(process.env.DATA_FILE?.trim() || "data/config.json");

function load(): ConfigShape {
  try {
    if (existsSync(dataFile)) {
      return JSON.parse(readFileSync(dataFile, "utf8")) as ConfigShape;
    }
  } catch (err) {
    console.error(`[store] could not read ${dataFile}:`, err);
  }
  return {};
}

const config: ConfigShape = load();

function save(): void {
  try {
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error(`[store] could not write ${dataFile}:`, err);
  }
}

function guildConfig(guildId: string): GuildConfig {
  let current = config[guildId];
  if (!current) {
    current = {};
    config[guildId] = current;
  }
  return current;
}

export function getTicketCategoryId(guildId: string): string | undefined {
  return guildConfig(guildId).ticketCategoryId ?? process.env.TICKET_CATEGORY_ID?.trim() ?? undefined;
}

export function setTicketCategoryId(guildId: string, channelId: string): void {
  guildConfig(guildId).ticketCategoryId = channelId;
  save();
}

export function getAutoroleId(guildId: string): string | undefined {
  return guildConfig(guildId).autoroleId ?? process.env.AUTOROLE_ID?.trim() ?? undefined;
}

export function setAutoroleId(guildId: string, roleId: string): void {
  guildConfig(guildId).autoroleId = roleId;
  save();
}
