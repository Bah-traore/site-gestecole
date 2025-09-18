// Cloudflare Pages Function: /api/logins (listing)
// Lists stored login records from KV LOGINS. Protected with ADMIN_TOKEN if set.

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const KV = getKV(env);
    if (!KV || typeof KV.list !== 'function') {
      return json({ success: false, message: 'KV LOGINS non configurée' }, 500);
    }

    // Require admin token when configured
    const requiredToken = env?.ADMIN_TOKEN;
    if (requiredToken) {
      const provided = request.headers.get('X-Admin-Token');
      if (provided !== requiredToken) {
        return json({ success: false, message: 'Non autorisé' }, 401);
      }
    }

    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(100, isNaN(limitParam) ? 20 : limitParam));
    const cursor = url.searchParams.get('cursor') || undefined;
    const prefix = url.searchParams.get('prefix') || 'login:';

    const list = await KV.list({ prefix, limit, cursor });

    // Fetch values for the listed keys in parallel (keep it reasonable)
    const items = await Promise.all(
      (list.keys || []).map(async (k) => {
        const raw = await KV.get(k.name);
        let record;
        try { record = JSON.parse(raw); } catch { record = raw; }
        return { id: k.name, ...record };
      })
    );

    return json({
      success: true,
      items,
      cursor: list.cursor || null,
      list_complete: list.list_complete === true
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
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Helper: tente plusieurs noms de binding pour la KV
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
