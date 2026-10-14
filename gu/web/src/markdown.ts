export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function inline(text: string) {
  // Escape first. Raw HTML and executable links never enter the document.
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function markdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let html = "", fence = false, code: string[] = [], list = false;
  const endList = () => { if (list) { html += "</ul>"; list = false; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      endList();
      if (fence) { html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`; code = []; }
      fence = !fence;
      continue;
    }
    if (fence) { code.push(line); continue; }
    if (/^\|/.test(line) && /^\|?[\s:|-]+\|/.test(lines[i + 1] || "")) {
      endList();
      const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
      html += `<div class="table-scroll"><table><thead><tr>${cells(line).map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`;
      i++;
      while (i + 1 < lines.length && lines[i + 1].startsWith("|")) {
        html += `<tr>${cells(lines[++i]).map(c => `<td>${inline(c)}</td>`).join("")}</tr>`;
      }
      html += "</tbody></table></div>";
      continue;
    }
    if (/^\s*[-*]\s|^\s*\d+\.\s/.test(line)) {
      if (!list) { html += "<ul>"; list = true; }
      html += `<li>${inline(line.replace(/^\s*(?:[-*]|\d+\.)\s/, ""))}</li>`;
      continue;
    }
    endList();
    const heading = /^(#{1,6})\s+(.*)/.exec(line);
    if (heading) { const level = Math.min(heading[1].length + 1, 6); html += `<h${level}>${inline(heading[2])}</h${level}>`; }
    else if (/^>\s?/.test(line)) html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`;
    else if (/^---+$/.test(line.trim())) html += "<hr>";
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  endList();
  if (fence) html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
  return html;
}
