// Custom cursor — shared by all pages.
// Only enabled for devices with a fine pointer that can hover (mouse / trackpad).
// Touch devices keep the native behaviour and never see the dot/ring.
(function () {
  const dot = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const root = document.documentElement;
  root.classList.add('has-cursor');

  let mx = 0, my = 0, rx = 0, ry = 0, started = false, raf = 0;

  function tick() {
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
    // Keep animating only while the ring is still catching up.
    raf = (Math.abs(mx - rx) > 0.1 || Math.abs(my - ry) > 0.1) ? requestAnimationFrame(tick) : 0;
  }

  addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    if (!started) { rx = mx; ry = my; started = true; }
    root.classList.add('cursor-moved');
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });

  // Hide the custom cursor while the pointer is outside the window.
  root.addEventListener('mouseleave', () => root.classList.remove('cursor-moved'));

  document.addEventListener('mouseover', e => {
    if (e.target.closest('[data-hover]')) ring.classList.add('hover');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-hover]')) ring.classList.remove('hover');
  });
})();
