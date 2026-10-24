// The AI providers Column's smart buttons run on, with each person's own API key: Claude, OpenAI, Gemini.
// Each provider runs one turn as its own tool-use loop and returns the final reply. complete() is the
// plain case: one prompt in, text out, no tools.
//
// run({ key, model, system, history, tools, web, exec, onStep }) -> { text, refused? }
//   history: [{ role: 'user' | 'assistant', text, files? }], ending with the new user message
//   files:   [{ name, text }] read as text, or [{ name, mime, data }] (base64 PDF or image) read whole
//   tools:   [{ name, description, parameters }] (JSON Schema), run with exec(name, args) -> result
//   web:     let the agent search the web
import Anthropic from '@anthropic-ai/sdk';

const MAX_STEPS = 16;
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const isPdf = (f) => f.mime === 'application/pdf';
const fileHeading = (f) => `File: ${f.name}\n\n${f.text}`;
const toolResult = async (exec, name, args, onStep) => {
  onStep?.(name);
  try {
    return { ok: true, out: JSON.stringify(await exec(name, args ?? {})) };
  } catch (e) {
    return { ok: false, out: JSON.stringify({ error: String(e.message || e) }) };
  }
};

// ---------- Claude ----------
// Claude Opus 5.5 is the default. Thinking stays at the model's default; effort is set explicitly.
const WEB_SEARCH_NEW = /^claude-(opus-(5|5-5|4-8|4-7|4-6)|sonnet-(5|5-5|4-6))$/;
const HAS_EFFORT = /^claude-(opus-(5|5-5|4-[5-8])|sonnet-(5|5-5|4-6)|fable-5|fable-5-1|haiku-5-5)$/;
// Models that take the server-side refusal fallback ("default" picks the fallback model by category).
const FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const claude = {
  name: 'Claude',
  async models(key) {
    const client = new Anthropic({ apiKey: key });
    const out = [];
    for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name || m.id });
    return out;
  },
  pick: (models) => (models.find((m) => m.id === 'claude-opus-5-5') || models[0])?.id,
  async run({ key, model, system, history, tools, web, exec, onStep }) {
    const client = new Anthropic({ apiKey: key, maxRetries: 2 });
    const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (web) defs.push({ type: WEB_SEARCH_NEW.test(model) ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 });
    // Files are cached with the system prompt, so a long conversation about them doesn't pay for them each turn.
    const messages = history.map((m) => {
      if (!m.files?.length) return { role: m.role, content: m.text };
      const blocks = m.files.map((f) => (f.text != null
        ? { type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.text }, title: f.name }
        : isPdf(f) ? { type: 'document', source: { type: 'base64', media_type: f.mime, data: f.data }, title: f.name }
        : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data } }));
      blocks.at(-1).cache_control = { type: 'ephemeral' };
      return { role: m.role, content: [...blocks, { type: 'text', text: m.text }] };
    });
    let text = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const params = { model, max_tokens: 16000, system, ...(defs.length ? { tools: defs } : {}), messages, ...(HAS_EFFORT.test(model) ? { output_config: { effort: 'medium' } } : {}) };
      const res = FALLBACK.has(model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
      // The whole content goes back, thinking and search results included.
      messages.push({ role: 'assistant', content: res.content });
      const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (said.trim()) text = said;
      if (res.stop_reason === 'refusal') return { text: text || 'I can’t help with that one.', refused: true };
      if (res.stop_reason === 'pause_turn') continue; // a long web search paused; carry on
      if (res.stop_reason !== 'tool_use') return { text };
      const results = [];
      for (const b of res.content) {
        if (b.type !== 'tool_use') continue;
        const r = await toolResult(exec, b.name, b.input, onStep);
        results.push({ type: 'tool_result', tool_use_id: b.id, content: r.out, ...(r.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: text || 'I ran out of steps before finishing. Ask me to continue.' };
  },
};

// ---------- OpenAI (Responses API) ----------
async function openaiCall(key, pathname, body) {
  const res = await fetch('https://api.openai.com/v1' + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { status: res.status });
  return data;
}
const openai = {
  name: 'OpenAI',
  async models(key) {
    const d = await openaiCall(key, '/models');
    return d.data.map((m) => m.id).filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|image|tts|transcribe|search|embedding|instruct)/.test(id)).sort().reverse().map((id) => ({ id, name: id }));
  },
  pick: (models) => (models.find((m) => /^gpt-\d+(\.\d+)?$/.test(m.id)) || models[0])?.id,
  async run({ key, model, system, history, tools, web, exec, onStep }) {
    const defs = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
    if (web) defs.push({ type: 'web_search' });
    let input = history.map((m) => (m.files?.length ? {
      role: m.role,
      content: [...m.files.flatMap((f) => (f.text != null ? [{ type: 'input_text', text: fileHeading(f) }]
        : isPdf(f) ? [{ type: 'input_file', filename: f.name, file_data: `data:${f.mime};base64,${f.data}` }]
        : [{ type: 'input_text', text: `File: ${f.name}` }, { type: 'input_image', image_url: `data:${f.mime};base64,${f.data}` }])), { type: 'input_text', text: m.text }],
    } : { role: m.role, content: m.text }));
    let prev = null;
    let text = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await openaiCall(key, '/responses', { model, instructions: system, input, ...(defs.length ? { tools: defs } : {}), ...(prev ? { previous_response_id: prev } : {}) });
      prev = res.id;
      const said = res.output.filter((o) => o.type === 'message').flatMap((o) => o.content).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
      if (said.trim()) text = said;
      const calls = res.output.filter((o) => o.type === 'function_call');
      if (!calls.length) return { text };
      input = [];
      for (const c of calls) {
        let args = {};
        try {
          args = JSON.parse(c.arguments || '{}');
        } catch {}
        input.push({ type: 'function_call_output', call_id: c.call_id, output: (await toolResult(exec, c.name, args, onStep)).out });
      }
    }
    return { text: text || 'I ran out of steps before finishing. Ask me to continue.' };
  },
};

