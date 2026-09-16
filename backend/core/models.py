"""字符串主键抽象模型，与前端 text id 对齐。"""
from __future__ import annotations

from django.db import models

from core.ids import generate_id


class StringIdModel(models.Model):
    id = models.CharField(primary_key=True, max_length=64, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self.id:
            prefix = getattr(self, "ID_PREFIX", "")
            self.id = generate_id(prefix)
        super().save(*args, **kwargs)
