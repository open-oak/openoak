import { checkBotId } from "botid/server";
import { botIdEnabled } from "./signup-protection";

/**
 * Returns true only when Vercel BotID classifies the request as a bot.
 * Verified good bots (search crawlers) never call these POST endpoints, so
 * they get no exception. On a BotID failure the request continues: the
 * database rate limits still apply, and real people must not be locked out.
 */
export async function isBotRequest(headers: Headers) {
  if (!botIdEnabled()) return false;
  try {
    const verdict = await checkBotId({ advancedOptions: { headers: Object.fromEntries(headers.entries()) } });
    return verdict.isBot && !verdict.isVerifiedBot;
  } catch (error) {
    console.error("BotID check failed; allowing request:", error);
    return false;
  }
}
