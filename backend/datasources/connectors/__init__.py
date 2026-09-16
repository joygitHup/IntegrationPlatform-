# connectors package — 连接器在 registry 模块 import 时完成注册
from datasources.connectors.registry import (  # noqa: F401
    SENSITIVE_FIELDS,
    get_connector,
    list_connectors,
    test_connection,
)
