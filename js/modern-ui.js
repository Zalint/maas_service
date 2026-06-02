/* ============================================================
   Matix Modern UI — bootstrap script.

   Charge en debut de <head>. Deux phases :

   PHASE 1 (synchrone, avant paint) :
       Lit localStorage.matix_ui_settings et applique
       <html data-ui-mode="modern" data-sidebar-pos="..." data-sidebar-collapsed="..."> AVANT
       que le navigateur ne peigne. Evite le flash classic -> modern.

   PHASE 2 (DOMContentLoaded) :
       - Fetch /api/ui-settings (le serveur calcule enabledForCurrentUser
         en fonction du role de la session)
       - Sync cache + reload si different
       - Si mode moderne actif, construit le shell : topbar (hamburger +
         brand + tenant + groupe switcher + user-chip) + sidebar miroir.
       - Le hamburger toggle data-sidebar-collapsed (localStorage).

   POS (pos.html) : detection via location.pathname — on ne fait rien.
   ============================================================ */
(function () {
    'use strict';

    var IS_POS = /\/pos\.html$/i.test(location.pathname);
    if (IS_POS) return; // POS reste sur son design dedie.

    // ----- PHASE 1 : applique l'attribut data-ui-mode AVANT paint -----
    try {
        var cachedRaw = localStorage.getItem('matix_ui_settings');
        if (cachedRaw) {
            var cached = JSON.parse(cachedRaw);
            if (cached && cached.newUiEnabled === true) {
                document.documentElement.setAttribute('data-ui-mode', 'modern');
                var pos = cached.sidebarPosition === 'left' ? 'left' : 'right';
                document.documentElement.setAttribute('data-sidebar-pos', pos);
                // Etat collapsed (hamburger) : stocke separement, propre au user.
                if (localStorage.getItem('matix_sidebar_collapsed') === '1') {
                    document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
                }
            }
        }
        // Theme (light/dark/auto). Override user (localStorage) prevaut sur
        // tenant default. Defaut final = 'auto' (suit prefers-color-scheme).
        var themeUser = localStorage.getItem('matix_ui_theme');
        var themeTenant = null;
        try {
            var s = JSON.parse(cachedRaw || '{}');
            themeTenant = s.defaultTheme;
        } catch (e) {}
        var theme = themeUser || themeTenant || 'auto';
        if (['auto', 'light', 'dark'].indexOf(theme) < 0) theme = 'auto';
        document.documentElement.setAttribute('data-ui-theme', theme);
    } catch (e) {
        // Cache invalide -> on ignore, on attendra la reponse serveur
    }

    // ----- PHASE 2 : fetch + build shell -----
    function init() {
        // Anti-flash : si le cache dit deja modern (Phase 1 a applique
        // data-ui-mode), on BUILD LE SHELL IMMEDIATEMENT, sans attendre la
        // reponse /api/ui-settings. Le fetch tourne ensuite en background
        // pour syncher. Resultat : sur les navigations entre pages, la
        // sidebar apparait quasi-instantanement (pas de saute/revient).
        var alreadyModern = document.documentElement.getAttribute('data-ui-mode') === 'modern';
        if (alreadyModern) {
            buildShell();
        }

        fetchSettings().then(function (settings) {
            var cachedRaw = localStorage.getItem('matix_ui_settings');
            var cached = null;
            try { cached = cachedRaw ? JSON.parse(cachedRaw) : null; } catch (e) {}

            var changed = !cached
                || cached.newUiEnabled !== settings.enabledForCurrentUser
                || cached.sidebarPosition !== settings.sidebarPosition;

            // On stocke le bool effectif (enabledForCurrentUser), pas la liste.
            // Comme ca chaque user voit son etat propre, sans logique cote client.
            localStorage.setItem('matix_ui_settings', JSON.stringify({
                newUiEnabled: !!settings.enabledForCurrentUser,
                sidebarPosition: settings.sidebarPosition === 'left' ? 'left' : 'right',
                defaultTheme: settings.defaultTheme || 'auto'
            }));

            // Si user n'a pas d'override personnel (localStorage.matix_ui_theme),
            // applique le tenant default qu'on vient de fetch.
            if (!localStorage.getItem('matix_ui_theme')) {
                var t = settings.defaultTheme || 'auto';
                document.documentElement.setAttribute('data-ui-theme', t);
                applyChartTheme(getEffectiveTheme());
            }

            if (changed && cached) {
                location.reload();
                return;
            }

            // Premier load (cached null) : build maintenant si modern.
            // Si on a deja build (alreadyModern), pas besoin.
            if (settings.enabledForCurrentUser && !alreadyModern) {
                document.documentElement.setAttribute('data-ui-mode', 'modern');
                document.documentElement.setAttribute(
                    'data-sidebar-pos',
                    settings.sidebarPosition === 'left' ? 'left' : 'right'
                );
                buildShell();
            }
        }).catch(function (err) {
            console.warn('[modern-ui] fetch ui-settings echec, fallback cache:', err && err.message);
            // Si on n'a pas encore build et le mode est modern (cache), build maintenant.
            if (!alreadyModern && document.documentElement.getAttribute('data-ui-mode') === 'modern') {
                buildShell();
            }
        });
    }

    function fetchSettings() {
        return fetch('/api/ui-settings', { credentials: 'same-origin' })
            .then(function (r) {
                // Surface les erreurs HTTP (401, 500, etc.) au lieu de parser
                // un body qui pourrait etre HTML/vide/non-JSON et faire echouer
                // r.json() avec un message generique.
                if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (r.statusText || ''));
                return r.json();
            })
            .then(function (data) {
                if (!data || data.success === false) throw new Error('invalid response');
                // back-compat : si enabledForCurrentUser absent, retombe sur newUiEnabled
                var enabled = (typeof data.enabledForCurrentUser === 'boolean')
                    ? data.enabledForCurrentUser
                    : !!data.newUiEnabled;
                var theme = data.defaultTheme;
                if (['auto', 'light', 'dark'].indexOf(theme) < 0) theme = 'auto';
                return {
                    enabledForCurrentUser: enabled,
                    sidebarPosition: data.sidebarPosition === 'left' ? 'left' : 'right',
                    defaultTheme: theme
                };
            });
    }

    // Recupere le user courant via /api/check-session (pour group switcher
    // role-aware). Cache en memoire pour eviter les round-trips.
    var _userCache = null;
    function fetchCurrentUser() {
        if (_userCache) return Promise.resolve(_userCache);
        return fetch('/api/check-session', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                _userCache = (data && data.user) ? data.user : null;
                return _userCache;
            })
            .catch(function () { return null; });
    }

    // ============================================================
    //  SHELL CONSTRUCTION
    // ============================================================

    // Normalise un path (ajoute "/" leading, strip query/hash, lowercase).
    function normalizePath(p) {
        if (!p) return '';
        var s = String(p).toLowerCase();
        // Strip query + hash
        var qIdx = s.indexOf('?');
        if (qIdx >= 0) s = s.slice(0, qIdx);
        var hIdx = s.indexOf('#');
        if (hIdx >= 0) s = s.slice(0, hIdx);
        // Ensure leading slash (sauf si vide)
        if (s && s.charAt(0) !== '/') s = '/' + s;
        return s;
    }

    // Compare 2 paths via endsWith normalise. Empeche les false positives
    // type currentPath="/super-admin.html".indexOf("/admin.html") = 6 (truthy)
    // alors qu'on ne devrait PAS matcher.
    function pathEndsWith(currentPath, candidateHref) {
        var a = normalizePath(currentPath);
        var b = normalizePath(candidateHref);
        if (!a || !b) return false;
        // Match exact OU le path se termine par "/" + candidate (force la
        // frontiere de path: /admin.html match /admin.html, /super-admin.html ne match PAS)
        return a === b || a.endsWith(b);
    }

    // Index.html : nav items identifies par leur ID DOM (xxx-tab).
    // Maas App : garde stock-alerte-tab (Audit) toujours utilise et ajoute
    // finance-tab + import-image-tab specifiques au tenant.
    var TAB_META = {
        // SAISIE
        'saisie-tab':              { icon: 'bi-pencil-square',   label: 'Saisie ventes',    group: 'Saisie' },
        'visualisation-tab':       { icon: 'bi-bar-chart',       label: 'Visualisation',    group: 'Saisie' },

        // STOCK
        'stock-inventaire-tab':    { icon: 'bi-box-seam',        label: 'Stock inventaire', group: 'Stock' },
        'copier-stock-tab':        { icon: 'bi-clipboard-data',  label: 'Copier Stock',     group: 'Stock' },
        'reconciliation-tab':      { icon: 'bi-arrow-repeat',    label: 'Reconciliation',   group: 'Stock' },
        'reconciliation-mois-tab': { icon: 'bi-calendar-month',  label: 'Recon. du mois',   group: 'Stock' },
        'stock-alerte-tab':        { icon: 'bi-exclamation-triangle', label: 'Audit',       group: 'Stock' },

        // OPERATIONS
        'cash-payment-tab':        { icon: 'bi-cash-coin',       label: 'Cash Paiement',    group: 'Operations' },
        'finance-tab':             { icon: 'bi-piggy-bank',      label: 'Finance',          group: 'Operations' },
        'suivi-achat-boeuf-tab':   { icon: 'bi-cart-check',      label: 'Suivi Achats',     group: 'Operations' },
        'estimation-tab':          { icon: 'bi-graph-up',        label: 'Estimation',       group: 'Operations' },
        'import-tab':              { icon: 'bi-upload',          label: 'Import',           group: 'Operations' },
        'import-image-tab':        { icon: 'bi-image',           label: 'Import OCR',       group: 'Operations' },
        'precommande-tab':         { icon: 'bi-bag-plus',        label: 'Precommande',      group: 'Operations' },

        // PAIEMENT (anciennement dans Operations, regroupe avec MataPay)
        'payment-links-tab':       { icon: 'bi-link-45deg',      label: 'Liens paiement',   group: 'Paiement' }
    };

    // Items "extras" ajoutes a la sidebar quand on est sur index.html.
    // Liens vers pages standalone. Maas App: Presence, Ranking, Enquete et
    // Audit Client retires (pages absentes ou non utilisees pour ce tenant).
    var EXTRA_SIDEBAR_ITEMS = [
        { key: 'matapay',        href: '/MataPay.html',        label: 'MataPay',      icon: 'bi-credit-card',    group: 'Paiement' }
    ];

    // Admin.html : nav items identifies par data-section.
    // Maas App : structure plus simple que DATA. Les anciennes sections
    // separees (api, clients-analyse, livreurs, dump-prod) sont regroupees
    // sous un seul "modules" cote Maas. ui-settings sera ajoute en Phase 3.
    var ADMIN_TAB_META = {
        'points-vente':     { icon: 'bi-shop',            label: 'Points de Vente',         group: 'Configuration' },
        'prix':             { icon: 'bi-tag',             label: 'Prix',                    group: 'Configuration' },
        'config-produits':  { icon: 'bi-box-seam',        label: 'Produits',                group: 'Configuration' },
        'stocks':           { icon: 'bi-clipboard-data',  label: 'Stocks & Transferts',     group: 'Configuration' },
        'corrections':      { icon: 'bi-wrench',          label: 'Corrections',             group: 'Configuration' },
        'abonnements':      { icon: 'bi-credit-card',     label: 'Abonnements',             group: 'Modules' },
        'modules':          { icon: 'bi-puzzle',          label: 'Modules',                 group: 'Modules' },
        'ui-settings':      { icon: 'bi-palette',         label: 'Apparence',               group: 'Systeme' }
    };

    var GROUP_ORDER = [
        'Saisie', 'Stock', 'Operations',                   // index.html (core)
        'Paiement', 'RH', 'CRM',                           // index.html (extras deplaces depuis card-header)
        'Configuration', 'Modules', 'Systeme',             // admin.html
        'Liens', 'Menu'                                     // generic fallback
    ];

    // Cross-page links speciaux : pages standalone qu'on veut quand meme voir
    // dans la sidebar (au lieu d'etre filtres comme "lien externe"). Map par
    // href -> meta. Maas App: presence/ranking/enquete/audit-client retires.
    var CROSS_PAGE_LINKS = {
        'user-management.html':   { key: 'user-management', icon: 'bi-people-fill',     label: 'Utilisateurs',  group: 'Modules' },
        '/user-management.html':  { key: 'user-management', icon: 'bi-people-fill',     label: 'Utilisateurs',  group: 'Modules' },
        // Extras index.html (anciennement card-header buttons)
        '/MataPay.html':          { key: 'matapay',         icon: 'bi-credit-card',     label: 'MataPay',       group: 'Paiement' }
    };

    // Resoud le meta d'un nav-link en testant TAB_META (id) puis ADMIN_TAB_META
    // (data-section). En dernier recours : fallback generique a partir du markup
    // (text + icone existante) — utile pour les pages futures sans avoir a
    // toucher modern-ui.js.
    function getMetaForLink(link) {
        if (link.id && TAB_META[link.id]) return { key: link.id, ...TAB_META[link.id] };
        var section = link.dataset && link.dataset.section;
        if (section && ADMIN_TAB_META[section]) return { key: section, ...ADMIN_TAB_META[section] };

        // Si le link a un ID DOM connu mais qu'il n'est dans aucune map :
        // c'est intentionnellement retire (ex: stock-alerte-tab "Audit").
        // Skip pour ne pas creer un groupe "Menu" residuel.
        if (link.id) return null;

        var href = link.getAttribute('href') || '';
        // Liens cross-page declares explicitement (ex: user-management depuis admin).
        if (CROSS_PAGE_LINKS[href]) return { ...CROSS_PAGE_LINKS[href] };

        // Fallback generique : skip si l'href pointe vers une autre page (handle
        // ailleurs par le group switcher) ou si pas de texte utile.
        if (href && href !== '#' && !href.startsWith('#')) return null;

        var text = (link.textContent || '').trim();
        if (!text) return null;

        var existingIcon = link.querySelector('i.bi, i.fas, i.fa');
        var iconClass = 'bi-dot';
        if (existingIcon) {
            var classList = (existingIcon.className || '').split(/\s+/);
            for (var i = 0; i < classList.length; i++) {
                if (classList[i].indexOf('bi-') === 0 || classList[i].indexOf('fa-') === 0) {
                    iconClass = classList[i];
                    break;
                }
            }
        }
        return {
            key: section || href || text.toLowerCase().replace(/\s+/g, '-'),
            icon: iconClass,
            label: text,
            group: 'Menu'
        };
    }

    function buildShell() {
        if (document.getElementById('mm-topbar')) return; // idempotent
        buildTopbar();

        // Pages "admin-adjacent" (user-management.html) n'ont pas leur propre
        // nav admin. On injecte un sidebar admin hard-code pour qu'elles
        // soient consultables depuis le meme menu que admin.html.
        if (isAdminAdjacentPage()) {
            buildAdminInjectedSidebar();
            wireHamburger();
            return;
        }

        // Pages "index-adjacent" (MataPay, presence, ranking, enquete,
        // auditClient) sont des pages standalone qu'on accede depuis le
        // menu de gauche. Elles recoivent une sidebar miroir d'index.
        if (isIndexAdjacentPage()) {
            buildIndexInjectedSidebar();
            wireHamburger();
            return;
        }

        var hasNav = document.querySelectorAll('ul.navbar-nav.me-auto a.nav-link').length > 0
                  || document.querySelectorAll('ul.navbar-nav:first-of-type a.nav-link').length > 0;
        if (hasNav) {
            buildSidebar();
            attachLogoutForwarder();
            wireHamburger();
        } else {
            document.documentElement.removeAttribute('data-sidebar-pos');
        }
    }

    function isAdminAdjacentPage() {
        var p = location.pathname.toLowerCase();
        return p.indexOf('/user-management.html') >= 0;
    }

    function isIndexAdjacentPage() {
        var p = location.pathname.toLowerCase();
        return /\/(matapay|presence|ranking|survey-results|auditclient)\.html$/i.test(p);
    }

    // Construction d'une sidebar pour les pages standalone (MataPay, Presence,
    // Ranking, Enquete, AuditClient). On reprend la meme liste qu'index.html
    // mais avec des liens cross-page :
    //   - Saisie / Stock / Operations  -> /index.html?tab=X
    //   - Paiement / RH / CRM          -> URL standalone
    // L'item correspondant a la page courante est marque actif.
    function buildIndexInjectedSidebar() {
        var sidebar = document.createElement('aside');
        sidebar.id = 'mm-sidebar';
        sidebar.className = 'mm-sidebar';

        var currentPath = location.pathname.toLowerCase();

        // Construire la liste a partir de TAB_META + EXTRA_SIDEBAR_ITEMS.
        var items = [];
        Object.keys(TAB_META).forEach(function (tabId) {
            var m = TAB_META[tabId];
            items.push({
                href: '/index.html?tab=' + encodeURIComponent(tabId),
                label: m.label,
                icon: m.icon,
                group: m.group,
                key: tabId
            });
        });
        EXTRA_SIDEBAR_ITEMS.forEach(function (it) { items.push(it); });

        // Group + render
        var groups = {};
        items.forEach(function (it) {
            if (!groups[it.group]) groups[it.group] = [];
            groups[it.group].push(it);
        });

        GROUP_ORDER.forEach(function (groupName) {
            var groupItems = groups[groupName];
            if (!groupItems || !groupItems.length) return;

            var groupDiv = document.createElement('div');
            groupDiv.className = 'mm-nav-group';
            var label = document.createElement('div');
            label.className = 'mm-nav-label';
            label.textContent = groupName;
            groupDiv.appendChild(label);

            groupItems.forEach(function (it) {
                var link = document.createElement('a');
                link.href = it.href;
                link.className = 'mm-nav-link';
                link.title = it.label;
                link.innerHTML = '<i class="bi ' + it.icon + '"></i><span class="mm-nav-text">' + escapeHtml(it.label) + '</span>';

                // Active si la page courante matche EXACTEMENT l'href (pour les
                // liens standalone). Pour les liens index?tab=X on ne peut pas
                // matcher facilement, donc on ne marque pas actif.
                // endsWith (vs indexOf) evite les false positives type
                // /super-admin.html qui contiendrait '/admin.html'.
                if (it.href && !it.href.startsWith('/index.html') && pathEndsWith(currentPath, it.href)) {
                    link.classList.add('active');
                }

                groupDiv.appendChild(link);
            });
            sidebar.appendChild(groupDiv);
        });

        var footer = document.createElement('div');
        footer.className = 'mm-sidebar-footer';
        footer.innerHTML = '<div style="text-align:center">Mode Moderne · beta</div>';
        sidebar.appendChild(footer);

        document.body.appendChild(sidebar);
    }

    // Items admin hard-codes pour les pages admin-adjacent. Chaque item
    // pointe vers /admin.html?section=X, sauf l'item "Utilisateurs" qui
    // pointe vers user-management.html (auto-actif si on est dessus).
    function getAdminInjectedItems() {
        return [
            // Configuration
            { section: 'points-vente',     label: 'Points de Vente',         icon: 'bi-shop',            group: 'Configuration' },
            { section: 'prix',             label: 'Prix',                    icon: 'bi-tag',             group: 'Configuration' },
            { section: 'config-produits',  label: 'Produits',                icon: 'bi-box-seam',        group: 'Configuration' },
            { section: 'stocks',           label: 'Stocks & Transferts',     icon: 'bi-clipboard-data',  group: 'Configuration' },
            { section: 'corrections',      label: 'Corrections',             icon: 'bi-wrench',          group: 'Configuration' },
            // Modules
            { section: 'abonnements',      label: 'Abonnements',             icon: 'bi-credit-card',     group: 'Modules' },
            { section: 'api',              label: 'API External',            icon: 'bi-code-slash',      group: 'Modules' },
            { section: 'clients-analyse',  label: 'Analyse Clients',         icon: 'bi-people',          group: 'Modules' },
            { section: 'livreurs',         label: 'Livreurs',                icon: 'bi-truck',           group: 'Modules' },
            { href: '/user-management.html', label: 'Utilisateurs',          icon: 'bi-people-fill',     group: 'Modules' },
            // Systeme
            { section: 'dump-prod',        label: 'Dump Prod',               icon: 'bi-database',        group: 'Systeme' },
            { section: 'ui-settings',      label: 'Apparence',               icon: 'bi-palette',         group: 'Systeme' }
        ];
    }

    function buildAdminInjectedSidebar() {
        var sidebar = document.createElement('aside');
        sidebar.id = 'mm-sidebar';
        sidebar.className = 'mm-sidebar';

        var currentPath = location.pathname.toLowerCase();
        var items = getAdminInjectedItems();
        var groups = {};
        items.forEach(function (it) {
            if (!groups[it.group]) groups[it.group] = [];
            groups[it.group].push(it);
        });

        ['Configuration', 'Modules', 'Systeme'].forEach(function (groupName) {
            var groupItems = groups[groupName];
            if (!groupItems || !groupItems.length) return;

            var groupDiv = document.createElement('div');
            groupDiv.className = 'mm-nav-group';
            var label = document.createElement('div');
            label.className = 'mm-nav-label';
            label.textContent = groupName;
            groupDiv.appendChild(label);

            groupItems.forEach(function (it) {
                var link = document.createElement('a');
                var href = it.href || ('/admin.html?section=' + it.section);
                link.href = href;
                link.className = 'mm-nav-link';
                link.title = it.label;
                link.innerHTML = '<i class="bi ' + it.icon + '"></i><span class="mm-nav-text">' + escapeHtml(it.label) + '</span>';

                // Active si on est EXACTEMENT sur la page cible (endsWith
                // normalisee — evite /super-admin matching /admin etc.)
                var isCurrent = it.href && pathEndsWith(currentPath, it.href);
                if (isCurrent) link.classList.add('active');

                groupDiv.appendChild(link);
            });
            sidebar.appendChild(groupDiv);
        });

        var footer = document.createElement('div');
        footer.className = 'mm-sidebar-footer';
        footer.innerHTML = '<div style="text-align:center">Mode Moderne · beta</div>';
        sidebar.appendChild(footer);

        document.body.appendChild(sidebar);
    }

    function buildTopbar() {
        var topbar = document.createElement('div');
        topbar.id = 'mm-topbar';
        topbar.className = 'mm-topbar';

        var userInfoSpan = document.getElementById('user-info');
        var userText = userInfoSpan ? userInfoSpan.textContent.trim() : '';
        var parsed = parseUserText(userText);

        // Si pas de user-info dans le DOM (pages standalone : MataPay,
        // presence, ranking, etc.), on remplit le user-chip apres
        // construction via /api/check-session — sinon il afficherait
        // generique "User / U".
        var needsAsyncUserFetch = !userText;

        var hasNav = document.querySelectorAll('.navbar-nav a.nav-link').length > 0;

        topbar.innerHTML =
            '<div class="mm-topbar-left">' +
                (hasNav
                    ? '<button class="mm-hamburger" id="mm-hamburger" aria-label="Replier/deplier la sidebar" title="Replier la sidebar">' +
                        '<i class="bi bi-list"></i>' +
                      '</button>'
                    : '') +
                '<div class="mm-brand">' +
                    '<div class="mm-logo" aria-hidden="true">M</div>' +
                    '<div class="mm-brand-name">Matix <span class="mm-brand-sub">· Boucherie</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="mm-topbar-right">' +
                (parsed.tenant ? '<span class="mm-tenant"><i class="bi bi-shop"></i> ' + escapeHtml(parsed.tenant) + '</span>' : '') +
                '<div class="mm-group-switcher" id="mm-group-switcher">' +
                    '<button class="mm-group-btn" id="mm-group-btn" aria-haspopup="true" aria-expanded="false">' +
                        '<i class="bi bi-grid-3x3-gap-fill"></i>' +
                        '<span class="mm-group-label" id="mm-group-label">Gestion</span>' +
                        '<i class="bi bi-chevron-down" style="font-size:11px;opacity:0.6"></i>' +
                    '</button>' +
                    '<div class="mm-group-menu" id="mm-group-menu" role="menu"></div>' +
                '</div>' +
                '<button class="mm-theme-toggle" id="mm-theme-toggle" title="Basculer le theme (clair/sombre)" aria-label="Basculer le theme">' +
                    '<i class="bi bi-sun-fill"></i>' +
                    '<i class="bi bi-moon-stars-fill"></i>' +
                '</button>' +
                '<button class="mm-icon-btn" id="mm-refresh-btn" title="Rafraichir les donnees" aria-label="Rafraichir">' +
                    '<i class="bi bi-arrow-clockwise"></i>' +
                '</button>' +
                '<div class="mm-user-wrap" style="position:relative">' +
                    '<a href="#" class="mm-user-chip" id="mm-user-chip" aria-haspopup="true" aria-expanded="false">' +
                        '<span class="mm-user-avatar">' + escapeHtml(parsed.initials) + '</span>' +
                        '<div>' +
                            '<div class="mm-user-name">' + escapeHtml(parsed.name) + '</div>' +
                            (parsed.role ? '<div class="mm-user-role">' + escapeHtml(parsed.role) + '</div>' : '') +
                        '</div>' +
                        '<i class="bi bi-chevron-down" style="font-size:11px;opacity:0.55;margin-left:4px"></i>' +
                    '</a>' +
                    '<div class="mm-user-menu" id="mm-user-menu" role="menu">' +
                        '<a class="mm-user-menu-item" id="mm-logout-btn" href="#" role="menuitem">' +
                            '<i class="bi bi-box-arrow-right"></i>' +
                            '<span>Se deconnecter</span>' +
                        '</a>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.insertBefore(topbar, document.body.firstChild);

        // Refresh button forwarder
        var origRefresh = document.getElementById('refresh-cache-btn');
        var mmRefresh = document.getElementById('mm-refresh-btn');
        if (mmRefresh) {
            mmRefresh.addEventListener('click', function () {
                if (origRefresh) origRefresh.click();
                else if (window.appCache && typeof window.appCache.invalidateAll === 'function') {
                    window.appCache.invalidateAll();
                    location.reload();
                } else {
                    location.reload();
                }
            });
        }

        // User chip dropdown : toggle visibilite du menu personnel.
        var mmUserChip = document.getElementById('mm-user-chip');
        var mmUserMenu = document.getElementById('mm-user-menu');
        if (mmUserChip && mmUserMenu) {
            mmUserChip.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var expanded = mmUserChip.getAttribute('aria-expanded') === 'true';
                mmUserChip.setAttribute('aria-expanded', String(!expanded));
                mmUserMenu.style.display = expanded ? 'none' : 'block';
            });
            // Click outside ferme le menu
            document.addEventListener('click', function (e) {
                if (!mmUserMenu.contains(e.target) && !mmUserChip.contains(e.target)) {
                    mmUserMenu.style.display = 'none';
                    mmUserChip.setAttribute('aria-expanded', 'false');
                }
            });
        }
        // Logout : utilise le bouton original si dispo (declenche les handlers
        // existants comme nettoyage de cache), sinon appel direct /api/logout.
        var mmLogoutBtn = document.getElementById('mm-logout-btn');
        if (mmLogoutBtn) {
            mmLogoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var origLogout = document.getElementById('logout-btn');
                if (origLogout) {
                    origLogout.click();
                } else {
                    // Fallback direct sur l'API
                    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
                        .then(function () { location.href = '/login.html'; })
                        .catch(function () { location.href = '/login.html'; });
                }
            });
        }

        wireGroupSwitcher();
        wireThemeToggle();

        // Pages standalone : remplit le user-chip avec les vraies infos
        // depuis /api/check-session (sinon il afficherait "User / U").
        if (needsAsyncUserFetch) {
            fetchCurrentUser().then(function (user) {
                if (!user) return;
                var roleLabel = (user.role || '').toString();
                // Capitalise le role pour l'affichage (admin -> Admin)
                if (roleLabel) {
                    roleLabel = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);
                }
                var name = user.username || 'User';
                var initialsParts = name.split(/\s+/);
                var initials = (initialsParts[0][0] || 'U').toUpperCase() +
                    (initialsParts.length > 1 ? (initialsParts[initialsParts.length-1][0] || '').toUpperCase() : '');

                var nameEl = topbar.querySelector('.mm-user-name');
                var roleEl = topbar.querySelector('.mm-user-role');
                var avatarEl = topbar.querySelector('.mm-user-avatar');
                if (nameEl) nameEl.textContent = name;
                if (avatarEl) avatarEl.textContent = initials;
                if (roleEl) {
                    roleEl.textContent = roleLabel;
                    roleEl.style.display = roleLabel ? '' : 'none';
                } else if (roleLabel) {
                    // Le chip a ete construit sans role-div, on en ajoute un.
                    var nameContainer = nameEl && nameEl.parentElement;
                    if (nameContainer) {
                        var newRole = document.createElement('div');
                        newRole.className = 'mm-user-role';
                        newRole.textContent = roleLabel;
                        nameContainer.appendChild(newRole);
                    }
                }
            });
        }
    }

    function wireHamburger() {
        var btn = document.getElementById('mm-hamburger');
        if (!btn) return;

        var isMobile = function () {
            return window.matchMedia('(max-width: 991.98px)').matches;
        };

        btn.addEventListener('click', function () {
            var html = document.documentElement;
            if (isMobile()) {
                // Mobile : toggle drawer slide-in via data-sidebar-open.
                // Pas de localStorage : par defaut ferme a chaque page (UX
                // standard mobile drawer).
                var isOpen = html.getAttribute('data-sidebar-open') === 'true';
                if (isOpen) {
                    html.removeAttribute('data-sidebar-open');
                    btn.title = 'Ouvrir le menu';
                } else {
                    html.setAttribute('data-sidebar-open', 'true');
                    btn.title = 'Fermer le menu';
                }
            } else {
                // Desktop : toggle data-sidebar-collapsed (logique existante).
                var isCollapsed = html.getAttribute('data-sidebar-collapsed') === 'true';
                if (isCollapsed) {
                    html.removeAttribute('data-sidebar-collapsed');
                    localStorage.removeItem('matix_sidebar_collapsed');
                    btn.querySelector('i').className = 'bi bi-list';
                    btn.title = 'Replier la sidebar';
                } else {
                    html.setAttribute('data-sidebar-collapsed', 'true');
                    localStorage.setItem('matix_sidebar_collapsed', '1');
                    btn.querySelector('i').className = 'bi bi-layout-sidebar-inset';
                    btn.title = 'Deplier la sidebar';
                }
            }
        });

        // Set initial icon based on desktop state.
        if (document.documentElement.getAttribute('data-sidebar-collapsed') === 'true') {
            btn.querySelector('i').className = 'bi bi-layout-sidebar-inset';
            btn.title = 'Deplier la sidebar';
        }

        // Mobile : fermer le drawer en cliquant sur le scrim OU sur un
        // nav-link (UX standard : on navigue puis on ferme le menu).
        document.addEventListener('click', function (e) {
            if (!isMobile()) return;
            var html = document.documentElement;
            if (html.getAttribute('data-sidebar-open') !== 'true') return;
            var sidebar = document.getElementById('mm-sidebar');
            if (!sidebar) return;
            // Click sur le hamburger lui-meme : laisser le handler de toggle gerer
            if (btn.contains(e.target)) return;
            // Click sur un nav-link DANS la sidebar : ferme le drawer apres navigation
            var insideNavLink = sidebar.contains(e.target) && e.target.closest('.mm-nav-link');
            if (insideNavLink) {
                html.removeAttribute('data-sidebar-open');
                return;
            }
            // Click hors sidebar (scrim) : ferme le drawer
            if (!sidebar.contains(e.target)) {
                html.removeAttribute('data-sidebar-open');
            }
        });

        // Resize : si on revient en desktop, retire l'etat mobile-open
        // (sinon il pourrait rester suspendu).
        window.addEventListener('resize', function () {
            if (!isMobile()) {
                document.documentElement.removeAttribute('data-sidebar-open');
            }
        });
    }

    // Cycle le theme : light -> dark -> light (auto reste accessible via
    // /admin > Apparence). Persiste dans localStorage. Met a jour Chart.js
    // si present.
    function wireThemeToggle() {
        var btn = document.getElementById('mm-theme-toggle');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var current = document.documentElement.getAttribute('data-ui-theme') || 'auto';
            // Si 'auto' : detecte l'effectif courant et bascule a l'oppose.
            var effective = current;
            if (current === 'auto') {
                effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            var next = (effective === 'dark') ? 'light' : 'dark';
            applyTheme(next);
        });
        // Apply theme initially au cas ou Chart.js etait pas pret en Phase 1
        applyChartTheme(getEffectiveTheme());
    }

    function applyTheme(theme) {
        if (['auto', 'light', 'dark'].indexOf(theme) < 0) theme = 'auto';
        document.documentElement.setAttribute('data-ui-theme', theme);
        localStorage.setItem('matix_ui_theme', theme);
        applyChartTheme(getEffectiveTheme());
    }

    function getEffectiveTheme() {
        var t = document.documentElement.getAttribute('data-ui-theme') || 'auto';
        if (t === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return t;
    }

    // Applique le theme dark aux defaults Chart.js + re-render les charts
    // existants. Defensif : ne fait rien si Chart pas charge.
    function applyChartTheme(effectiveTheme) {
        if (typeof window.Chart === 'undefined') return;
        var isDark = effectiveTheme === 'dark';
        try {
            window.Chart.defaults.color = isDark ? '#94A3B8' : '#64748B';
            window.Chart.defaults.borderColor = isDark ? '#334155' : '#E2E8F0';
            if (window.Chart.defaults.scale && window.Chart.defaults.scale.grid) {
                window.Chart.defaults.scale.grid.color = isDark ? '#334155' : '#E2E8F0';
            }
            if (window.Chart.defaults.plugins && window.Chart.defaults.plugins.tooltip) {
                window.Chart.defaults.plugins.tooltip.backgroundColor = isDark ? '#1E293B' : '#0F172A';
            }
            // Re-render charts existants (defensive vs versions Chart.js variees):
            //  - v2/v3: window.Chart.instances est un objet {id:chart}
            //  - v4: window.Chart.registry.getRegistered est une FONCTION
            //  - certains builds: registry direct (rare)
            var instances = window.Chart.instances;
            if (!instances && window.Chart.registry) {
                var reg = window.Chart.registry;
                if (typeof reg.getRegistered === 'function') {
                    instances = reg.getRegistered();
                } else {
                    instances = reg; // fallback
                }
            }
            if (instances) {
                var list = null;
                if (Array.isArray(instances)) {
                    list = instances;
                } else if (typeof instances === 'object') {
                    list = Object.values(instances);
                }
                if (list && list.forEach) {
                    list.forEach(function (c) {
                        if (c && typeof c.update === 'function') c.update('none');
                    });
                }
            }
        } catch (e) {
            console.warn('[modern-ui] applyChartTheme erreur :', e && e.message);
        }
    }

    // Listen prefers-color-scheme changes pour le mode auto.
    if (window.matchMedia) {
        try {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            var onChange = function () {
                if (document.documentElement.getAttribute('data-ui-theme') === 'auto') {
                    applyChartTheme(getEffectiveTheme());
                }
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);  // Safari < 14
        } catch (e) {}
    }

    function wireGroupSwitcher() {
        var btn = document.getElementById('mm-group-btn');
        var menu = document.getElementById('mm-group-menu');
        var label = document.getElementById('mm-group-label');
        if (!btn || !menu) return;

        // Detection du groupe courant base sur pathname.
        var path = location.pathname.toLowerCase();
        var currentGroup = 'gestion';
        if (path.indexOf('/pos.html') >= 0) currentGroup = 'caisse';
        else if (path.indexOf('/admin.html') >= 0 || path.indexOf('/user-management.html') >= 0) currentGroup = 'administration';
        label.textContent = currentGroup === 'caisse' ? 'Caisse'
                          : currentGroup === 'administration' ? 'Administration'
                          : 'Gestion';

        // Construction du menu avec filtrage par role.
        fetchCurrentUser().then(function (user) {
            var role = user ? String(user.role || '').toLowerCase() : '';
            var isAdmin = user && (user.isAdmin === true || user.isSuperAdmin === true
                || role === 'admin' || role === 'superviseur' || role === 'superutilisateur');

            var groups = [
                { id: 'caisse',         label: 'Caisse',         icon: 'bi-receipt-cutoff', href: '/pos.html',    visible: true },
                { id: 'gestion',        label: 'Gestion',        icon: 'bi-clipboard-data', href: '/index.html',  visible: true },
                { id: 'administration', label: 'Administration', icon: 'bi-gear-fill',      href: '/admin.html',  visible: isAdmin }
            ];

            menu.innerHTML = groups.filter(function (g) { return g.visible; }).map(function (g) {
                var active = g.id === currentGroup ? ' active' : '';
                return '<a class="mm-group-item' + active + '" role="menuitem" href="' + g.href + '">' +
                       '<i class="bi ' + g.icon + '"></i>' +
                       '<span>' + escapeHtml(g.label) + '</span>' +
                       (active ? '<i class="bi bi-check2" style="margin-left:auto;color:var(--mm-red-700)"></i>' : '') +
                       '</a>';
            }).join('');
        });

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var expanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!expanded));
            menu.style.display = expanded ? 'none' : 'block';
        });

        document.addEventListener('click', function (e) {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                menu.style.display = 'none';
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function parseUserText(text) {
        var out = { name: text || 'User', role: '', tenant: '', initials: 'U' };
        if (!text) return out;
        var m = text.match(/^(.+?)\s*\((.+)\)\s*$/);
        if (m) {
            out.name = m[1].trim();
            out.role = m[2].trim();
        }
        var parts = out.name.split(/\s+/);
        out.initials = (parts[0][0] || 'U').toUpperCase() + (parts.length > 1 ? (parts[parts.length-1][0] || '').toUpperCase() : '');
        return out;
    }

    function buildSidebar() {
        var sidebar = document.createElement('aside');
        sidebar.id = 'mm-sidebar';
        sidebar.className = 'mm-sidebar';

        // Cible uniquement la nav PRIMARY (gauche du Bootstrap navbar) — pas
        // la nav-end qui contient Caisse / refresh / user-chip, deja gerees
        // par le topbar + group switcher.
        var originalLinks = document.querySelectorAll('ul.navbar-nav.me-auto a.nav-link');
        if (originalLinks.length === 0) {
            // Fallback si la classe me-auto n'est pas presente : prend la 1ere ul.
            originalLinks = document.querySelectorAll('ul.navbar-nav:first-of-type a.nav-link');
        }

        var groups = {};

        Array.prototype.forEach.call(originalLinks, function (link) {
            var li = link.closest('li.nav-item');
            var meta = getMetaForLink(link);
            if (!meta) return; // skip liens externes / non identifiables

            // Note la visibilite courante du li parent. Si l'admin.js rend l'item
            // visible plus tard (role-based show), le MutationObserver synchronise.
            var hidden = !!(li && (
                getComputedStyle(li).display === 'none' ||
                li.style.display === 'none'
            ));

            if (!groups[meta.group]) groups[meta.group] = [];
            groups[meta.group].push({ link: link, meta: meta, hidden: hidden, li: li });
        });

        // Ajoute les items "extras" (MataPay, Presence, Ranking, Enquete,
        // Audit Client) — anciennement boutons card-header de Saisie,
        // maintenant dans la sidebar pour declutterer la card-header.
        EXTRA_SIDEBAR_ITEMS.forEach(function (extra) {
            var srcEl = extra.srcId ? document.getElementById(extra.srcId) : null;
            var hidden = false;
            if (srcEl) {
                hidden = (srcEl.style.display === 'none' ||
                          getComputedStyle(srcEl).display === 'none');
            }
            if (!groups[extra.group]) groups[extra.group] = [];
            groups[extra.group].push({
                link: null,           // pas de DOM source (lien externe direct)
                extra: extra,         // pour le render handler
                meta: { key: extra.key, icon: extra.icon, label: extra.label, group: extra.group },
                hidden: hidden,
                li: srcEl
            });
        });

        // Render groups dans l'ordre defini. Les groupes inconnus tombent
        // a la fin (ordre d'insertion preserve par defaut).
        var renderedGroups = new Set();
        GROUP_ORDER.forEach(function (groupName) {
            renderGroup(sidebar, groupName, groups[groupName]);
            renderedGroups.add(groupName);
        });
        Object.keys(groups).forEach(function (groupName) {
            if (renderedGroups.has(groupName)) return;
            renderGroup(sidebar, groupName, groups[groupName]);
        });

        var footer = document.createElement('div');
        footer.className = 'mm-sidebar-footer';
        footer.innerHTML = '<div style="text-align:center">Mode Moderne · beta</div>';
        sidebar.appendChild(footer);

        document.body.appendChild(sidebar);
    }

    function renderGroup(sidebar, groupName, items) {
        if (!items || items.length === 0) return;

        var groupDiv = document.createElement('div');
        groupDiv.className = 'mm-nav-group';
        var label = document.createElement('div');
        label.className = 'mm-nav-label';
        label.textContent = groupName;
        groupDiv.appendChild(label);

        items.forEach(function (item) {
            var mirror = document.createElement('a');
            mirror.className = 'mm-nav-link';
            mirror.dataset.targetKey = item.meta.key;
            mirror.title = item.meta.label;
            mirror.innerHTML =
                '<i class="bi ' + item.meta.icon + '"></i>' +
                '<span class="mm-nav-text">' + escapeHtml(item.meta.label) + '</span>';

            // Items "extras" : lien direct (navigation cross-page).
            // Items "mirror" : pointe vers l'onglet original via click().
            if (item.extra && item.extra.href) {
                mirror.href = item.extra.href;
                // Pas de preventDefault — laisse le navigateur naviguer.
            } else if (item.link) {
                mirror.href = '#';
                if (item.link.classList.contains('active')) {
                    mirror.classList.add('active');
                }
                mirror.addEventListener('click', function (e) {
                    e.preventDefault();
                    item.link.click();
                    sidebar.querySelectorAll('.mm-nav-link').forEach(function (l) {
                        l.classList.remove('active');
                    });
                    mirror.classList.add('active');
                });
            } else {
                mirror.href = '#';
            }
            if (item.hidden) mirror.style.display = 'none';

            // Sync visibility quand l'item original change (role-based reveal).
            // Triple defense :
            //   1) MutationObserver (catch les futures mutations)
            //   2) Check immediat (au cas ou la mutation a deja eu lieu entre
            //      le capture de "hidden" et ici — pas de race possible en JS
            //      single-thread mais safe pour les futurs refactors)
            //   3) Polling 500ms pendant 5s (belt-and-suspenders au cas ou
            //      script.js modifie la visibilite via un mecanisme qui
            //      n'emet pas une mutation attribute trackable — ex.
            //      classList.add/remove avec une classe display:none).
            if (item.li) {
                var syncVisibility = function () {
                    var stillHidden = (
                        item.li.style.display === 'none' ||
                        getComputedStyle(item.li).display === 'none'
                    );
                    mirror.style.display = stillHidden ? 'none' : '';
                };
                if (typeof MutationObserver !== 'undefined') {
                    var obs = new MutationObserver(syncVisibility);
                    obs.observe(item.li, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
                }
                syncVisibility();
                // Poll pour 5 secondes max : couvre les fetchs auth tres lents
                // (login froid + API lente). Arret automatique apres.
                var pollCount = 0;
                var pollId = setInterval(function () {
                    syncVisibility();
                    if (++pollCount >= 10) clearInterval(pollId);
                }, 500);
            }

            groupDiv.appendChild(mirror);
        });

        sidebar.appendChild(groupDiv);
    }

    function attachLogoutForwarder() {
        // Synchronise l'etat actif quand l'utilisateur clique sur un onglet
        // de la navbar originale (cas rare : keyboard, lien direct).
        var links = document.querySelectorAll('ul.navbar-nav.me-auto a.nav-link');
        Array.prototype.forEach.call(links, function (link) {
            link.addEventListener('click', function () {
                var sidebar = document.getElementById('mm-sidebar');
                if (!sidebar) return;
                var meta = getMetaForLink(link);
                if (!meta) return;
                sidebar.querySelectorAll('.mm-nav-link').forEach(function (l) {
                    l.classList.toggle('active', l.dataset.targetKey === meta.key);
                });
            });
        });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MatixUI = {
        getSettings: fetchSettings,
        invalidateCache: function () { localStorage.removeItem('matix_ui_settings'); },
        forceMode: function (mode, pos) {
            localStorage.setItem('matix_ui_settings', JSON.stringify({
                newUiEnabled: mode === 'modern',
                sidebarPosition: pos === 'left' ? 'left' : 'right'
            }));
            location.reload();
        },
        applyTheme: applyTheme,
        getEffectiveTheme: getEffectiveTheme,
        applyChartTheme: applyChartTheme
    };
})();
