"""
分页格式与前端对齐：{ items, total, page, pageSize }。

同时接受 pageSize / page_size 查询参数。
"""
from __future__ import annotations

from rest_framework.pagination import BasePagination
from rest_framework.response import Response

from core.query import q_int


class PageSizePagination(BasePagination):
    page_size = 20
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        self.request = request
        self.page = max(q_int(request, "page", default=1), 1)
        self.page_size = min(
            max(q_int(request, "pageSize", "page_size", default=self.page_size), 1),
            self.max_page_size,
        )
        if hasattr(queryset, "count"):
            self.total = queryset.count()
            offset = (self.page - 1) * self.page_size
            return list(queryset[offset : offset + self.page_size])
        items = list(queryset)
        self.total = len(items)
        offset = (self.page - 1) * self.page_size
        return items[offset : offset + self.page_size]

    def get_paginated_response(self, data):
        return Response(
            {
                "items": data,
                "total": self.total,
                "page": self.page,
                "pageSize": self.page_size,
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "items": schema,
                "total": {"type": "integer"},
                "page": {"type": "integer"},
                "pageSize": {"type": "integer"},
            },
        }


def paginate_list(items: list, page: int, page_size: int) -> dict:
    """非 queryset 列表的分页包装。"""
    page = max(int(page or 1), 1)
    page_size = max(int(page_size or 20), 1)
    total = len(items)
    offset = (page - 1) * page_size
    return {
        "items": items[offset : offset + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }
