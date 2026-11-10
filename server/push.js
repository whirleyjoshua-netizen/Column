// Push notifications: what reaches a phone or computer while Kloomie is closed. Each device that turns
// notifications on gives the server a push address (a browser "subscription"); the server encrypts a
// short note to it with web-push. The VAPID key pair that signs them comes from VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY, or is made once and kept with the data, so it never changes under people.
import crypto from 'node:crypto';
import webpush from 'web-push';

export function createPush({ db, save, contact }) {
  let ready = false;
  function keys() {
    if (ready) return db.keys.vapid;
    db.keys ||= {};
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) db.keys.vapid = { id: 'vapid', pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    else if (!db.keys.vapid) {
      const k = webpush.generateVAPIDKeys();
      db.keys.vapid = { id: 'vapid', pub: k.publicKey, priv: k.privateKey };
      save();
    }
    webpush.setVapidDetails(contact, db.keys.vapid.pub, db.keys.vapid.priv);
    ready = true;
    return db.keys.vapid;
  }
  const subId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 32);
  const okEndpoint = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' || (process.env.ALLOW_LOCAL_PUSH === '1' && x.protocol === 'http:');
    } catch {
      return false;
    }
  };

  function add({ wsId, memberId, token, deviceId, device, sub }) {
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000 || !okEndpoint(sub.endpoint)) throw Object.assign(new Error('That push address isn’t right.'), { status: 400 });
    const p256dh = String(sub.keys?.p256dh || ''), auth = String(sub.keys?.auth || '');
    if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw Object.assign(new Error('That push address is missing its keys.'), { status: 400 });
    const id = subId(sub.endpoint);
    db.pushSubs[id] = { id, wsId, memberId, token, deviceId: deviceId || null, device: String(device || '').slice(0, 80), endpoint: sub.endpoint, keys: { p256dh, auth }, createdAt: db.pushSubs[id]?.createdAt || Date.now() };
    save();
    return db.pushSubs[id];
  }
  function remove(endpoint) {
    const id = subId(endpoint);
    if (!db.pushSubs[id]) return false;
    delete db.pushSubs[id];
    save();
    return true;
  }
  function drop(pred) {
    let n = 0;
    for (const x of Object.values(db.pushSubs)) if (pred(x)) { delete db.pushSubs[x.id]; n++; }
    if (n) save();
    return n;
  }
  const subsOf = (wsId, memberId) => Object.values(db.pushSubs).filter((x) => x.wsId === wsId && x.memberId === memberId);
  const has = (endpoint) => !!db.pushSubs[subId(endpoint)];

  // Sends to every device the person turned it on for. A device whose address is gone (404/410) is forgotten.
  const sent = []; // for tests: the last notes sent (never the keys)
  async function send(wsId, memberId, note) {
    const list = subsOf(wsId, memberId);
    if (!list.length) return 0;
    keys();
    const body = JSON.stringify(note);
    let n = 0;
    await Promise.all(list.map(async (x) => {
      try {
        await webpush.sendNotification({ endpoint: x.endpoint, keys: x.keys }, body, { TTL: 60 * 60 * 24, urgency: 'high', timeout: 10_000 });
        n++;
        sent.push({ memberId, device: x.device, ...note });
        if (sent.length > 50) sent.shift();
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) remove(x.endpoint);
        else console.error('Push failed:', e.statusCode || '', e.message);
      }
    }));
    return n;
  }
  return { publicKey: () => keys().pub, add, remove, drop, has, subsOf, send, sent };
}
