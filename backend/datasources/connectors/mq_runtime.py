"""Kafka / RabbitMQ / Redis / RocketMQ 真实生产与消费。驱动缺失时给出明确错误。"""
from __future__ import annotations

import json
from typing import Any

from datasources.connectors.watermark import active as wm_active, field_name as wm_field, filter_rows


def _need(pkg: str, hint: str):
    raise RuntimeError(f"未安装 {pkg}，无法连接消息队列。请 pip install {hint}")


def _as_dict(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "ignore")
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            data = json.loads(text)
            return data if isinstance(data, dict) else {"value": data}
        except json.JSONDecodeError:
            return {"value": text}
    return {"value": raw}


def _batch(job_cfg: dict, config: dict) -> int:
    try:
        return max(int(job_cfg.get("batch_size") or config.get("batchSize") or 100), 1)
    except (TypeError, ValueError):
        return 100


def _topic(config: dict, job_cfg: dict) -> str:
    return str(
        job_cfg.get("topic")
        or job_cfg.get("queue")
        or job_cfg.get("table")
        or config.get("topic")
        or config.get("queue")
        or ""
    ).strip()


def test(kind: str, config: dict) -> dict:
    kind = (kind or "").lower()
    try:
        if kind == "redis":
            return _redis_ping(config)
        if kind == "rabbitmq":
            return _rabbit_ping(config)
        if kind == "kafka":
            return _kafka_ping(config)
        if kind == "rocketmq":
            return _rocket_ping(config)
    except Exception as exc:
        return {"success": False, "message": str(exc)}
    return {"success": False, "message": f"不支持的消息队列: {kind}"}


def inspect(kind: str, config: dict, job_cfg: dict | None = None) -> dict:
    kind = (kind or "").lower()
    job_cfg = job_cfg or {}
    try:
        if kind == "kafka":
            return _kafka_inspect(config, job_cfg)
        if kind == "redis":
            return _redis_inspect(config, job_cfg)
        if kind == "rabbitmq":
            return _rabbit_inspect(config, job_cfg)
        if kind == "rocketmq":
            return _rocket_inspect(config, job_cfg)
    except Exception as exc:
        return {"dialect": kind, "tables": [], "columns": [], "sample": [], "message": str(exc)}
    return {"dialect": kind, "tables": [], "columns": [], "sample": [], "message": f"不支持的消息队列: {kind}"}


def _inspect_payload(kind: str, tables: list[str], sample: list[dict] | None = None, message: str = "") -> dict:
    rows = sample or []
    columns: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key in seen:
                continue
            seen.add(key)
            columns.append({"name": key, "type": "string"})
    return {
        "dialect": kind,
        "tables": [{"name": name} for name in tables],
        "columns": columns,
        "sample": rows[:5],
        "message": message,
    }


def extract(kind: str, config: dict, job_cfg: dict) -> list[dict]:
    kind = (kind or "").lower()
    if kind == "redis":
        rows = _redis_consume(config, job_cfg)
    elif kind == "rabbitmq":
        rows = _rabbit_consume(config, job_cfg)
    elif kind == "kafka":
        rows = _kafka_consume(config, job_cfg)
    elif kind == "rocketmq":
        rows = _rocket_consume(config, job_cfg)
    else:
        raise RuntimeError(f"不支持的消息队列读取: {kind}")
    return filter_rows(rows, job_cfg)


def _record_key(record: dict, match_keys: list[str]) -> str:
    return "||".join(str(record.get(k, "")) for k in match_keys)


