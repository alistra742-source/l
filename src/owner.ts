/** The only user allowed to run the admin commands. */
export function getOwnerId(): string {
  return process.env.OWNER_ID?.trim() || "1526647973986046034";
}

export function isOwner(userId: string): boolean {
  return userId === getOwnerId();
}