// ---------- Gemini ----------
async function geminiCall(key, pathname, body) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta' + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { status: res.status });
  return data;
}
const WEB_TOOL = { name: 'web_search', description: 'Search the web. Returns a short summary with source links.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
const gemini = {
  name: 'Gemini',
  async models(key) {
    const d = await geminiCall(key, '/models?pageSize=200');
    return d.models.filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-/.test(m.name) && !/(image|tts|audio|live|embedding)/.test(m.name))
      .map((m) => ({ id: m.name.slice(7), name: m.displayName || m.name.slice(7) })).sort((a, b) => (a.id < b.id ? 1 : -1));
  },
  pick: (models) => (models.find((m) => /^gemini-[\d.]+-pro$/.test(m.id)) || models.find((m) => /^gemini-[\d.]+-flash$/.test(m.id)) || models[0])?.id,
  // Search grounding runs as its own request, so it works next to function tools on any model.
  async search(key, model, query) {
    const d = await geminiCall(key, `/models/${model}:generateContent`, { contents: [{ role: 'user', parts: [{ text: `Research this and answer concisely with the key facts: ${query}` }] }], tools: [{ google_search: {} }] });
    const c = d.candidates?.[0];
    const text = (c?.content?.parts || []).map((p) => p.text || '').join('');
    const sources = (c?.groundingMetadata?.groundingChunks || []).map((g) => g.web && `${g.web.title}: ${g.web.uri}`).filter(Boolean);
    return { summary: text, sources };
  },
  async run({ key, model, system, history, tools, web, exec, onStep }) {
    const all = web ? [...tools, WEB_TOOL] : tools;
    const run = (name, args) => (name === 'web_search' ? gemini.search(key, model, args.query) : exec(name, args));
    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [...(m.files || []).flatMap((f) => (f.text != null ? [{ text: fileHeading(f) }] : [{ text: `File: ${f.name}` }, { inlineData: { mimeType: f.mime, data: f.data } }])), { text: m.text }],
    }));
    let text = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const d = await geminiCall(key, `/models/${model}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        ...(all.length ? { tools: [{ functionDeclarations: all.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
      });
      const c = d.candidates?.[0];
      if (!c?.content) return { text: text || (c?.finishReason === 'SAFETY' ? 'I can’t help with that one.' : 'No reply.'), refused: c?.finishReason === 'SAFETY' };
      // Kept whole: function calls carry signatures the model needs back.
      contents.push(c.content);
      const parts = c.content.parts || [];
      const said = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      if (said.trim()) text = said;
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) return { text };
      const out = [];
      for (const p of calls) {
        const r = await toolResult(run, p.functionCall.name, p.functionCall.args, onStep);
        out.push({ functionResponse: { name: p.functionCall.name, response: { result: JSON.parse(r.out) } } });
      }
      contents.push({ role: 'user', parts: out });
    }
    return { text: text || 'I ran out of steps before finishing. Ask me to continue.' };
  },
};

export const llms = { anthropic: claude, openai, gemini };

// One prompt, one reply.
export async function complete(provider, { key, model, system, prompt }) {
  const out = await provider.run({ key, model, system, history: [{ role: 'user', text: prompt }], tools: [], web: false, exec: () => Promise.reject(new Error('No tools')) });
  if (out.refused) throw new Error(out.text);
  return out.text;
}

// A provider's error, worded for the person who owns the key.
export function llmError(e) {
  const s = e.status;
  if (s === 401 || s === 403 || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'Your AI key was rejected. Check it in Settings → AI.';
  if (s === 429 || e instanceof Anthropic.RateLimitError) return 'The provider is rate limiting this key right now. Try again in a minute.';
  if (s === 404 || e instanceof Anthropic.NotFoundError) return 'That model isn’t available to your key. Pick another in Settings → AI.';
  if (s === 400 || e instanceof Anthropic.BadRequestError) return 'The provider rejected the request: ' + clip(String(e.message), 300);
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the provider.';
  return 'The AI request failed: ' + clip(String(e.message || e), 300);
}
