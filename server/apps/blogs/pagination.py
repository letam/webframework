"""Pagination classes for blog feeds."""

from rest_framework.pagination import CursorPagination


class PostCursorPagination(CursorPagination):
    """Cursor pagination for stable newest-first post feeds."""

    page_size = 20
    ordering = ('-created', '-id')
    page_size_query_param = 'page_size'
    max_page_size = 50

    def get_ordering(self, request, queryset, view):
        """Use pin timestamp ordering for the pinned profile scope."""
        if request.query_params.get('pinned', '').lower() in {'1', 'true', 'yes', 'on'}:
            return ('-pinned_at', '-id')
        return super().get_ordering(request, queryset, view)
