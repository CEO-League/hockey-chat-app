import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";
import { SignJWT } from "npm:jose@^6";
import { handlerError, json, services } from "../_shared/streamRuntime.ts";
import { ChatError, requireProfile } from "../_shared/streamPolicy.mjs";
import { issueToken, syncTeams } from "../_shared/streamService.mjs";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const userId = ctx.userClaims?.id;
    if (!userId) return json({ error: "Not authenticated" }, 401);
    if (ctx.jwtClaims?.is_anonymous === true) return json({ error: "A player account is required." }, 403);
    const apiKey = Deno.env.get("STREAM_API_KEY");
    const apiSecret = Deno.env.get("STREAM_API_SECRET");
    if (!apiKey || !apiSecret) return json({ error: "Stream is not configured" }, 500);

    try {
      const { stream } = services();
      const db = ctx.supabaseAdmin;
      const { data: profile, error: profileError } = await db.from("profiles")
        .select("id,auth_user_id,full_name,is_system_account").eq("auth_user_id", userId).maybeSingle();
      if (profileError) throw new ChatError("Player access could not be verified.", 503);
      // Verify league access before performing any reconciliation or signing.
      requireProfile(profile, userId);
      const { data: state, error } = await db.from("stream_sync_state")
        .select("generation,synced_generation").eq("id", 1).single();
      if (error) throw error;
      if (state.generation !== state.synced_generation) {
        const result = await syncTeams(db, stream);
        if (result.busy) return json({ error: "Team access is updating. Please retry shortly." }, 503);
      }
      const secret = new TextEncoder().encode(apiSecret);
      return json(await issueToken({
        stream, profile, userId, apiKey,
        signToken: (claims: { user_id: string; iat: number; exp: number }) =>
          new SignJWT({ user_id: claims.user_id })
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .setIssuedAt(claims.iat)
            .setExpirationTime(claims.exp)
            .sign(secret),
      }));
    } catch (error) { return handlerError(error); }
  }),
};
