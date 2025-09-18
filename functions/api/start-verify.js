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
    // Pas d'envoi d'email: on renvoie simplement l'identifiant de vérification
    const includeDev = String(env?.RETURN_DEV_CODE || '').toLowerCase() === 'true';
    return json({
      success: true,
      message: 'Code de vérification généré',
      verifyId,
      delivery: { channel: 'none' },
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
