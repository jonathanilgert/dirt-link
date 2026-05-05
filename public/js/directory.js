// Tiny progressive-enhancement script for /calgary/suppliers.
// 1. Wires the mobile category-jumpnav <select> to scroll to anchors.
// 2. Pushes GA4 events for jumpnav clicks (in addition to data-cta tracking).

(function () {
  var sel = document.querySelector('.directory-jumpnav__select');
  if (sel) {
    sel.addEventListener('change', function () {
      var v = sel.value;
      if (!v) return;
      var target = document.querySelector(v);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (typeof gtag === 'function') {
        gtag('event', 'directory_category_jumpnav_clicked', { category: v.replace(/^#/, '') });
      }
    });
  }

  document.querySelectorAll('a[data-cta="directory-jumpnav"]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (typeof gtag === 'function') {
        gtag('event', 'directory_category_jumpnav_clicked', { category: a.getAttribute('data-category') });
      }
    });
  });

  document.querySelectorAll('a[data-cta="directory-supplier"]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (typeof gtag === 'function') {
        gtag('event', 'directory_supplier_clicked', {
          supplier_slug: a.getAttribute('data-supplier-slug'),
          supplier_tier: a.getAttribute('data-supplier-tier'),
          category:      a.getAttribute('data-category')
        });
      }
    });
  });

  document.querySelectorAll('a[data-cta="directory-view-on-map"]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (typeof gtag === 'function') {
        gtag('event', 'directory_view_on_map_clicked', {
          supplier_slug: a.getAttribute('data-supplier-slug')
        });
      }
    });
  });
})();
