"""Markdown-lite inline formatting for the server-rendered share page.

Mirrors the frontend renderInlineMarkdown (app/src/lib/utils/richText.ts) so the
`/p/<id>` share page matches the React feed: ``**bold**`` and ``*italic*`` with
CommonMark-style flanking, so ordinary prose like ``2 * 3 * 4`` is left alone.
"""

import re

from django.utils.html import escape, linebreaks
from django.utils.safestring import mark_safe

# Content between markers must start and end with a non-space, non-`*` character.
_EDGE = r"[^\s*]"
_INNER = rf"({_EDGE}|{_EDGE}[^*\n]*?{_EDGE})"
_BOLD = re.compile(rf"\*\*{_INNER}\*\*")
_ITALIC = re.compile(rf"\*{_INNER}\*")


def render_inline_markdown(escaped_text: str) -> str:
    """Turn bold/italic markers into ``<strong>``/``<em>``.

    The input MUST already be HTML-escaped; this only introduces the two tags,
    so the result is safe to mark as safe. Bold is applied before italic.
    """
    with_bold = _BOLD.sub(r"<strong>\1</strong>", escaped_text)
    return _ITALIC.sub(r"<em>\1</em>", with_bold)


def format_inline(value: str) -> str:
    """Escape then render inline markdown; safe for template output (no <p>)."""
    return mark_safe(render_inline_markdown(escape(value or "")))


def format_post_body(value: str) -> str:
    """Escape, render inline markdown, then paragraph-break — matches the feed."""
    formatted = render_inline_markdown(escape(value or ""))
    return mark_safe(linebreaks(formatted, autoescape=False))


def strip_inline_markdown(value: str) -> str:
    """Remove bold/italic markers, leaving plain text (for Open Graph meta)."""
    without_bold = _BOLD.sub(r"\1", value or "")
    return _ITALIC.sub(r"\1", without_bold)
