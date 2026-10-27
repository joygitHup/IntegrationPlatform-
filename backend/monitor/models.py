"""SLA 采集与快照：心跳探针 + 每日可用性归档。

为什么要单独落库：
- JobExecution 属于业务数据，会被归档/清理，历史 SLA 会随之丢失；
- 平台"自身存活"不能只看任务成败，需要独立心跳记录基础设施可用性。
"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class SlaHeartbeat(StringIdModel):
    """调度器心跳：每 30 秒写一条，用于检测平台自身存活与故障窗口。"""
    ID_PREFIX = "hb"

    beat_at = models.DateTimeField(db_index=True, auto_now_add=True)
    source = models.CharField(max_length=32, default="scheduler")  # scheduler/worker/api
    status = models.CharField(max_length=16, default="ok")  # ok/error
    latency_ms = models.IntegerField(default=0)
    note = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "sys_sla_heartbeats"


class DailySla(StringIdModel):
    """每日 SLA 快照。client_id 为空串 = 平台整体；避免长窗口实时扫表。"""
    ID_PREFIX = "dsla"

    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    day = models.DateField(db_index=True)
    sla_achieved = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    status = models.CharField(max_length=16, default="operational")
    total_executions = models.IntegerField(default=0)
    failed_executions = models.IntegerField(default=0)
    success_rate = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    downtime_seconds = models.IntegerField(default=0)
    outages_count = models.IntegerField(default=0)
    heartbeat_gaps = models.IntegerField(default=0)  # 心跳中断次数（基础设施故障）
    # 心跳中断累计秒数：单独存一份，长窗口 SLA 聚合时与执行失败停机相加
    heartbeat_downtime_seconds = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_daily_sla"
        unique_together = [("client_id", "day")]
