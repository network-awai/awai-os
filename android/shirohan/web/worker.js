self.onmessage = ({ data: { svg, color, silhouette, options } }) => {
  try {
    const job = svg === undefined
      ? self.Shirohan.planImage(color, silhouette, options)
      : self.Shirohan.planSvg(svg, options);
    self.postMessage({ job });
  } catch (error) {
    self.postMessage({ error: error.message || '製版できませんでした。' });
  }
};
