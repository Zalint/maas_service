/**
 * UI helpers partages: showToast, showConfirmModal, et override de
 * window.alert/confirm pour remplacer les dialogues navigateur natifs
 * par des toasts/modals Bootstrap.
 *
 * IMPORTANT: ce fichier doit etre charge AVANT tout autre script
 * applicatif qui pourrait appeler alert/confirm. Les fonctions sont
 * exposees globalement (window.showToast, window.showConfirmModal).
 *
 * Compatibles avec ou sans Bootstrap (fallback DOM minimal).
 */
(function () {
    'use strict';

    /**
     * Toast non bloquant. Type auto-detecte si non fourni.
     * @param {string} message
     * @param {'success'|'danger'|'warning'|'info'|null} [type]
     * @param {number} [durationMs=4000]
     */
    function showToast(message, type, durationMs) {
        if (durationMs == null) durationMs = 4000;
        const text = String(message == null ? '' : message);
        if (!type) {
            type = /erreur|error|échec|echec|impossible|invalide/i.test(text) ? 'danger'
                 : /attention|warning|veuillez|prudent/i.test(text) ? 'warning'
                 : 'success';
        }
        let container = document.getElementById('appToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'appToastContainer';
            container.className = 'toast-container position-fixed top-0 end-0 p-3';
            container.style.zIndex = '1100';
            document.body.appendChild(container);
        }
        const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const toastEl = document.createElement('div');
        toastEl.className = 'toast align-items-center text-bg-' + type + ' border-0';
        toastEl.setAttribute('role', 'alert');
        toastEl.innerHTML =
            '<div class="d-flex">' +
            '<div class="toast-body" style="white-space: pre-line;">' + safe + '</div>' +
            '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
            '</div>';
        container.appendChild(toastEl);
        if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
            const t = new bootstrap.Toast(toastEl, { delay: durationMs });
            t.show();
            toastEl.addEventListener('hidden.bs.toast', function () { toastEl.remove(); });
        } else {
            toastEl.classList.add('show');
            setTimeout(function () { toastEl.remove(); }, durationMs);
        }
    }

    /**
     * Modal de confirmation OK/Cancel. Retourne Promise<boolean>.
     * @param {string} message
     * @param {{title?:string, okLabel?:string, cancelLabel?:string, okVariant?:string}} [options]
     */
    function showConfirmModal(message, options) {
        options = options || {};
        const title = options.title || 'Confirmation';
        const okLabel = options.okLabel || 'OK';
        const cancelLabel = options.cancelLabel || 'Annuler';
        const okVariant = options.okVariant || 'primary';
        const safe = String(message == null ? '' : message)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return new Promise(function (resolve) {
            const modalEl = document.createElement('div');
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            modalEl.innerHTML =
                '<div class="modal-dialog modal-dialog-scrollable modal-dialog-centered">' +
                '<div class="modal-content">' +
                '<div class="modal-header">' +
                '<h5 class="modal-title">' + title + '</h5>' +
                '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
                '</div>' +
                '<div class="modal-body" style="white-space: pre-line;">' + safe + '</div>' +
                '<div class="modal-footer">' +
                '<button type="button" class="btn btn-secondary" data-action="cancel">' + cancelLabel + '</button>' +
                '<button type="button" class="btn btn-' + okVariant + '" data-action="ok">' + okLabel + '</button>' +
                '</div>' +
                '</div>' +
                '</div>';
            document.body.appendChild(modalEl);

            let settled = false;
            const settle = function (value) {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            modalEl.querySelector('[data-action="ok"]').addEventListener('click', function () {
                settle(true);
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                } else {
                    modalEl.remove();
                }
            });
            modalEl.querySelector('[data-action="cancel"]').addEventListener('click', function () {
                settle(false);
            });
            modalEl.addEventListener('hidden.bs.modal', function () {
                settle(false);
                modalEl.remove();
            });

            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const m = new bootstrap.Modal(modalEl);
                m.show();
            } else {
                modalEl.style.display = 'block';
                modalEl.classList.add('show');
            }
        });
    }

    // Expose global
    window.showToast = showToast;
    window.showConfirmModal = showConfirmModal;

    // Override alert(): redirige tous les appels existants vers showToast.
    // Comportement non bloquant (le code apres l'alert continue immediatement),
    // ce qui change subtilement les flux qui dependaient du blocage. Dans ce
    // codebase la quasi-totalite des alert() sont suivis d'un return ou d'une
    // fin de fonction, donc le changement est sans impact.
    //
    // confirm() ne peut pas etre override car il est synchrone (return bool)
    // alors que showConfirmModal est asynchrone (return Promise). Les sites
    // confirm() sont convertis manuellement en await showConfirmModal(...).
    const _nativeAlert = window.alert;
    window.alert = function (msg) {
        try {
            showToast(msg);
        } catch (e) {
            _nativeAlert.call(window, msg);
        }
    };
})();
