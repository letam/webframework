"""Template filters that render post text on the server-rendered share page."""

from django import template

from ..utils.text import format_inline, format_post_body

register = template.Library()

register.filter("format_post_body", format_post_body, is_safe=True)
register.filter("format_inline", format_inline, is_safe=True)
