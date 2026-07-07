"""Pagination classes for blog feeds."""

from rest_framework.pagination import CursorPagination


class PostCursorPagination(CursorPagination):
    """Cursor pagination for stable newest-first post feeds."""

    page_size = 20
    ordering = ('-created', '-id')
    page_size_query_param = 'page_size'
    max_page_size = 50
