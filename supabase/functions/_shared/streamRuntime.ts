import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { StreamClient } from "npm:@stream-io/node-sdk@0.7.40";
import { ChatError, requireProfile } from "./streamPolicy.mjs";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
export function services() {
  const apiKey = Deno.env.get("STREAM_API_KEY");
  const secret = Deno.env.get("STREAM_API_SECRET");
  if (!apiKey || !secret) throw new ChatError("Chat is not configured.", 503);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  return { db, apiKey, stream: new StreamClient(apiKey, secret, { timeout: 5000 }) };
}
export async function authenticate(req: Request, db: ReturnType<typeof services>["db"]) {
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ChatError("Sign in required.", 401);
  // getUser verifies the JWT with Supabase Auth, including projects using asymmetric signing keys.
  // Identity is never accepted from JSON, profile IDs, or a locally decoded JWT.
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user || user.is_anonymous) throw new ChatError("Sign in required.", 401);
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("id,auth_user_id,full_name,is_system_account").eq("auth_user_id", user.id).maybeSingle();
  if (profileError) throw new ChatError("Player access could not be verified.", 503);
  const streamUser = requireProfile(profile, user.id);
  return { user, profile, streamUser };
}
export async function bodyOf(req: Request) {
  if (Number(req.headers.get("content-length")) > 8192) throw new ChatError("Request too large.", 413);
  const text = await req.text();
  if (text.length > 8192) throw new ChatError("Request too large.", 413);
  try {
    const body = JSON.parse(text || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ChatError("Invalid request."); }
}

export function handlerError(error: unknown) {
  if (error instanceof ChatError) {
    return json({ error: error.message }, error.status);
  }

  // Keep a compact operational signal without logging upstream error messages.
  const record = error !== null && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const status = record.status ?? record.statusCode;
  console.error("Stream operation failed", {
    status: typeof status === "number" ? status : undefined,
    code: typeof record.code === "number" ? record.code
      : typeof record.code === "string" && /^[A-Z0-9_]{1,32}$/.test(record.code)
      ? record.code : undefined,
  });
  return json(
    { error: "Chat is temporarily unavailable. Please retry." },
    503
  );
}
