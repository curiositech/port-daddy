(function () {
  var html = document.documentElement;
  var stored = localStorage.getItem('pd-theme');
  var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (stored === 'dark' || (!stored && sysDark)) {
    html.setAttribute('data-theme', 'dark');
  }

  function initToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var current = html.getAttribute('data-theme');
      var nowDark = current === 'dark' ||
        (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = nowDark ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('pd-theme', next);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggle);
  } else {
    initToggle();
  }
})();
