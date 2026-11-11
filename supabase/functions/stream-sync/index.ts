
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  bodyOf,
  handlerError,
  json,
  services,
} from "../_shared/streamRuntime.ts";
import {
  CHANNEL_GRANTS,
  PRIVATE_TYPE,
  TEAM_TYPE,
} from "../_shared/streamPolicy.mjs";
import { syncTeams } from "../_shared/streamService.mjs";

async function sameSecret(actual: string, expected: string) {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      )
    );

  const [a, b] = await Promise.all([
    digest(actual),
    digest(expected),
  ]);

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const expected = Deno.env.get("STREAM_SYNC_SECRET");
  const actual =
    req.headers.get("Authorization")?.replace(/^Bearer /i, "") ?? "";

  if (!expected || !(await sameSecret(actual, expected))) {
    return json({ error: "Unauthorized." }, 401);
  }

  try {
    const { db, stream } = services();

    const body = await bodyOf(req);

    if (body.action === "configure") {

      const { channel_types } =
        await stream.chat.listChannelTypes();

      for (const name of [PRIVATE_TYPE, TEAM_TYPE]) {
        const settings = {
          name,
          automod: channel_types[name]?.automod ?? "disabled",
          automod_behavior:
            channel_types[name]?.automod_behavior ?? "flag",
          grants: CHANNEL_GRANTS,
          reactions: true,
          replies: true,
          quotes: true,
          uploads: true,
          read_events: true,
          typing_events: true,
          connect_events: true,
          search: true,
          max_message_length: 5000,
        };


        if (channel_types[name]) {
          await stream.chat.updateChannelType(settings);
        } else {
          await stream.chat.createChannelType({
            ...settings,
            automod: "disabled",
            automod_behavior: "flag",
          });
        }
      }
    }

    // Ignore webhook row payloads; always read authoritative database state.

    const result = await syncTeams(db, stream);

    return json(result, result.busy ? 503 : 200);
  } catch (error) {
    return handlerError(error);
  }
});
