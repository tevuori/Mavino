function replaceCommands(source: string): string {
  let result = source;
  const replacements: [RegExp, string][] = [
    [/\\textbf\{([^{}]*)\}/g, "**$1**"],
    [/\\(?:textit|emph)\{([^{}]*)\}/g, "*$1*"],
    [/\\texttt\{([^{}]*)\}/g, "`$1`"],
    [/\\href\{([^{}]*)\}\{([^{}]*)\}/g, "[$2]($1)"],
    [/\\url\{([^{}]*)\}/g, "<$1>"],
    [/\\(?:label|index)\{[^{}]*\}/g, ""],
    [/\\footnote\{([^{}]*)\}/g, " ($1)"],
  ];
  for (let pass = 0; pass < 4; pass++) {
    const previous = result;
    for (const [pattern, replacement] of replacements) result = result.replace(pattern, replacement);
    if (result === previous) break;
  }
  return result;
}

export function latexToMarkdown(source: string): string {
  const withoutComments = source.replace(/(^|[^\\])%.*$/gm, "$1");
  const documentMatch = withoutComments.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  let body = documentMatch?.[1] ?? withoutComments;

  const title = withoutComments.match(/\\title\{([^{}]*)\}/)?.[1];
  const author = withoutComments.match(/\\author\{([^{}]*)\}/)?.[1];
  const date = withoutComments.match(/\\date\{([^{}]*)\}/)?.[1];
  const titleBlock = [title ? `# ${title}` : "", author ? `**${author}**` : "", date && date !== "\\today" ? date : ""]
    .filter(Boolean)
    .join("\n\n");

  body = body
    .replace(/\\maketitle/g, titleBlock)
    .replace(/\\(?:part|chapter)\*?\{([^{}]*)\}/g, "# $1")
    .replace(/\\section\*?\{([^{}]*)\}/g, "## $1")
    .replace(/\\subsection\*?\{([^{}]*)\}/g, "### $1")
    .replace(/\\subsubsection\*?\{([^{}]*)\}/g, "#### $1")
    .replace(/\\paragraph\*?\{([^{}]*)\}/g, "##### $1")
    .replace(/\\begin\{(?:equation\*?|displaymath)\}/g, () => "\n$$\n")
    .replace(/\\end\{(?:equation\*?|displaymath)\}/g, () => "\n$$\n")
    .replace(/\\begin\{(?:align|align\*)\}/g, () => "\n$$\\begin{aligned}\n")
    .replace(/\\end\{(?:align|align\*)\}/g, () => "\n\\end{aligned}$$\n")
    .replace(/\\\[/g, () => "\n$$\n")
    .replace(/\\\]/g, () => "\n$$\n")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\begin\{(?:itemize|enumerate)\}/g, "\n")
    .replace(/\\end\{(?:itemize|enumerate)\}/g, "\n")
    .replace(/^\s*\\item(?:\[([^\]]+)\])?\s*/gm, (_match, label?: string) => label ? `- **${label}** ` : "- ")
    .replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_match, quote: string) => `\n${quote.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n`)
    .replace(/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\{[^{}]*\}/g, "")
    .replace(/\\(?:newcommand|renewcommand)\b.*$/gm, "")
    .replace(/\\(?:begin|end)\{(?:center|flushleft|flushright)\}/g, "")
    .replace(/\\(?:centering|noindent|smallskip|medskip|bigskip)\b/g, "")
    .replace(/\\(?:newline|linebreak)\b/g, "  \n");

  body = replaceCommands(body)
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return body || "*This LaTeX document has no renderable content.*";
}
