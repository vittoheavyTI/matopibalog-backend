// spa-redirect.js — restaura o deep-link após o truque de SPA do GitHub Pages
// (404.html grava sessionStorage.redirect e volta para /; aqui restauramos a URL).
// Extraído do <script> inline do index.html para permitir uma CSP com
// script-src 'self' (sem 'unsafe-inline'). Carregado SÍNCRONO no <head>, antes do
// bundle (module, deferido), preservando a ordem/comportamento original.
(function () {
  var redirect = sessionStorage.redirect;
  delete sessionStorage.redirect;
  if (redirect) {
    try {
      var url = new URL(redirect);
      var target = url.pathname + url.search + url.hash;
      if (target !== '/' && target !== location.pathname + location.search + location.hash) {
        history.replaceState(null, null, target);
      }
    } catch (e) {}
  }
})();
