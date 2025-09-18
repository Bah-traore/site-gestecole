// Cloudflare Pages Function: /api/start-verify
// Démarre un flux de vérification en 2 étapes en générant un code à usage unique
// Le code est stocké dans la même KV que /api/login avec un préfixe "verify:"

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders('POST, OPTIONS')
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json({ success: false, message: 'Content-Type must be application/json' }, 415);
    }

    const body = await request.json().catch(() => null);
    const email = (body?.email || '').toString().trim();
    const loginId = (body?.loginId || '').toString().trim();

    if (!email) {
      return json({ success: false, message: 'Email requis' }, 400);
    }
    if (!isValidEmail(email)) {
      return json({ success: false, message: "Format d'email invalide" }, 400);
    }

    const KV = getKV(env);

    // Générer un code à 6 chiffres
    const code = generateCode();
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAtMs = now + 10 * 60 * 1000; // 10 minutes
    const expiresAt = new Date(expiresAtMs).toISOString();
    const verifyId = `verify:${now}:${Math.random().toString(36).slice(2, 8)}`;

    const record = {
      email,
      code,
      createdAt,
      expiresAt,
      attempts: 0,
      loginId: loginId || null,
      status: 'pending'
    };

    try {
      if (KV && typeof KV.put === 'function') {
        // Utilise une TTL de 15 minutes, en plus d'enregistrer expiresAt dans la valeur
        await KV.put(verifyId, JSON.stringify(record), { expirationTtl: 15 * 60 });
      }
    } catch (err) {
      console.warn('KV put (start-verify) failed:', err);
      // Ne bloque pas la suite si KV indisponible
    }
    // Envoi réel de l'email avec le code
    const provider = (env?.MAIL_PROVIDER || 'mailchannels').toLowerCase();
    const fromEmail = env?.MAIL_FROM || 'no-reply@example.com';
    const fromName = env?.MAIL_FROM_NAME || 'GestScolaire';

    const subject = 'Votre code de vérification - GestScolaire';
    const text = `Bonjour,\n\nVotre code de vérification est: ${code}\nIl est valable 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\nGestScolaire`;
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
      <p>Bonjour,</p>
      <p>Votre code de vérification est:</p>
      <p style="font-size:26px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
      <p>Il est valable <strong>10 minutes</strong>.</p>
      <p style="color:#555">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      <p style="margin-top:24px">— GestScolaire</p>
    </body></html>`;

    try {
      await sendEmail({ env, provider, to: email, subject, text, html, fromEmail, fromName });
    } catch (sendErr) {
      return json({ success: false, message: `Échec d'envoi de l'email: ${sendErr.message}` }, 502);
    }

    const includeDev = String(env?.RETURN_DEV_CODE || '').toLowerCase() === 'true';
    return json({
      success: true,
      message: 'Code de vérification envoyé',
      verifyId,
      delivery: { channel: 'email', provider, toMasked: maskEmail(email) },
      ...(includeDev ? { devCode: code } : {})
    });
  } catch (err) {
    return json({ success: false, message: 'Erreur serveur', error: err?.message || String(err) }, 500);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders()
    }
  });
}

function corsHeaders(methods = 'POST, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token'
  };
}

// Envoi d'email via différents fournisseurs
async function sendEmail({ env, provider, to, subject, text, html, fromEmail, fromName }) {
  switch (provider) {
    case 'sendgrid':
      return sendViaSendGrid(env, { to, subject, text, html, fromEmail, fromName });
    case 'mailgun':
      return sendViaMailgun(env, { to, subject, text, html, fromEmail, fromName });
    case 'mailchannels':
    default:
      return sendViaMailChannels({ to, subject, text, html, fromEmail, fromName });
  }
}

async function sendViaMailChannels({ to, subject, text, html, fromEmail, fromName }) {
  const payload = {
    personalizations: [
      { to: [{ email: to }] }
    ],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html }
    ]
  };
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MailChannels ${res.status}: ${body}`);
  }
}

async function sendViaSendGrid(env, { to, subject, text, html, fromEmail, fromName }) {
  const apiKey = env?.SENDGRID_API_KEY;
  if (!apiKey) throw new Error('SENDGRID_API_KEY manquant');
  const body = {
    personalizations: [ { to: [ { email: to } ] } ],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html }
    ]
  };
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`SendGrid ${res.status}: ${t}`);
  }
}

async function sendViaMailgun(env, { to, subject, text, html, fromEmail, fromName }) {
  const apiKey = env?.MAILGUN_API_KEY;
  const domain = env?.MAILGUN_DOMAIN;
  if (!apiKey || !domain) throw new Error('MAILGUN_API_KEY ou MAILGUN_DOMAIN manquant');
  const region = env?.MAILGUN_REGION || 'api'; // 'api' ou 'api.eu'
  const url = `https://${region}.mailgun.net/v3/${domain}/messages`;

  const form = new URLSearchParams();
  form.set('from', `${fromName} <${fromEmail}>`);
  form.set('to', to);
  form.set('subject', subject);
  form.set('text', text);
  form.set('html', html);

  const token = base64(`api:${apiKey}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Basic ${token}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Mailgun ${res.status}: ${t}`);
  }
}

function base64(str) {
  // Compatible Workers
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return str; }
}

function getKV(env) {
  return (
    env?.LOGINS ||
    env?.LOGINS_KV ||
    env?.KV_LOGINS ||
    env?.logins ||
    env?.['logins_kv'] ||
    env?.['logins-kv'] ||
    null
  );
}

function isValidEmail(email) {
  return /^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email) {
  try {
    const [local, domain] = email.split('@');
    const [name, ...rest] = local.split('+');
    const maskedLocal = name.length <= 2 ? name[0] + '*' : name.slice(0, 2) + '*'.repeat(Math.max(1, name.length - 2));
    const parts = domain.split('.');
    const tld = parts.pop();
    const domCore = parts.join('.') || '';
    const maskedDomCore = domCore ? domCore[0] + '*'.repeat(Math.max(1, domCore.length - 1)) : '';
    return `${maskedLocal}@${maskedDomCore}.${tld}`;
  } catch {
    return email;
  }
}
