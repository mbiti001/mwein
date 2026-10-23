/* Fetch lower-page content only as it approaches the viewport. */
window.Mwein = window.Mwein || {};
window.Mwein.whenNear = (element, load) => {
  if (!element) return;
  if (!('IntersectionObserver' in window)) { load(); return; }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      load();
    }
  }, { rootMargin: '250px' });
  observer.observe(element);
};
