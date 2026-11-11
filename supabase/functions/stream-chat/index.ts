import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, bodyOf, cors, handlerError, json, services } from "../_shared/streamRuntime.ts";
import { ChatError } from "../_shared/streamPolicy.mjs";
import { assertConfiguration, createPrivateConversation } from "../_shared/streamService.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { db, stream } = services();
    const { user, streamUser } = await authenticate(req, db);
    const body = await bodyOf(req);
    if (body.action === "people") {
      const search = typeof body.search === "string" ? body.search.trim().slice(0, 80) : "";
      const offset = Number.isInteger(body.offset) && body.offset >= 0 ? Math.min(body.offset, 10000) : 0;
      let query = db.from("profiles").select("id,full_name")
        .eq("is_system_account", false).not("auth_user_id", "is", null).neq("auth_user_id", user.id);
      if (search) query = query.ilike("full_name", "%" + search.replace(/[\\%_]/g, "\\$&") + "%");
      const { data, error } = await query.order("full_name").order("id").range(offset, offset + 29);
      if (error) throw error;
      return json({ people: data, hasMore: data.length === 30 });
    }
    if (body.action !== "create") throw new ChatError("Unsupported action.");
    // Reject malformed/oversized lists before constructing any database filter.
    if (!Array.isArray(body.profileIds) || body.profileIds.length > 19
        || body.profileIds.some((id: unknown) => typeof id !== "string" || id.length > 100)) {
      throw new ChatError("Invalid player selection.");
    }
    const { data: allowed, error: limitError } = await db.rpc("allow_stream_chat_creation", { p_user_id: user.id });
    if (limitError) throw limitError;
    if (!allowed) throw new ChatError("Too many conversations. Please wait a minute.", 429);
    const { data: profiles, error } = await db.from("profiles")
      .select("id,auth_user_id,full_name,is_system_account").in("id", body.profileIds);
    if (error) throw new ChatError("Invalid player selection.");
    await assertConfiguration(stream);
    return json(await createPrivateConversation({ stream, caller: streamUser, body, profiles }));
  } catch (error) { return handlerError(error); }
});
