import { initBotId } from "botid/client/core";
import { BOT_PROTECTED_ROUTES } from "./lib/signup-protection";

// Adds BotID's invisible challenge headers to the auth requests that send
// email or accept credentials. Skipped in development by BotID itself.
initBotId({ protect: BOT_PROTECTED_ROUTES });
