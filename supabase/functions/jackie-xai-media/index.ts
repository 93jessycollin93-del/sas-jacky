// xAI media surface: image generation, video generation (async poll), and TTS.
// All calls are proxied server-side so XAI_API_KEY never reaches the browser.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SECRET = "XAI_API_KEY";
const API = "https://api.x.ai/v1";

const IMAGE_MODELS = new Set([
  "grok-imagine-image-quality",
  "grok-imagine-image-fast",
  "grok-2-image",
]);
const VIDEO_MODELS = new Set(["grok-imagine-video"]);
const TTS_VOICES = new Set(["eve", "leo", "rex", "nova", "sol"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireUser(req: Request): Promise<Response | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await sb.auth.getClaims(auth.replace("Bearer ", ""));
  if (error || !data?.claims) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function xai(key: string, path: string, init?: RequestInit) {
  return await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const un = await requireUser(req);
  if (un) return un;

  const key = Deno.env.get(SECRET);
  if (!key) {
    return json(
      {
        error: `${SECRET} not configured. Paste your xAI key from https://console.x.ai/`,
        needs_secret: SECRET,
      },
      400,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(payload.action ?? "");
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";

  try {
    // ---- Image generation -------------------------------------------------
    if (action === "image") {
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const model = IMAGE_MODELS.has(String(payload.model))
        ? String(payload.model)
        : "grok-imagine-image-quality";
      const resp = await xai(key, "/images/generations", {
        method: "POST",
        body: JSON.stringify({ model, prompt }),
      });
      const text = await resp.text();
      if (!resp.ok) return json({ error: `xAI ${resp.status}: ${text}` }, resp.status);
      return json(JSON.parse(text));
    }

    // ---- Video: start ----------------------------------------------------
    if (action === "video_start") {
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const model = VIDEO_MODELS.has(String(payload.model))
        ? String(payload.model)
        : "grok-imagine-video";
      const resp = await xai(key, "/videos/generations", {
        method: "POST",
        body: JSON.stringify({ model, prompt }),
      });
      const text = await resp.text();
      if (!resp.ok) return json({ error: `xAI ${resp.status}: ${text}` }, resp.status);
      return json(JSON.parse(text));
    }

    // ---- Video: poll (client polls; no long-running function) -------------
    if (action === "video_status") {
      const id = String(payload.request_id ?? "");
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(id)) return json({ error: "Invalid request_id" }, 400);
      const resp = await xai(key, `/videos/${id}`, { method: "GET" });
      const text = await resp.text();
      if (!resp.ok) return json({ error: `xAI ${resp.status}: ${text}` }, resp.status);
      return json(JSON.parse(text));
    }

    // ---- Text to speech ---------------------------------------------------
    if (action === "tts") {
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) return json({ error: "text is required" }, 400);
      if (text.length > 5000) return json({ error: "text too long (max 5000 chars)" }, 400);
      const voice_id = TTS_VOICES.has(String(payload.voice_id))
        ? String(payload.voice_id)
        : "eve";
      const language = typeof payload.language === "string" ? payload.language : "en";
      const resp = await xai(key, "/tts", {
        method: "POST",
        body: JSON.stringify({ text, voice_id, language }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return json({ error: `xAI TTS ${resp.status}: ${err}` }, resp.status);
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return new Response(bytes, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    // ---- Responses API (single-shot reasoning, non-streaming) -------------
    if (action === "respond") {
      const model = typeof payload.model === "string" ? payload.model : "grok-4.5";
      const input = payload.input ?? prompt;
      if (!input) return json({ error: "input is required" }, 400);
      const resp = await xai(key, "/responses", {
        method: "POST",
        body: JSON.stringify({ model, input }),
      });
      const text = await resp.text();
      if (!resp.ok) return json({ error: `xAI ${resp.status}: ${text}` }, resp.status);
      return json(JSON.parse(text));
    }

    return json({ error: `Unknown action: ${action || "(none)"}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
