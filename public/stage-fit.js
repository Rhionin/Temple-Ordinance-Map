// The TV is a fixed 1920x1080 stage. In portrait the stage turns 90 degrees
// and the fit uses the swapped screen edges so the landscape frame fills
// the phone without overflowing it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StageFit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function fit(width, height, portrait) {
    const w = Number(width);
    const h = Number(height);
    const scale = portrait
      ? Math.min(w / 1080, h / 1920)
      : Math.min(w / 1920, h / 1080);
    return {
      fit: scale > 0 && Number.isFinite(scale) ? scale : 1,
      turn: portrait ? '90deg' : '0deg',
    };
  }

  // Map a viewport point into the stage's unrotated 1920x1080 box.
  // Leaflet's own helper only understands axis-aligned scaling.
  function containerPoint(clientX, clientY, rect, offsetWidth, offsetHeight, turn) {
    const width = Number(offsetWidth) || 1;
    const height = Number(offsetHeight) || 1;
    const box = rect || { left: 0, top: 0, width: width, height: height };
    if (turn === '90deg') {
      const scale = box.width / height || 1;
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      return {
        x: (clientY - centerY) / scale + width / 2,
        y: -(clientX - centerX) / scale + height / 2,
      };
    }
    const scaleX = box.width / width || 1;
    const scaleY = box.height / height || 1;
    return {
      x: (clientX - box.left) / scaleX,
      y: (clientY - box.top) / scaleY,
    };
  }

  return { fit, containerPoint };
});
