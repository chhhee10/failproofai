// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  encodeAnnotation,
  findMdxParseError,
  stripFrontmatter,
} from "@/scripts/validate-mdx";

describe("stripFrontmatter", () => {
  it("blanks a leading frontmatter block while preserving line numbers", () => {
    const src = `---\ntitle: "Hello"\ndescription: "x"\n---\n\n# Body\n`;
    const out = stripFrontmatter(src);
    // Same number of lines, so error positions stay aligned with the file.
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).toContain("# Body");
    expect(out).not.toContain("title:");
  });

  it("leaves content without frontmatter untouched", () => {
    const src = `# Title\n\nSome prose.\n`;
    expect(stripFrontmatter(src)).toBe(src);
  });
});

describe("encodeAnnotation", () => {
  it("percent-encodes newlines, carriage returns, and percent signs", () => {
    expect(encodeAnnotation("line one\nline two")).toBe("line one%0Aline two");
    expect(encodeAnnotation("a\r\nb")).toBe("a%0D%0Ab");
    // `%` must be encoded first so the escapes above aren't double-encoded.
    expect(encodeAnnotation("100% sure")).toBe("100%25 sure");
  });

  it("leaves a plain single-line message untouched", () => {
    expect(encodeAnnotation("Expected a closing tag for `<slug>`")).toBe(
      "Expected a closing tag for `<slug>`",
    );
  });
});

describe("findMdxParseError", () => {
  it("returns null for a clean page (frontmatter + component + fenced <slug>)", async () => {
    const src = [
      "---",
      'title: "Audit"',
      "---",
      "",
      "<Card title=\"Audit\" href=\"/cli/audit\">Run an audit</Card>",
      "",
      "Install with `failproofai policy add <slug>`.",
      "",
      "```bash",
      "failproofai policy add <slug>",
      "```",
      "",
    ].join("\n");
    expect(await findMdxParseError(src)).toBeNull();
  });

  it("flags a <slug> placeholder that escaped its inline-code backticks", async () => {
    // The tr/cli/audit.mdx regression: a dropped closing backtick pushed the
    // `<slug>` out of code, where MDX reads it as an unclosed JSX tag.
    const src = "Install with failproofai policy add <slug> now.\n";
    const error = await findMdxParseError(src);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/slug|closing tag/i);
  });

  it("flags a {#id} heading anchor (invalid MDX expression)", async () => {
    // The ja/zh built-in-policies.mdx regression: the translator injected an
    // explicit `{#anchor}` heading id, which MDX parses as a JS expression.
    const src = "## Dangerous commands {#dangerous-commands}\n";
    const error = await findMdxParseError(src);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/acorn|expression/i);
  });

  it("accepts the same heading once the {#id} anchor is removed", async () => {
    expect(await findMdxParseError("## Dangerous commands\n")).toBeNull();
  });

  it("reports a line number for the failure", async () => {
    const src = "# Intro\n\nsome text\n\nbad <slug> here\n";
    const error = await findMdxParseError(src);
    expect(error).not.toBeNull();
    expect(error?.line).toBe(5);
  });
});
