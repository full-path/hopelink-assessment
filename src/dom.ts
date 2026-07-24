type Child = Node | string | null | undefined | false;

type AttrValue = string | boolean | undefined | ((event: Event) => void);
type Attrs = Record<string, AttrValue>;

/** Minimal hyperscript-style element builder — avoids hand-rolled innerHTML string building. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "onClick") {
      el.addEventListener("click", value as EventListener);
    } else if (key === "onChange") {
      el.addEventListener("change", value as EventListener);
    } else if (key === "className") {
      el.setAttribute("class", String(value));
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function clear(el: Element): void {
  el.replaceChildren();
}
