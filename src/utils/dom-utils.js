export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

export const svgIcon = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim(); // static, trusted markup only
  return t.content.firstChild;
};

export const cleanText = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function closestAnchor(target) {
  const el = target && target.nodeType === 1 ? target : target?.parentElement;
  return el ? el.closest('a[href]') : null;
}
