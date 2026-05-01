// Dirtlink Calgary — CTA event tracking.
// Wires GA4 custom events on links/buttons that carry a data-cta attribute,
// and a single delegated listener for calculator-open events.
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  function fire(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params || {});
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-cta]');
    if (!el) return;
    var label = el.getAttribute('data-cta');
    var page = location.pathname;
    if (label.indexOf('list') === 0 || label.indexOf('hub-list') === 0) {
      fire('list_material_click', { cta_label: label, page: page });
    } else if (label.indexOf('find') === 0 || label.indexOf('hub-find') === 0) {
      fire('find_material_click', { cta_label: label, page: page });
    } else if (label.indexOf('calculator') === 0) {
      fire('calculator_open', { cta_label: label, page: page });
    } else {
      fire('cta_click', { cta_label: label, page: page });
    }
  });
})();
