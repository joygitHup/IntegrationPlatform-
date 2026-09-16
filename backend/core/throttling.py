"""登录限流：每 IP 每分钟 N 次失败尝试。

后端可插拔：Django settings 配置 ``REDIS_URL`` 时使用 Redis 有序集合实现
（``ZADD`` 以时间戳为分数、``ZREMRANGEBYSCORE`` 清理过期、``ZCARD`` 计数）；
未配置或缺依赖则回退到内存实现。Redis 连接异常时自动降级内存，保证服务可用。
"""
from __future__ import annotations

import os
import time
import uuid
from collections import defaultdict, deque
from threading import Lock

from django.conf import settings

# ----- 内存后端（默认 / 兜底）-----
_lock = Lock()
_buckets: dict[str, deque] = defaultdict(deque)


def _hit(key: str, limit: int, window: int, *, consume: bool) -> tuple[bool, int]:
    """内存滑动窗口：每键一个 deque，弹出超出窗口的旧时间戳。多实例部署请启用 Redis。"""
    now = time.time()
    with _lock:
        q = _buckets[key]
        while q and now - q[0] > window:
            q.popleft()
        if limit > 0 and len(q) >= limit:
            wait = int((window - (now - q[0])) * 1000)
            return False, max(wait, 1000)
        if consume:
            q.append(now)
        return True, 0


# ----- Redis 后端 -----
_redis_client = None
_redis_failed_at: float = 0.0
_REDIS_NEG_CACHE_TTL = 30.0  # 连接失败后的负面缓存秒数，避免持续冲击挂掉的 Redis


def _get_redis():
    """惰性初始化 Redis 客户端。

    - 未配置 ``REDIS_URL`` 返回 None；
    - 缺 ``redis`` 包或连接失败返回 None（调用方回退内存）；
    - 连接失败后短时间内不再重试，避免每个请求都被拖慢。
    """
    global _redis_client, _redis_failed_at
    if _redis_client is not None:
        return _redis_client
    if _redis_failed_at and time.time() - _redis_failed_at < _REDIS_NEG_CACHE_TTL:
        return None
    url = getattr(settings, "REDIS_URL", "") or os.getenv("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis  # 可选依赖，惰性导入
    except ImportError:
        _redis_failed_at = time.time()
        return None
    try:
        client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        client.ping()  # 触发一次连接验证
    except Exception:
        _redis_failed_at = time.time()
        return None
    _redis_client = client
    return _redis_client


def _hit_redis(client, key: str, limit: int, window: int, *, consume: bool) -> tuple[bool, int] | None:
    """Redis 有序集合限流。返回 None 表示连接异常，调用方应回退内存。"""
    now = time.time()
    rkey = f"throttle:{key}"
    try:
        pipe = client.pipeline()
        pipe.zremrangebyscore(rkey, 0, now - window)  # 清理窗口外成员
        pipe.zcard(rkey)  # 计数当前窗口内成员
        _, current = pipe.execute()
    except Exception:
        return None
    if limit > 0 and current >= limit:
        # 取最早成员估算还需等待多久
        try:
            earliest = client.zrange(rkey, 0, 0, withscores=True)
            if earliest:
                wait = int((window - (now - earliest[0][1])) * 1000)
                return False, max(wait, 1000)
        except Exception:
            pass
        return False, window * 1000
    if consume:
        member = f"{now}:{uuid.uuid4().hex}"  # 唯一成员，避免同毫秒覆盖
        try:
            pipe = client.pipeline()
            pipe.zadd(rkey, {member: now})
            pipe.expire(rkey, window + 5)  # 防止冷键堆积
            pipe.execute()
        except Exception:
            return None
    return True, 0


def _throttle(key: str, limit: int, window: int, *, consume: bool) -> tuple[bool, int]:
    """限流后端分发：优先 Redis，未配置或异常时回退内存。"""
    client = _get_redis()
    if client is not None:
        result = _hit_redis(client, key, limit, window, consume=consume)
        if result is not None:
            return result
    return _hit(key, limit, window, consume=consume)


def check_login_rate_limit(ip: str, *, consume: bool = True) -> tuple[bool, int]:
    """返回 (allowed, ms_before_next)。成功登录不占用配额。"""
    limit = getattr(settings, "LOGIN_RATE_LIMIT", 5)
    window = getattr(settings, "LOGIN_RATE_WINDOW_SECONDS", 60)
    return _throttle(f"login:{ip}", limit, window, consume=consume)


def check_register_rate_limit(ip: str, *, consume: bool = True) -> tuple[bool, int]:
    limit = getattr(settings, "OPEN_REGISTER_RATE_LIMIT", 3)
    window = getattr(settings, "OPEN_REGISTER_RATE_WINDOW_SECONDS", 3600)
    return _throttle(f"register:{ip or 'unknown'}", limit, window, consume=consume)


def check_client_rate_limit(client_id: str, limit: int, *, consume: bool = True) -> tuple[bool, int]:
    """按集成凭证限流，limit<=0 表示不限制。"""
    if not client_id or int(limit or 0) <= 0:
        return True, 0
    window = getattr(settings, "CLIENT_RATE_WINDOW_SECONDS", 60)
    return _throttle(f"client:{client_id}", int(limit), window, consume=consume)
