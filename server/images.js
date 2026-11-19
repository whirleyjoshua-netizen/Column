// Pictures for posts and flyers, made on the team's own AI key: OpenAI (gpt-image models) or Google Gemini
// (its image models, "Nano Banana"). Claude doesn't make pictures, so a team with only a Claude key is told so.
// The newest image model each key can use is looked up from the provider's own model list (and remembered for a
// day), so new models are picked up without a change here.
const DAY = 864e5;
const TIMEOUT = 120_000;
const picked = new Map(); // provider + key end → { model, at }

const OPENAI = () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const GEMINI = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const fail = (msg, status = 502) => Object.assign(new Error(msg), { status });
// Version numbers in a model id, for picking the newest: gpt-image-2.6-sunburst → [2, 6].
const version = (id) => (String(id).match(/\d+(\.\d+)*/g) || []).flatMap((x) => x.split('.').map(Number));
const newer = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return 0; };

async function json(res) {
  const d = await res.json().catch(() => null);
  if (!res.ok) throw fail(d?.error?.message || d?.error || res.statusText, res.status === 401 || res.status === 403 ? 400 : 502);
  return d;
}

const providers = {
  openai: {
    async model(key) {
      const d = await json(await fetch(OPENAI() + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20_000) }));
      const ids = (d.data || []).map((m) => m.id).filter((id) => /^gpt-image/.test(id));
      // Newest first; a full model over a mini one of the same version.
      ids.sort((a, b) => newer(a, b) || (/mini/.test(a) ? 1 : 0) - (/mini/.test(b) ? 1 : 0));
      return ids[0] || 'gpt-image-1';
    },
    async make(key, model, prompt, shape) {
      const size = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' }[shape] || '1024x1024';
      const go = (body) => fetch(OPENAI() + '/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
      let res = await go({ model, prompt, size, n: 1 });
      if (res.status === 400) res = await go({ model, prompt, n: 1 }); // a model that picks its own size
      const d = await json(res);
      const it = d.data?.[0];
      if (it?.b64_json) return { bytes: Buffer.from(it.b64_json, 'base64'), mime: 'image/png' };
      if (it?.url && /^https:\/\//.test(it.url)) {
        const img = await fetch(it.url, { signal: AbortSignal.timeout(30_000) });
        if (img.ok) return { bytes: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/png' };
      }
      throw fail('OpenAI didn’t send a picture back.');
    },
  },
  gemini: {
    async model(key) {
      const d = await json(await fetch(`${GEMINI()}/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20_000) }));
      const ms = (d.models || []).filter((m) => /image/.test(m.name) && !/imagen/.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
      // Newest first; the quick "flash" kind over "pro" at the same version, and anything over a deprecated 2.5.
      ms.sort((a, b) => newer(a, b) || (/flash/.test(a) ? 0 : 1) - (/flash/.test(b) ? 0 : 1));
      return ms[0] || 'gemini-2.5-flash-image';
    },
    async make(key, model, prompt, shape) {
      const ratio = { square: '1:1', portrait: '3:4', landscape: '4:3' }[shape] || '1:1';
      const go = (cfg) => fetch(`${GEMINI()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }), signal: AbortSignal.timeout(TIMEOUT) });
      let res = await go({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } });
      if (res.status === 400) res = await go({ responseModalities: ['TEXT', 'IMAGE'] }); // older models
      const d = await json(res);
      const part = (d.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
      const inl = part?.inlineData || part?.inline_data;
      if (!inl) throw fail(d.candidates?.[0]?.finishReason === 'SAFETY' || d.promptFeedback?.blockReason ? 'Gemini wouldn’t make that picture. Try describing it differently.' : 'Gemini didn’t send a picture back.');
      return { bytes: Buffer.from(inl.data, 'base64'), mime: inl.mimeType || inl.mime_type || 'image/png' };
    },
  },
};
export const IMAGE_PROVIDERS = Object.keys(providers);

// keys: { openai?: key, gemini?: key }, prefer: the provider the team uses for writing, if it makes pictures.
export async function makeImage(keys, prompt, { shape = 'square', prefer } = {}) {
  const order = [prefer, 'openai', 'gemini'].filter((p, i, a) => providers[p] && keys[p] && a.indexOf(p) === i);
  if (!order.length) throw fail('Pictures need an OpenAI or Google Gemini key (Claude doesn’t make pictures). Add one in Apps & Integrations → AI.', 400);
  const provider = order[0];
  const key = keys[provider];
  const tag = provider + ':' + key.slice(-6);
  let model = picked.get(tag);
  if (!model || Date.now() - model.at > DAY) {
    model = { model: await providers[provider].model(key).catch(() => (provider === 'openai' ? 'gpt-image-1' : 'gemini-2.5-flash-image')), at: Date.now() };
    picked.set(tag, model);
  }
  try {
    return { ...(await providers[provider].make(key, model.model, prompt, shape)), provider, model: model.model };
  } catch (e) {
    if (e.name === 'TimeoutError') throw fail('The picture took too long. Try again.');
    throw e;
  }
}
