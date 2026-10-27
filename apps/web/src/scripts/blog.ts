let mermaidSequence = 0;
function showMermaidFallback(pre: HTMLPreElement) {
  if (pre.dataset.mermaidState === "rendered" || pre.dataset.mermaidState === "failed") return;
  pre.dataset.mermaidState = "failed";
  const note = document.createElement("p");
  note.className = "blog-mermaid-error";
  note.setAttribute("role", "note");
  note.textContent = "图表暂时无法渲染，已保留 Mermaid 源码。";
  pre.before(note);
}

export async function renderMermaid(root: ParentNode = document) {
  const mermaidBlocks = Array.from(root.querySelectorAll<HTMLPreElement>(".personal-article-content pre"))
    .filter(pre => pre.firstElementChild?.matches("code.language-mermaid"));
  if (!mermaidBlocks.length) return;
  let mermaid: typeof import("mermaid").default;
  try {
    ({ default: mermaid } = await import("mermaid"));
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        background: token("--color-background"),
        primaryColor: token("--color-surface"),
        primaryTextColor: token("--color-text"),
        primaryBorderColor: token("--color-border-strong"),
        secondaryColor: token("--brand-soft"),
        tertiaryColor: token("--color-background"),
        lineColor: token("--color-text-muted"),
        clusterBkg: token("--color-surface"),
        clusterBorder: token("--color-border"),
        fontFamily: token("--font-sans"),
        fontSize: "14px",
      },
      flowchart: { htmlLabels: false },
    });
  } catch {
    mermaidBlocks.forEach(showMermaidFallback);
    return;
  }

  for (const pre of mermaidBlocks) {
    const source = pre.firstElementChild?.textContent ?? "";
    const id = `blog-mermaid-${mermaidSequence++}`;
    pre.dataset.mermaidState = "loading";
    try {
      const { svg } = await mermaid.render(id, source);
      const figure = document.createElement("figure");
      figure.className = "blog-mermaid";
      figure.tabIndex = 0;
      figure.setAttribute("role", "group");
      figure.setAttribute("aria-label", "Mermaid 图表，窄屏可横向滚动");
      figure.innerHTML = svg;
      const diagram = figure.querySelector("svg");
      if (!diagram) throw new Error("Mermaid returned no SVG");
      diagram.setAttribute("role", "img");
      diagram.setAttribute("aria-label", "Mermaid 图表；可在下方查看源代码");

      const details = document.createElement("details");
      details.className = "blog-mermaid-source";
      const summary = document.createElement("summary");
      summary.textContent = "查看 Mermaid 源码";
      details.append(summary);
      pre.replaceWith(figure, details);
      details.append(pre);
      pre.dataset.mermaidState = "rendered";
      figure.scrollLeft = Math.max(0, (figure.scrollWidth - figure.clientWidth) / 2);
    } catch {
      document.getElementById(id)?.remove();
      showMermaidFallback(pre);
    }
  }
}

void renderMermaid();
