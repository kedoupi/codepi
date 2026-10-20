export interface ExtractedCard {
  goal: string | null;
  scope: string | null;
  conventions: string | null;
  pitfalls: string | null;
}

const HEADINGS = {
  goal: ["what this repo is"],
  scope: ["architecture in one screen"],
  conventions: ["conventions"],
  pitfalls: ["pitfalls", "注意事项", "常见问题"],
} as const;

interface Section {
  heading: string;
  level: number;
  lines: string[];
}

function sections(markdown: string): { preamble: string[]; sections: Section[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const result: Section[] = [];
  const preamble: string[] = [];
  let current: Section | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) {
        current = { heading: match[2].trim(), level: match[1].length, lines: [] };
        result.push(current);
        continue;
      }
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return { preamble, sections: result };
}

function matching(section: Section, aliases: readonly string[]) {
  const heading = section.heading.toLowerCase();
  return aliases.some(alias =>
    heading === alias || heading.startsWith(`${alias} `) || heading.includes(alias));
}

function cap(value: string, limit: number): string {
  const chars = Array.from(value);
  return chars.length <= limit ? value : chars.slice(0, limit).join("");
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphs(lines: string[]): string[] {
  const result: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = stripMarkdown(current.join(" "));
    if (text) result.push(text);
    current = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line) || /^\s*\|/.test(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return result;
}

function goal(sectionList: Section[], preamble: string[]): string | null {
  const section = sectionList.find(item => matching(item, HEADINGS.goal));
  const source = section?.lines ?? sectionList.find(item => item.level === 1)?.lines ?? preamble;
  const found = paragraphs(source).slice(0, 2).join("\n\n");
  return found ? cap(found, 800) : null;
}

function scope(sectionList: Section[]): string | null {
  const section = sectionList.find(item => matching(item, HEADINGS.scope));
  if (!section) return null;
  const lines = section.lines;
  let start = -1;
  let marker = "";
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*(```|~~~)/);
    if (match) {
      start = index + 1;
      marker = match[1];
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start; index < lines.length; index++) {
    if (lines[index].trimStart().startsWith(marker)) {
      end = index;
      break;
    }
  }
  const code = lines.slice(start, end).join("\n").trim();
  return code ? cap(code, 2000) : null;
}

function conventions(sectionList: Section[]): string | null {
  const section = sectionList.find(item => matching(item, HEADINGS.conventions));
  if (!section) return null;
  const items: string[] = [];
  for (const line of section.lines) {
    const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (!match) continue;
    const item = stripMarkdown(match[1]);
    if (item) items.push(cap(item, 200));
    if (items.length >= 10) break;
  }
  return items.length ? cap(items.join("\n"), 2400) : null;
}

function firstSentence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/^(.+?(?:[.!?。！？](?:\s|$)|$))/);
  return cap((match?.[1] || normalized).trim(), 300);
}

function pitfalls(sectionList: Section[]): string | null {
  const section = sectionList.find(item => matching(item, HEADINGS.pitfalls));
  if (!section) return null;
  const groups: string[][] = [];
  let current: string[] | null = null;
  let inFence = false;
  for (const line of section.lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      if (current) current.push(line);
      continue;
    }
    const start = line.match(/^\s*\d+\.\s+(.+)$/);
    if (start) {
      current = [start[1]];
      groups.push(current);
    } else if (current && line.trim() && !/^\s*#{1,6}\s+/.test(line)) {
      current.push(line);
    } else if (current && !line.trim()) {
      current = null;
    }
  }
  const items = groups.map(group => {
    const raw = group.join(" ").trim();
    const bold = raw.match(/\*\*(.+?)\*\*/);
    const title = bold ? stripMarkdown(bold[1]) : "";
    const body = bold ? raw.replace(bold[0], "").trim() : raw;
    const sentence = firstSentence(stripMarkdown(body));
    if (title && sentence) return `${title}：${sentence}`;
    return title || sentence;
  }).filter(Boolean);
  return items.length ? cap(items.join("\n"), 2400) : null;
}

export function extractCard(markdown: string): ExtractedCard {
  const parsed = sections(markdown);
  return {
    goal: goal(parsed.sections, parsed.preamble),
    scope: scope(parsed.sections),
    conventions: conventions(parsed.sections),
    pitfalls: pitfalls(parsed.sections),
  };
}
