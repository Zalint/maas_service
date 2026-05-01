/**
 * Modal "Changer mon mot de passe" partagé — disponible pour TOUS les users
 * connectés (pas uniquement ADMIN). Inclus dans:
 *   - admin.html
 *   - pos.html
 *   - et toute page qui charge ce script
 *
 * Comportement:
 *   - Auto-injecte le markup du modal une seule fois au DOMContentLoaded.
 *   - Bind tous les éléments avec [data-bs-target="#changePasswordModal"]
 *     ou id="change-password-btn".
 *   - Boutons œil pour révéler/masquer chaque champ.
 *   - Règles de mot de passe affichées explicitement et validées en temps réel.
 *   - Endpoint POST /api/me/change-password.
 *
 * Règles de mot de passe (gardées synchro avec server.js):
 *   - Au moins 6 caractères
 *   - Différent de l'ancien
 *   - Confirmation identique
 */
(function () {
    'use strict';

    // Si le module a déjà été chargé sur cette page (ex: 2 includes), no-op.
    if (window.__changePasswordModuleLoaded) return;
    window.__changePasswordModuleLoaded = true;

    const MIN_LENGTH = 6;

    function buildModalHTML() {
        return `
<div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="changePasswordModalLabel" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header bg-primary text-white">
        <h5 class="modal-title" id="changePasswordModalLabel">
          <i class="fas fa-key me-2"></i>Changer mon mot de passe
        </h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fermer"></button>
      </div>
      <div class="modal-body">
        <div class="alert alert-info" style="font-size:0.9rem;">
          <strong><i class="fas fa-info-circle me-1"></i>Règles du mot de passe :</strong>
          <ul class="mb-0 mt-2" id="changePasswordRules">
            <li id="rule-length">Au moins ${MIN_LENGTH} caractères</li>
            <li id="rule-different">Différent de l'ancien mot de passe</li>
            <li id="rule-match">La confirmation doit correspondre</li>
          </ul>
        </div>
        <form id="changePasswordForm" autocomplete="off">
          <div class="mb-3">
            <label for="oldPassword" class="form-label">Ancien mot de passe</label>
            <div class="input-group">
              <input type="password" class="form-control" id="oldPassword" required autocomplete="current-password">
              <button type="button" class="btn btn-outline-secondary" data-toggle-pwd="oldPassword" tabindex="-1" title="Afficher / masquer">
                <i class="fas fa-eye"></i>
              </button>
            </div>
          </div>
          <div class="mb-3">
            <label for="newPassword" class="form-label">Nouveau mot de passe</label>
            <div class="input-group">
              <input type="password" class="form-control" id="newPassword" required minlength="${MIN_LENGTH}" autocomplete="new-password">
              <button type="button" class="btn btn-outline-secondary" data-toggle-pwd="newPassword" tabindex="-1" title="Afficher / masquer">
                <i class="fas fa-eye"></i>
              </button>
            </div>
          </div>
          <div class="mb-3">
            <label for="newPasswordConfirm" class="form-label">Confirmer le nouveau mot de passe</label>
            <div class="input-group">
              <input type="password" class="form-control" id="newPasswordConfirm" required autocomplete="new-password">
              <button type="button" class="btn btn-outline-secondary" data-toggle-pwd="newPasswordConfirm" tabindex="-1" title="Afficher / masquer">
                <i class="fas fa-eye"></i>
              </button>
            </div>
          </div>
          <div id="changePasswordError" class="alert alert-danger" style="display:none;"></div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
        <button type="button" class="btn btn-primary" id="changePasswordSubmit">
          <i class="fas fa-save me-1"></i> Enregistrer
        </button>
      </div>
    </div>
  </div>
</div>`;
    }

    function injectModal() {
        // Si un modal #changePasswordModal existe déjà (ex: page legacy avec
        // markup inline), on le remplace par le markup partagé pour avoir
        // les boutons œil et l'affichage des règles.
        const existing = document.getElementById('changePasswordModal');
        if (existing) existing.remove();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildModalHTML();
        document.body.appendChild(wrapper.firstElementChild);
    }

    function wireTogglePwd() {
        document.querySelectorAll('[data-toggle-pwd]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-toggle-pwd');
                const input = document.getElementById(targetId);
                if (!input) return;
                const isPwd = input.type === 'password';
                input.type = isPwd ? 'text' : 'password';
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-eye', !isPwd);
                    icon.classList.toggle('fa-eye-slash', isPwd);
                }
            });
        });
    }

    function updateRuleStates() {
        const oldP = document.getElementById('oldPassword').value;
        const newP = document.getElementById('newPassword').value;
        const conf = document.getElementById('newPasswordConfirm').value;
        const setOk = (id, ok) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.color = ok ? 'green' : '';
            el.style.fontWeight = ok ? '600' : '';
        };
        setOk('rule-length', newP.length >= MIN_LENGTH);
        setOk('rule-different', !!newP && newP !== oldP);
        setOk('rule-match', !!newP && newP === conf);
    }

    async function submitChange(submitBtn) {
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirm = document.getElementById('newPasswordConfirm').value;
        const errorBox = document.getElementById('changePasswordError');
        const showError = (msg) => {
            errorBox.textContent = msg;
            errorBox.style.display = '';
        };
        errorBox.style.display = 'none';

        if (!oldPassword || !newPassword || !confirm) {
            return showError('Tous les champs sont requis.');
        }
        if (newPassword.length < MIN_LENGTH) {
            return showError(`Le nouveau mot de passe doit faire au moins ${MIN_LENGTH} caractères.`);
        }
        if (newPassword !== confirm) {
            return showError('La confirmation ne correspond pas au nouveau mot de passe.');
        }
        if (oldPassword === newPassword) {
            return showError('Le nouveau mot de passe doit être différent de l\'ancien.');
        }

        const original = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enregistrement...';
        try {
            const resp = await fetch('/api/me/change-password', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });
            const data = await resp.json();
            if (!data.success) {
                return showError(data.message || 'Échec du changement de mot de passe');
            }
            document.getElementById('changePasswordForm').reset();
            const modalEl = document.getElementById('changePasswordModal');
            const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modal.hide();
            if (typeof window.showToast === 'function') {
                window.showToast('Mot de passe mis à jour avec succès.', 'success');
            } else {
                alert('Mot de passe mis à jour avec succès.');
            }
        } catch (e) {
            console.error('change-password:', e);
            showError('Erreur réseau, réessaie.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = original;
        }
    }

    function init() {
        injectModal();
        wireTogglePwd();

        const submitBtn = document.getElementById('changePasswordSubmit');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => submitChange(submitBtn));
        }

        ['oldPassword', 'newPassword', 'newPasswordConfirm'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateRuleStates);
        });

        const modalEl = document.getElementById('changePasswordModal');
        if (modalEl) {
            modalEl.addEventListener('show.bs.modal', () => {
                document.getElementById('changePasswordForm').reset();
                document.getElementById('changePasswordError').style.display = 'none';
                updateRuleStates();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose pour debug ou tests manuels
    window.openChangePasswordModal = function () {
        const modalEl = document.getElementById('changePasswordModal');
        if (!modalEl || typeof bootstrap === 'undefined') return;
        const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        modal.show();
    };
})();
