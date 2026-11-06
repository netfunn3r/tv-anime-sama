/* Anime-Sama sur téléviseur : bloque les fenêtres de pub et permet de naviguer à la télécommande.
   TizenBrew injecte ce script dans chaque cadre de la page, lecteurs vidéo compris. */
(function () {
  'use strict';
  if (window.__animeSamaTV || typeof HTMLAnchorElement === 'undefined') return;
  window.__animeSamaTV = true;

  var enHaut = window.top === window.self;

  function verrouiller(objet, nom, valeur) {
    try {
      Object.defineProperty(objet, nom, { value: valeur, writable: false, configurable: false });
    } catch (e) {
      try { objet[nom] = valeur; } catch (e2) { /* propriété protégée : on laisse */ }
    }
  }

  /* ---------- Fenêtres de pub : dans tous les cadres ---------- */

  function fausseFenetre() {
    var rien = function () {};
    return {
      closed: true, close: rien, focus: rien, blur: rien, postMessage: rien,
      location: { href: '', replace: rien, assign: rien },
      document: { write: rien, writeln: rien, close: rien, open: rien }
    };
  }
  var ouvrir = function () { return fausseFenetre(); };
  verrouiller(window, 'open', ouvrir);

  // Une pub peut passer par un cadre tout neuf, dont window.open n'est pas encore neutralisé.
  var descFenetre = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  var lireFenetre = descFenetre && descFenetre.get;

  function neutraliser(cadre) {
    try {
      var w = lireFenetre ? lireFenetre.call(cadre) : cadre.contentWindow;
      if (w && w.open !== ouvrir) verrouiller(w, 'open', ouvrir);
    } catch (e) { /* cadre d'un autre site : le script y est injecté à part */ }
  }

  if (lireFenetre) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      enumerable: true,
      get: function () { neutraliser(this); return lireFenetre.call(this); }
    });
  }

  function surveillerAjouts(proto, nom) {
    var origine = proto[nom];
    if (!origine) return;
    proto[nom] = function () {
      var resultat = origine.apply(this, arguments);
      for (var i = 0; i < arguments.length; i++) {
        var n = arguments[i];
        if (n && n.tagName === 'IFRAME') neutraliser(n);
      }
      return resultat;
    };
  }
  surveillerAjouts(Node.prototype, 'appendChild');
  surveillerAjouts(Node.prototype, 'insertBefore');
  surveillerAjouts(Element.prototype, 'append');
  surveillerAjouts(Element.prototype, 'prepend');

  function memeSite(url) {
    try { return new URL(url, location.href).hostname === location.hostname; } catch (e) { return false; }
  }

  // Vrai quand le lien sortirait de la page : la pub passe souvent par un lien cliqué par script.
  function lienInterdit(a) {
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return false;
    return !memeSite(href);
  }

  function ouvertureAilleurs(a) {
    var cible = (a.getAttribute('target') || '').toLowerCase();
    return cible && cible !== '_self';
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    if (lienInterdit(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (ouvertureAilleurs(a)) {
      e.preventDefault();
      location.href = a.href;
    }
  }, true);

  // Un lien hors de la page peut être cliqué par script sans passer par le document.
  var envoyerEvenement = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement && lienInterdit(this)) return false;
    return envoyerEvenement.call(this, ev);
  };

  var clicLien = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (lienInterdit(this)) return;
    if (ouvertureAilleurs(this)) { location.href = this.href; return; }
    return clicLien.apply(this, arguments);
  };

  var envoiFormulaire = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (this.target && this.target !== '_self') return;
    return envoiFormulaire.apply(this, arguments);
  };

  /* ---------- Lecteur JW sur téléviseur ---------- */

  // Au premier clic, JW recharge la vidéo. Le flux hls.js déjà attaché devient alors invalide
  // (Format error) et le lecteur charge sans fin : on ignore ce rechargement-là.
  var chargerMedia = HTMLMediaElement.prototype.load;
  HTMLMediaElement.prototype.load = function () {
    var src = this.getAttribute('src') || '';
    if (src.indexOf('blob:') === 0 && this.readyState > 0) return;
    return chargerMedia.apply(this, arguments);
  };

  /* ---------- Clics et lecture transmis par la page principale ---------- */

  function declencher(el, type, x, y) {
    var C = /^pointer/.test(type) && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
  }

  function cliquerSur(el, x, y) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) { declencher(el, t, x, y); });
  }

  function trouverVideo() {
    var videos = document.getElementsByTagName('video');
    return videos.length ? videos[0] : null;
  }

  function lancerLecteur() {
    try { if (window.jwplayer) { window.jwplayer().play(); return true; } } catch (e) { /* autre lecteur */ }
    var v = trouverVideo();
    if (v && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); return true; }
    return false;
  }

  function verscadres(message) {
    var cadres = document.getElementsByTagName('iframe');
    for (var i = 0; i < cadres.length; i++) {
      try { cadres[i].contentWindow.postMessage(message, '*'); } catch (e) { /* cadre fermé */ }
    }
  }

  function commandeMedia(action) {
    var v = trouverVideo();
    if (!v) { verscadres({ asTv: 'media', action: action }); return; }
    if (action === 'basculer') {
      if (v.paused) lancerLecteur(); else v.pause();
    } else if (action === 'lecture') {
      lancerLecteur();
    } else if (action === 'pause') {
      v.pause();
    } else if (action === 'avance') {
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
    } else if (action === 'recul') {
      v.currentTime = Math.max(0, v.currentTime - 10);
    }
  }

  function clicAuPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return;
    if (el.tagName === 'IFRAME') {
      var r = el.getBoundingClientRect();
      try { el.contentWindow.postMessage({ asTv: 'clic', x: x - r.left, y: y - r.top }, '*'); } catch (e) { /* cadre fermé */ }
      return;
    }
    cliquerSur(el, x, y);
    return el;
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object' || !m.asTv) return;
    if (m.asTv === 'clic') {
      clicAuPoint(m.x, m.y);
      // Une pub transparente peut couvrir le lecteur : on le relance directement.
      setTimeout(lancerLecteur, 300);
    } else if (m.asTv === 'media') {
      commandeMedia(m.action);
    }
  });

  // Une fois le lecteur activé, les touches arrivent dans son cadre : on les renvoie à la page principale.
  if (!enHaut) {
    var RELAYEES = { 13: 1, 27: 1, 37: 1, 38: 1, 39: 1, 40: 1, 19: 1, 412: 1, 415: 1, 417: 1, 10009: 1, 10252: 1 };
    var relayer = function (sensTouche) {
      return function (e) {
        var el = document.activeElement;
        if (!RELAYEES[e.keyCode] || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.top.postMessage({ asTv: 'touche', sens: sensTouche, code: e.keyCode, repetition: e.repeat }, '*');
      };
    };
    window.addEventListener('keydown', relayer('bas'), true);
    window.addEventListener('keyup', relayer('haut'), true);
    return;
  }

  /* ---------- Page principale : pubs du site ---------- */

  // Une pub a réussi à remplacer toute la page : on revient en arrière.
  if (/^https?:$/.test(location.protocol) && !/(^|\.)anime-sama\./.test(location.hostname) &&
      !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    history.back();
    return;
  }

  var inerte = function () {};
  verrouiller(window, 'aclib', new Proxy(inerte, { get: function () { return inerte; } }));

  var STYLE =
    '.ad-container,.ad-content,.ad-label,[data-zone],ins.adsbygoogle{display:none!important}' +
    '#as-info{position:fixed;left:50%;bottom:8vh;transform:translateX(-50%);padding:14px 30px;font-size:30px;font-weight:700;color:#fff;' +
    'background:rgba(0,0,0,.75);border-radius:12px;z-index:2147483647;pointer-events:none}' +
    '#as-curseur{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;' +
    'background:#fff;border:4px solid #2563eb;pointer-events:none;z-index:2147483647;will-change:transform}' +
    '#as-curseur.discret{opacity:0}' +
    '#as-plein{display:block;margin:12px auto;padding:14px 28px;font-size:22px;font-weight:700;color:#fff;' +
    'background:#2563eb;border:0;border-radius:10px}' +
    '#playerDF.as-plein{position:fixed!important;left:0!important;top:0!important;width:100vw!important;' +
    'height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483000!important;background:#000}' +
    '#as-liste{position:fixed;left:50%;top:6vh;bottom:6vh;width:520px;margin-left:-260px;overflow:hidden;' +
    'background:#111827;border:2px solid #2563eb;border-radius:14px;z-index:2147483646;padding:8px}' +
    '#as-liste div{padding:12px 18px;font-size:22px;color:#e5e7eb;border-radius:8px;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis}' +
    '#as-liste div.choisi{background:#2563eb;color:#fff}';

  function preparerPage() {
    if (!document.getElementById('as-style') && document.head) {
      var s = document.createElement('style');
      s.id = 'as-style';
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    ajouterPleinEcran();
    if (document.body && !document.getElementById('as-curseur')) {
      if (!cx || !cy) {
        cx = Math.round(window.innerWidth / 2);
        cy = Math.round(window.innerHeight / 2);
      }
      document.body.appendChild(curseur);
      placerCurseur();
    }
  }

  function ajouterPleinEcran() {
    var cadre = document.getElementById('playerDF');
    if (!cadre || document.getElementById('as-plein') || !cadre.parentNode) return;
    var b = document.createElement('button');
    b.id = 'as-plein';
    b.type = 'button';
    b.textContent = 'Plein écran';
    b.addEventListener('click', basculerPlein);
    cadre.parentNode.insertBefore(b, cadre);
  }

  function basculerPlein() {
    var cadre = document.getElementById('playerDF');
    if (!cadre) return;
    var actif = cadre.classList.toggle('as-plein');
    curseur.classList.toggle('discret', actif);
  }

  var delaiInfo = null;
  function signaler(texte) {
    var info = document.getElementById('as-info');
    if (!info) {
      info = document.createElement('div');
      info.id = 'as-info';
      document.body.appendChild(info);
    }
    info.textContent = texte;
    info.style.display = 'block';
    clearTimeout(delaiInfo);
    delaiInfo = setTimeout(function () { info.style.display = 'none'; }, 900);
  }

  // En plein écran, les flèches gauche et droite avancent ou reculent de 10 secondes.
  var dernierSaut = 0;
  function toucheEnPlein(code) {
    if (code !== 37 && code !== 39) return;
    var maintenant = Date.now();
    if (maintenant - dernierSaut < 350) return;
    dernierSaut = maintenant;
    commandeMedia(code === 37 ? 'recul' : 'avance');
    signaler(code === 37 ? '- 10 s' : '+ 10 s');
  }

  function pleinActif() {
    var cadre = document.getElementById('playerDF');
    return !!(cadre && cadre.classList.contains('as-plein'));
  }

  /* ---------- Page principale : curseur à la télécommande ---------- */

  var curseur = document.createElement('div');
  curseur.id = 'as-curseur';
  var cx = Math.round(window.innerWidth / 2);
  var cy = Math.round(window.innerHeight / 2);
  var delaiDiscret = null;
  var survole = null;
  var sens = { x: 0, y: 0 };
  var boucle = null;
  var debut = 0;
  var precedent = 0;
  var dernierAppui = 0;
  var cibleDefilement;

  function placerCurseur() {
    curseur.style.transform = 'translate3d(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px,0)';
    curseur.classList.remove('discret');
    clearTimeout(delaiDiscret);
    // Le curseur ne s'efface que pendant la vidéo en plein écran.
    if (pleinActif()) delaiDiscret = setTimeout(function () { curseur.classList.add('discret'); }, 4000);
  }

  // Le survol passe par elementFromPoint, coûteux : seulement quand le curseur s'arrête.
  function survoler() {
    var el = document.elementFromPoint(cx, cy);
    if (!el || el === survole) return;
    survole = el;
    if (el.tagName !== 'IFRAME') {
      declencher(el, 'mouseover', cx, cy);
      declencher(el, 'mousemove', cx, cy);
    }
  }

  function defilable(el, dx, dy) {
    while (el && el !== document.body && el !== document.documentElement) {
      var st = getComputedStyle(el);
      if (dy && /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) return el;
      if (dx && /(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth) return el;
      el = el.parentElement;
    }
    return null;
  }

  function defiler(dx, dy) {
    if (cibleDefilement === undefined) cibleDefilement = defilable(document.elementFromPoint(cx, cy), dx, dy);
    (cibleDefilement || window).scrollBy({ left: dx, top: dy, behavior: 'instant' });
  }

  function arreter() {
    sens.x = 0;
    sens.y = 0;
    cibleDefilement = undefined;
    boucle = null;
    survoler();
  }

  function avancer(t) {
    if ((!sens.x && !sens.y) || t - dernierAppui > 1000) { arreter(); return; }
    var dt = Math.min(t - precedent, 50);
    precedent = t;
    // Pixels par milliseconde : précis au début, rapide quand on maintient la touche.
    var v = Math.min(0.3 + (t - debut) / 800, 1.6);
    cx += sens.x * v * dt;
    cy += sens.y * v * dt;
    var marge = 40;
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (cx < marge) { defiler(-v * dt * 2, 0); cx = marge; }
    if (cx > w - marge) { defiler(v * dt * 2, 0); cx = w - marge; }
    if (cy < marge) { defiler(0, -v * dt * 2); cy = marge; }
    if (cy > h - marge) { defiler(0, v * dt * 2); cy = h - marge; }
    placerCurseur();
    boucle = requestAnimationFrame(avancer);
  }

  function demarrer(code, repetition) {
    var maintenant = performance.now();
    dernierAppui = maintenant;
    if (repetition && boucle) return;
    var d = TOUCHES[code];
    if (d[0]) sens.x = d[0];
    if (d[1]) sens.y = d[1];
    // Un appui bref déplace quand même le curseur de quelques pixels.
    cx += d[0] * 10;
    cy += d[1] * 10;
    placerCurseur();
    if (!boucle) {
      debut = maintenant;
      precedent = maintenant;
      boucle = requestAnimationFrame(avancer);
    }
  }

  function relacher(code) {
    var d = TOUCHES[code];
    if (d[0]) sens.x = 0;
    if (d[1]) sens.y = 0;
  }

  /* ---------- Page principale : listes déroulantes (épisodes, lecteurs) ---------- */

  var liste = null;

  function ouvrirListe(select) {
    var panneau = document.createElement('div');
    panneau.id = 'as-liste';
    var lignes = [];
    for (var i = 0; i < select.options.length; i++) {
      var ligne = document.createElement('div');
      ligne.textContent = select.options[i].text;
      panneau.appendChild(ligne);
      lignes.push(ligne);
    }
    document.body.appendChild(panneau);
    liste = { select: select, panneau: panneau, lignes: lignes, index: Math.max(select.selectedIndex, 0) };
    marquerListe();
  }

  function marquerListe() {
    liste.lignes.forEach(function (l, i) { l.classList.toggle('choisi', i === liste.index); });
    var l = liste.lignes[liste.index];
    if (l) liste.panneau.scrollTop = l.offsetTop - liste.panneau.clientHeight / 2;
  }

  function fermerListe() {
    if (liste) liste.panneau.remove();
    liste = null;
  }

  function touchesListe(code) {
    if (code === 38) liste.index = Math.max(liste.index - 1, 0);
    else if (code === 40) liste.index = Math.min(liste.index + 1, liste.lignes.length - 1);
    else if (code === 13) {
      var s = liste.select;
      var i = liste.index;
      fermerListe();
      s.selectedIndex = i;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    } else if (code === 10009 || code === 27) { fermerListe(); return; } else return;
    marquerListe();
  }

  /* ---------- Page principale : touches ---------- */

  var TOUCHES = { 37: [-1, 0], 38: [0, -1], 39: [1, 0], 40: [0, 1] };
  var MEDIAS = { 10252: 'basculer', 415: 'lecture', 19: 'pause', 412: 'recul', 417: 'avance' };

  function enSaisie() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
  }

  function valider() {
    var el = document.elementFromPoint(cx, cy);
    if (!el) return;
    if (el.tagName === 'SELECT') { ouvrirListe(el); return; }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.focus(); return; }
    if (pleinActif()) { commandeMedia('basculer'); return; }
    clicAuPoint(cx, cy);
    if (el.id === 'playerDF') basculerPlein();
  }

  function retour() {
    if (pleinActif()) { basculerPlein(); return; }
    if (history.length > 1) { history.back(); return; }
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); }
  }

  function traiterTouche(code, repetition) {
    if (liste) touchesListe(code);
    else if (TOUCHES[code]) { if (pleinActif()) toucheEnPlein(code); else demarrer(code, repetition); }
    else if (code === 13) valider();
    else if (code === 10009 || code === 27) retour();
    else if (MEDIAS[code]) commandeMedia(MEDIAS[code]);
    else return false;
    return true;
  }

  window.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    if (enSaisie()) {
      // Le clavier de la télé garde ses flèches. Terminé et Annuler rendent la main au curseur.
      if (code === 65376 || code === 65385 || code === 10009) document.activeElement.blur();
      return;
    }
    if (traiterTouche(code, e.repeat)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (TOUCHES[e.keyCode] && !liste && !enSaisie()) {
      relacher(e.keyCode);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Touches renvoyées par le cadre du lecteur.
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.asTv !== 'touche') return;
    if (m.sens === 'bas') traiterTouche(m.code, m.repetition);
    else if (TOUCHES[m.code] && !liste) relacher(m.code);
  });

  // Le script peut arriver avant le document lui-même : on observe donc la racine, toujours présente.
  var prevu = false;
  new MutationObserver(function () {
    if (prevu) return;
    prevu = true;
    setTimeout(function () { prevu = false; preparerPage(); }, 250);
  }).observe(document, { childList: true, subtree: true });
  preparerPage();
})();
