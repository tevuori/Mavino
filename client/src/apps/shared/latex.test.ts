import { describe, expect, it } from "bun:test";
import { latexToMarkdown } from "./latex";

describe("latexToMarkdown", () => {
  it("renders document metadata, sections, text styles, lists, and math", () => {
    const source = String.raw`\documentclass{article}
\title{Calculus Notes}
\author{Ada Student}
\begin{document}
\maketitle
\section{Limits}
A \textbf{limit} can be written as \(\lim_{x \to 0} f(x)\).
\begin{itemize}
\item First result
\item Second result
\end{itemize}
\begin{equation}
E = mc^2
\end{equation}
\end{document}`;

    const result = latexToMarkdown(source);

    expect(result.includes("# Calculus Notes")).toBe(true);
    expect(result.includes("**Ada Student**")).toBe(true);
    expect(result.includes("## Limits")).toBe(true);
    expect(result.includes("**limit**")).toBe(true);
    expect(result.includes("$\\lim_{x \\to 0} f(x)$")).toBe(true);
    expect(result.includes("- First result")).toBe(true);
    expect(result.includes("$$\n\nE = mc^2\n\n$$")).toBe(true);
    expect(result.includes("documentclass")).toBe(false);
  });

  it("removes comments but preserves escaped percent signs", () => {
    expect(latexToMarkdown("Visible % hidden\n100\\% complete")).toBe("Visible\n100% complete");
  });
});
