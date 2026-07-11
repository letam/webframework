"""Tests for markdown-lite inline formatting on the share page.

Mirrors the frontend richText tests so the two renderers stay in lock-step.
"""

from django.test import SimpleTestCase

from ..utils.text import (
    format_inline,
    format_post_body,
    render_inline_markdown,
    strip_inline_markdown,
)


class RenderInlineMarkdownTests(SimpleTestCase):
    """Rendering bold/italic markers to <strong>/<em>."""

    def test_renders_bold(self):
        """** ** becomes <strong>."""
        self.assertEqual(render_inline_markdown('a **big** deal'), 'a <strong>big</strong> deal')

    def test_renders_italic(self):
        """* * becomes <em>."""
        self.assertEqual(render_inline_markdown('an *odd* one'), 'an <em>odd</em> one')

    def test_bold_and_italic_together(self):
        """Bold and italic on one line do not cross-match."""
        self.assertEqual(
            render_inline_markdown('**bold** and *italic*'),
            '<strong>bold</strong> and <em>italic</em>',
        )

    def test_leaves_space_flanked_asterisks(self):
        """Prose asterisks (multiplication, spaced) are left alone."""
        self.assertEqual(render_inline_markdown('2 * 3 * 4'), '2 * 3 * 4')
        self.assertEqual(render_inline_markdown('** hi **'), '** hi **')

    def test_does_not_span_newline(self):
        """A marker pair never spans a line break."""
        self.assertEqual(render_inline_markdown('*a\nb*'), '*a\nb*')


class FormatFilterTests(SimpleTestCase):
    """The template-facing filters escape before formatting."""

    def test_format_inline_escapes_then_formats(self):
        """HTML is escaped; only markdown-introduced tags survive."""
        self.assertEqual(
            format_inline('<b>x</b> **y**'),
            '&lt;b&gt;x&lt;/b&gt; <strong>y</strong>',
        )

    def test_format_post_body_wraps_paragraphs(self):
        """Body formatting adds paragraph markup like linebreaks did."""
        self.assertEqual(format_post_body('one **two**'), '<p>one <strong>two</strong></p>')

    def test_format_post_body_escapes_scripts(self):
        """Script tags in the body are escaped, not rendered."""
        result = format_post_body('<script>alert(1)</script>')
        self.assertNotIn('<script>', result)
        self.assertIn('&lt;script&gt;', result)


class StripInlineMarkdownTests(SimpleTestCase):
    """Removing markers for plain-text Open Graph meta."""

    def test_strips_markers(self):
        """Markers are removed, content kept."""
        self.assertEqual(strip_inline_markdown('a **big** *odd* deal'), 'a big odd deal')

    def test_leaves_prose_asterisks(self):
        """Prose asterisks survive stripping."""
        self.assertEqual(strip_inline_markdown('2 * 3 * 4'), '2 * 3 * 4')

    def test_handles_empty(self):
        """Empty input yields an empty string."""
        self.assertEqual(strip_inline_markdown(''), '')