def fetch_existing_map(kind: str, config: dict, job_cfg: dict, match_keys: list[str]) -> dict[str, dict]:
    """一次性扫目标侧已有记录，供冲突策略使用。"""
    if not match_keys:
        return {}
    kind = (kind or "").lower()
    if kind == "redis":
        client = _redis_client(config)
        key = _redis_key(config, job_cfg)
        raw = client.hgetall(key + ":idx") or {}
        result = {}
        for field, payload in raw.items():
            rec = _as_dict(payload)
            result[str(field)] = rec
        return result
    rows: list[dict] = []
    if kind == "kafka":
        rows = _kafka_scan(config, job_cfg, limit=400)
    elif kind == "rabbitmq":
        rows = _rabbit_scan(config, job_cfg, limit=200)
    result = {}
    for rec in rows:
        result[_record_key(rec, match_keys)] = rec
    return result


def lookup(kind: str, config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    kind = (kind or "").lower()
    if not match_keys:
        return None
    if kind == "redis":
        return _redis_lookup(config, job_cfg, row, match_keys)
    if kind == "rabbitmq":
        return _rabbit_lookup(config, job_cfg, row, match_keys)
    if kind == "kafka":
        return _kafka_lookup(config, job_cfg, row, match_keys)
    if kind == "rocketmq":
        return _rocket_lookup(config, job_cfg, row, match_keys)
    return None


def load(kind: str, config: dict, job_cfg: dict, row: dict) -> None:
    kind = (kind or "").lower()
    if kind == "redis":
        return _redis_produce(config, job_cfg, row)
    if kind == "rabbitmq":
        return _rabbit_produce(config, job_cfg, row)
    if kind == "kafka":
        return _kafka_produce(config, job_cfg, row)
    if kind == "rocketmq":
        return _rocket_produce(config, job_cfg, row)
    raise RuntimeError(f"不支持的消息队列写入: {kind}")


# ----- Redis -----
def _redis_client(config: dict):
    try:
        import redis
    except ImportError:
        _need("redis", "redis")
    return redis.Redis(
        host=str(config.get("host") or "127.0.0.1"),
        port=int(config.get("port") or 6379),
        password=config.get("password") or None,
        db=int(config.get("db") or 0),
        decode_responses=True,
        socket_timeout=8,
    )


def _redis_ping(config: dict) -> dict:
    client = _redis_client(config)
    client.ping()
    return {"success": True, "message": "Redis 连接成功"}


def _redis_inspect(config: dict, job_cfg: dict) -> dict:
    client = _redis_client(config)
    keys: list[str] = []
    cursor = 0
    for _ in range(20):
        cursor, batch = client.scan(cursor=cursor, count=50)
        for item in batch:
            name = item.decode("utf-8", "ignore") if isinstance(item, (bytes, bytearray)) else str(item)
            if name.endswith(":idx"):
                continue
            keys.append(name)
        if cursor == 0:
            break
    configured = _topic(config, job_cfg) or str(config.get("key") or "")
    if configured and configured not in keys:
        keys = [configured, *keys]
    sample: list[dict] = []
    if keys:
        raw = client.lrange(keys[0], 0, 4) or []
        sample = [_as_dict(item) for item in raw]
    return _inspect_payload("redis", keys[:80], sample, "已扫描 Redis key" if keys else "暂无 key，可手填队列名")


def _redis_key(config: dict, job_cfg: dict) -> str:
    return _topic(config, job_cfg) or str(config.get("key") or "integration")


def _redis_consume(config: dict, job_cfg: dict) -> list[dict]:
    client = _redis_client(config)
    key = _redis_key(config, job_cfg)
    mode = str(job_cfg.get("mode") or config.get("mode") or "list")
    rows = []
    n = _batch(job_cfg, config)
    if mode == "pubsub":
        pub = client.pubsub()
        pub.subscribe(key)
        deadline = 3.0
        import time
        end = time.time() + deadline
        while time.time() < end and len(rows) < n:
            msg = pub.get_message(timeout=0.5)
            if msg and msg.get("type") == "message":
                rows.append(_as_dict(msg.get("data")))
        pub.close()
        return rows
    for _ in range(n):
        item = client.lpop(key)
        if item is None:
            break
        rows.append(_as_dict(item))
    return rows


def _redis_lookup(config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    client = _redis_client(config)
    key = _redis_key(config, job_cfg)
    raw = client.hget(key + ":idx", _record_key(row, match_keys))
    return _as_dict(raw) if raw else None


def _redis_produce(config: dict, job_cfg: dict, row: dict) -> None:
    client = _redis_client(config)
    key = _redis_key(config, job_cfg)
    payload = json.dumps(row, ensure_ascii=False, default=str)
    mode = str(job_cfg.get("mode") or config.get("mode") or "list")
    if mode == "pubsub":
        client.publish(key, payload)
    else:
        client.rpush(key, payload)
    match = job_cfg.get("match_keys") or []
    if match:
        client.hset(key + ":idx", _record_key(row, match), payload)


# ----- RabbitMQ -----
def _rabbit_params(config: dict):
    try:
        import pika
    except ImportError:
        _need("pika", "pika")
    return pika.ConnectionParameters(
        host=str(config.get("host") or "127.0.0.1"),
        port=int(config.get("port") or 5672),
        virtual_host=str(config.get("vhost") or "/"),
        credentials=pika.PlainCredentials(
            str(config.get("username") or "guest"),
            str(config.get("password") or "guest"),
        ),
        blocked_connection_timeout=8,
        socket_timeout=8,
    )


def _rabbit_ping(config: dict) -> dict:
    import pika

    conn = pika.BlockingConnection(_rabbit_params(config))
    conn.close()
    return {"success": True, "message": "RabbitMQ 连接成功"}


def _rabbit_inspect(config: dict, job_cfg: dict) -> dict:
    tables: list[str] = []
    configured = _topic(config, job_cfg)
    if configured:
        tables.append(configured)
    host = str(config.get("host") or "127.0.0.1")
    user = str(config.get("username") or "guest")
    password = str(config.get("password") or "guest")
    vhost = str(config.get("vhost") or "/")
    mgmt_port = int(config.get("managementPort") or config.get("management_port") or 15672)
    try:
        import base64
        from urllib.parse import quote
        from urllib.request import Request, urlopen

        url = f"http://{host}:{mgmt_port}/api/queues/{quote(vhost, safe='')}"
        req = Request(url)
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        req.add_header("Authorization", f"Basic {token}")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
        if isinstance(data, list):
            for item in data:
                name = (item or {}).get("name")
                if name and name not in tables:
                    tables.append(str(name))
    except Exception:
        pass
    sample = _rabbit_scan(config, job_cfg, limit=5) if configured else []
    message = "已列出队列" if tables else "未探测到队列，请填写 queue 或开启 Management 15672"
    return _inspect_payload("rabbitmq", tables, sample, message)


def _rabbit_consume(config: dict, job_cfg: dict) -> list[dict]:
    import pika

    queue = _topic(config, job_cfg)
    if not queue:
        raise RuntimeError("RabbitMQ 缺少 queue")
    conn = pika.BlockingConnection(_rabbit_params(config))
    ch = conn.channel()
    ch.queue_declare(queue=queue, durable=True)
    rows = []
    for _ in range(_batch(job_cfg, config)):
        method, _props, body = ch.basic_get(queue=queue, auto_ack=False)
        if method is None:
            break
        rows.append(_as_dict(body))
        ch.basic_ack(method.delivery_tag)
    conn.close()
    return rows


def _rabbit_scan(config: dict, job_cfg: dict, limit: int = 200) -> list[dict]:
    import pika

    queue = _topic(config, job_cfg)
    if not queue:
        return []
    conn = pika.BlockingConnection(_rabbit_params(config))
    ch = conn.channel()
    ch.queue_declare(queue=queue, durable=True)
    rows = []
    tags = []
    try:
        for _ in range(limit):
            method, _props, body = ch.basic_get(queue=queue, auto_ack=False)
            if method is None:
                break
            tags.append(method.delivery_tag)
            rows.append(_as_dict(body))
        for tag in tags:
            ch.basic_nack(tag, requeue=True)
    finally:
        conn.close()
    return rows


def _rabbit_lookup(config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    want = {k: str(row.get(k, "")) for k in match_keys}
    for rec in _rabbit_scan(config, job_cfg, limit=200):
        if all(str(rec.get(k, "")) == want[k] for k in match_keys):
            return rec
    return None


def _rabbit_produce(config: dict, job_cfg: dict, row: dict) -> None:
    import pika

    queue = _topic(config, job_cfg)
    exchange = str(job_cfg.get("exchange") or config.get("exchange") or "")
    routing = str(job_cfg.get("routingKey") or config.get("routingKey") or queue)
    conn = pika.BlockingConnection(_rabbit_params(config))
    ch = conn.channel()
    body = json.dumps(row, ensure_ascii=False, default=str).encode("utf-8")
    if exchange:
        ch.basic_publish(exchange=exchange, routing_key=routing, body=body)
    else:
        if not queue:
            raise RuntimeError("RabbitMQ 缺少 queue")
        ch.queue_declare(queue=queue, durable=True)
        ch.basic_publish(exchange="", routing_key=queue, body=body)
    conn.close()


# ----- Kafka -----
def _kafka_brokers(config: dict) -> list[str]:
    raw = config.get("brokers") or config.get("bootstrapServers") or config.get("host") or "127.0.0.1:9092"
    if isinstance(raw, list):
        return [str(x) for x in raw]
    return [p.strip() for p in str(raw).replace(";", ",").split(",") if p.strip()]


def _kafka_ping(config: dict) -> dict:
    try:
        from kafka import KafkaProducer
    except ImportError:
        return {"success": False, "message": "未安装 kafka-python，端口开放不能视为测通。请 pip install kafka-python"}
    brokers = _kafka_brokers(config)
    producer = KafkaProducer(bootstrap_servers=brokers, request_timeout_ms=8000)
    producer.close()
    return {"success": True, "message": "Kafka 连接成功"}


def _kafka_inspect(config: dict, job_cfg: dict) -> dict:
    try:
        from kafka import KafkaConsumer
    except ImportError:
        return _inspect_payload("kafka", [], message="未安装 kafka-python，无法列出 Topic。请 pip install kafka-python")
    consumer = KafkaConsumer(
        bootstrap_servers=_kafka_brokers(config),
        consumer_timeout_ms=3000,
        request_timeout_ms=8000,
    )
    try:
        tables = sorted(consumer.topics() or [])
    finally:
        consumer.close()
    configured = _topic(config, job_cfg)
    if configured and configured not in tables:
        tables = [configured, *tables]
    sample = _kafka_scan(config, {**job_cfg, "table": configured or (tables[0] if tables else "")}, limit=5) if (configured or tables) else []
    return _inspect_payload("kafka", tables, sample, "已从 Broker 列出 Topic" if tables else "Broker 上暂无 Topic")


def _kafka_consume(config: dict, job_cfg: dict) -> list[dict]:
    try:
        from kafka import KafkaConsumer
    except ImportError:
        _need("kafka-python", "kafka-python")
    topic = _topic(config, job_cfg)
    if not topic:
        raise RuntimeError("Kafka 缺少 topic")
    offset_reset = str(config.get("offset") or "latest")
    if job_cfg.get("sync_mode") == "incremental":
        offset_reset = "earliest"
    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=_kafka_brokers(config),
        group_id=str(job_cfg.get("groupId") or config.get("groupId") or "integration-platform"),
        enable_auto_commit=True,
        auto_offset_reset=offset_reset,
        consumer_timeout_ms=int(job_cfg.get("timeoutMs") or 4000),
        value_deserializer=lambda v: v,
        max_poll_records=_batch(job_cfg, config),
    )
    rows = []
    try:
        from kafka import TopicPartition

        partitions = consumer.partitions_for_topic(topic) or set()
        field = wm_field(job_cfg)
        wm_val = job_cfg.get("watermark_value")
        if wm_active(job_cfg) and field in ("_offset", "offset") and partitions:
            try:
                start = int(wm_val) + 1
                tps = [TopicPartition(topic, p) for p in partitions]
                consumer.assign(tps)
                for tp in tps:
                    consumer.seek(tp, start)
            except (TypeError, ValueError):
                pass
        for msg in consumer:
            rec = _as_dict(msg.value)
            rec["_offset"] = msg.offset
            rec["_timestamp"] = msg.timestamp
            rows.append(rec)
            if len(rows) >= _batch(job_cfg, config):
                break
    finally:
        consumer.close()
    if wm_active(job_cfg) and wm_field(job_cfg) not in ("_offset", "offset"):
        return filter_rows(rows, job_cfg)
    return rows


def _kafka_scan(config: dict, job_cfg: dict, limit: int = 400) -> list[dict]:
    try:
        from kafka import KafkaConsumer, TopicPartition
    except ImportError:
        return []
    topic = _topic(config, job_cfg)
    if not topic:
        return []
    consumer = KafkaConsumer(
        bootstrap_servers=_kafka_brokers(config),
        group_id=str(job_cfg.get("lookupGroupId") or "integration-lookup"),
        enable_auto_commit=False,
        auto_offset_reset="earliest",
        consumer_timeout_ms=2500,
        value_deserializer=lambda v: v,
    )
    rows = []
    try:
        parts = consumer.partitions_for_topic(topic) or set()
        tps = [TopicPartition(topic, p) for p in parts]
        if not tps:
            return []
        consumer.assign(tps)
        consumer.seek_to_beginning(*tps)
        for msg in consumer:
            rows.append(_as_dict(msg.value))
            if len(rows) >= limit:
                break
    finally:
        consumer.close()
    return rows


def _kafka_lookup(config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    want = {k: str(row.get(k, "")) for k in match_keys}
    found = None
    for rec in _kafka_scan(config, job_cfg, limit=400):
        if all(str(rec.get(k, "")) == want[k] for k in match_keys):
            found = rec
    return found


def _kafka_produce(config: dict, job_cfg: dict, row: dict) -> None:
    try:
        from kafka import KafkaProducer
    except ImportError:
        _need("kafka-python", "kafka-python")
    topic = _topic(config, job_cfg)
    if not topic:
        raise RuntimeError("Kafka 缺少 topic")
    producer = KafkaProducer(
        bootstrap_servers=_kafka_brokers(config),
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False, default=str).encode("utf-8"),
        acks=1,
        retries=2,
        request_timeout_ms=8000,
    )
    key = None
    match = job_cfg.get("match_keys") or []
    if match and row.get(match[0]) is not None:
        key = str(row.get(match[0])).encode("utf-8")
    producer.send(topic, value=row, key=key).get(timeout=8)
    producer.flush()
    producer.close()


# ----- RocketMQ：优先 HTTP 代理，其次官方客户端 -----
def _rocket_ping(config: dict) -> dict:
    endpoint = config.get("httpEndpoint") or config.get("http_endpoint")
    if endpoint:
        from urllib.request import urlopen

        urlopen(str(endpoint).rstrip("/") + "/topic", timeout=5)
        return {"success": True, "message": "RocketMQ HTTP 可达"}
    try:
        from rocketmq.client import Producer
    except ImportError:
        return {
            "success": False,
            "message": "未安装 rocketmq 客户端且未配置 httpEndpoint，NameServer 端口开放不能视为测通",
        }
    ns = str(config.get("nameServer") or "")
    if not ns:
        raise RuntimeError("缺少 nameServer")
    producer = Producer(str(config.get("group") or "integration-ping"))
    producer.set_name_server_address(ns)
    producer.start()
    producer.shutdown()
    return {"success": True, "message": "RocketMQ NameServer 连接成功"}


def _rocket_inspect(config: dict, job_cfg: dict) -> dict:
    tables: list[str] = []
    configured = _topic(config, job_cfg)
    if configured:
        tables.append(configured)
    endpoint = config.get("httpEndpoint") or config.get("http_endpoint")
    if endpoint:
        from urllib.request import urlopen

        try:
            with urlopen(str(endpoint).rstrip("/") + "/topic", timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8") or "[]")
            items = data
            if isinstance(data, dict):
                items = data.get("topics") or data.get("items") or data.get("data") or []
            if isinstance(items, list):
                for item in items:
                    name = item if isinstance(item, str) else (item or {}).get("topic") or (item or {}).get("name")
                    if name and name not in tables:
                        tables.append(str(name))
        except Exception as exc:
            return _inspect_payload("rocketmq", tables, message=f"RocketMQ 列举 Topic 失败: {exc}")
    message = "已列出 Topic" if tables else "未探测到 Topic，请填写 topic 或配置 httpEndpoint"
    return _inspect_payload("rocketmq", tables, [], message)


def _rocket_consume(config: dict, job_cfg: dict) -> list[dict]:
    endpoint = config.get("httpEndpoint")
    topic = _topic(config, job_cfg)
    if endpoint:
        from urllib.parse import urlencode
        from urllib.request import urlopen

        qs = urlencode({"topic": topic, "group": config.get("group") or "integration", "max": _batch(job_cfg, config)})
        with urlopen(str(endpoint).rstrip("/") + "/consume?" + qs, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
        if isinstance(data, dict):
            data = data.get("messages") or data.get("items") or []
        return [_as_dict(x) for x in data][: _batch(job_cfg, config)]
    try:
        from rocketmq.client import ConsumeStatus, PushConsumer
    except ImportError:
        _need("rocketmq", "rocketmq 或配置 httpEndpoint")
    rows: list[dict] = []
    consumer = PushConsumer(str(config.get("group") or "integration-platform"))
    consumer.set_name_server_address(str(config.get("nameServer")))
    n = _batch(job_cfg, config)

    def _cb(msg):
        rows.append(_as_dict(msg.body))
        return ConsumeStatus.CONSUME_SUCCESS

    consumer.subscribe(topic, _cb)
    consumer.start()
    import time

    deadline = time.time() + 4
    while time.time() < deadline and len(rows) < n:
        time.sleep(0.2)
    consumer.shutdown()
    return rows[:n]


def _rocket_lookup(config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    endpoint = config.get("httpEndpoint")
    topic = _topic(config, job_cfg)
    if not endpoint or not topic or not match_keys:
        return None
    from urllib.parse import urlencode
    from urllib.request import urlopen

    key = str(row.get(match_keys[0], ""))
    qs = urlencode({"topic": topic, "id": key, "key": key})
    try:
        with urlopen(str(endpoint).rstrip("/") + "/lookup?" + qs, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception:
        return None
    if isinstance(data, dict) and data.get("body"):
        return data["body"] if isinstance(data["body"], dict) else _as_dict(data["body"])
    if isinstance(data, dict) and (data.get("id") or data.get(match_keys[0])):
        return data
    return None


def _rocket_produce(config: dict, job_cfg: dict, row: dict) -> None:
    topic = _topic(config, job_cfg)
    body = json.dumps(row, ensure_ascii=False, default=str).encode("utf-8")
    endpoint = config.get("httpEndpoint")
    if endpoint:
        from urllib.request import Request, urlopen

        req = Request(
            str(endpoint).rstrip("/") + "/send",
            data=json.dumps({"topic": topic, "body": row}, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urlopen(req, timeout=8)
        return
    try:
        from rocketmq.client import Producer
    except ImportError:
        _need("rocketmq", "rocketmq 或配置 httpEndpoint")
    from rocketmq.client import Message

    producer = Producer(str(config.get("group") or "integration-producer"))
    producer.set_name_server_address(str(config.get("nameServer")))
    producer.start()
    msg = Message(topic)
    msg.set_body(body)
    producer.send_sync(msg)
    producer.shutdown()
