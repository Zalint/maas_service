/**
 * Tests pour le helper showToast partagé entre admin.js et pos.js.
 *
 * Le helper est défini deux fois (une dans admin.js, une dans pos.js — quasi-
 * identiques). Source: admin.js lignes 4-46. Le test mirroir le code; si la
 * source change, ce fichier doit suivre — l'échec sur la nouvelle valeur
 * facilite la détection.
 */

// Mirror exact du helper (à garder synchronisé avec admin.js / pos.js).
function showToast(message, type = null, durationMs = 4000) {
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
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body" style="white-space: pre-line;">${safe}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    container.appendChild(toastEl);
    if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
        const t = new bootstrap.Toast(toastEl, { delay: durationMs });
        t.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    } else {
        toastEl.classList.add('show');
        setTimeout(() => toastEl.remove(), durationMs);
    }
}

beforeEach(() => {
    document.body.innerHTML = '';
    delete global.bootstrap;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('showToast severity heuristic', () => {
    test('default succès', () => {
        showToast('Configuration sauvegardée');
        const toast = document.querySelector('.toast');
        expect(toast.className).toContain('text-bg-success');
    });

    test('"Erreur" → danger', () => {
        showToast('Erreur lors de la sauvegarde');
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"erreur" minuscule → danger (case insensitive)', () => {
        showToast('une erreur est survenue');
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"échec" avec accent → danger', () => {
        showToast("Échec de l'envoi");
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"echec" sans accent → danger', () => {
        showToast('Echec de la migration');
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"impossible" → danger', () => {
        showToast('Impossible de joindre le serveur');
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"invalide" → danger', () => {
        showToast('Format de date invalide');
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });

    test('"Attention" → warning', () => {
        showToast('Attention: stock bas');
        expect(document.querySelector('.toast').className).toContain('text-bg-warning');
    });

    test('"Veuillez" → warning', () => {
        showToast('Veuillez sélectionner une date');
        expect(document.querySelector('.toast').className).toContain('text-bg-warning');
    });

    test('override explicite type', () => {
        showToast('Quoi que ce soit', 'info');
        expect(document.querySelector('.toast').className).toContain('text-bg-info');
    });

    test('priorité danger > warning quand les deux mots présents', () => {
        showToast("Attention: erreur critique");
        // 'erreur' matche le premier regex → danger gagne
        expect(document.querySelector('.toast').className).toContain('text-bg-danger');
    });
});

describe('showToast container idempotency', () => {
    test('crée le container une seule fois', () => {
        showToast('A');
        showToast('B');
        showToast('C');
        const containers = document.querySelectorAll('#appToastContainer');
        expect(containers.length).toBe(1);
        const toasts = containers[0].querySelectorAll('.toast');
        expect(toasts.length).toBe(3);
    });

    test('container a les classes Bootstrap correctes pour le placement', () => {
        showToast('Hello');
        const c = document.getElementById('appToastContainer');
        expect(c.className).toContain('toast-container');
        expect(c.className).toContain('position-fixed');
        expect(c.className).toContain('top-0');
        expect(c.className).toContain('end-0');
    });
});

describe('showToast XSS safety', () => {
    test('échappe < et > dans le contenu', () => {
        showToast('<script>alert(1)</script>');
        const body = document.querySelector('.toast-body');
        // textContent doit afficher le texte brut, pas exécuter le script
        expect(body.textContent).toContain('<script>');
        // innerHTML doit avoir les entités encodées
        expect(body.innerHTML).toContain('&lt;script&gt;');
        // Pas de <script> tag réel injecté
        expect(document.querySelectorAll('.toast-body script').length).toBe(0);
    });

    test('échappe & en premier', () => {
        showToast('A & B < C');
        expect(document.querySelector('.toast-body').innerHTML).toContain('A &amp; B &lt; C');
    });

    test('null / undefined → string vide, pas de crash', () => {
        expect(() => showToast(null)).not.toThrow();
        expect(() => showToast(undefined)).not.toThrow();
        const bodies = document.querySelectorAll('.toast-body');
        expect(bodies[0].textContent.trim()).toBe('');
    });

    test('nombre est stringifié', () => {
        showToast(42);
        expect(document.querySelector('.toast-body').textContent.trim()).toBe('42');
    });
});

describe('showToast fallback sans Bootstrap', () => {
    test('classList.show ajouté + setTimeout pour remove', () => {
        // bootstrap absent → fallback manuel
        showToast('Test', null, 100);
        const toast = document.querySelector('.toast');
        expect(toast.classList.contains('show')).toBe(true);
        // Avant timeout
        expect(document.querySelectorAll('.toast').length).toBe(1);
        // Avancer le temps
        jest.advanceTimersByTime(150);
        expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    test('utilise bootstrap.Toast si disponible', () => {
        const showSpy = jest.fn();
        const ToastCtor = jest.fn().mockImplementation(() => ({ show: showSpy }));
        global.bootstrap = { Toast: ToastCtor };
        showToast('Test', null, 5000);
        expect(ToastCtor).toHaveBeenCalledTimes(1);
        const [el, opts] = ToastCtor.mock.calls[0];
        expect(el.className).toContain('toast');
        expect(opts.delay).toBe(5000);
        expect(showSpy).toHaveBeenCalled();
        // En mode bootstrap, on n'ajoute PAS la classe show manuellement
        expect(el.classList.contains('show')).toBe(false);
    });
});
