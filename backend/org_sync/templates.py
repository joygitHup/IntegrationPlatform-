"""5 个预置用户同步模板（通用 / HR / AD / 钉钉 / 企微）。"""

TEMPLATES = [
    {
        "id": "generic_user",
        "name": "通用用户同步",
        "description": "适用于大多数用户表到用户表的同步场景",
        "category": "generic",
        "defaultMatchKeys": ["username", "employee_id"],
        "defaultSensitiveFields": ["password", "mobile", "email", "id_card", "idCard"],
        "fieldMappings": [
            {"source": "username", "target": "username", "transform": "none", "required": True},
            {"source": "real_name", "target": "name", "transform": "none"},
            {"source": "email", "target": "email", "transform": "none"},
            {"source": "mobile", "target": "phone", "transform": "none"},
            {"source": "employee_id", "target": "employee_no", "transform": "none"},
            {"source": "department_id", "target": "dept_code", "transform": "none"},
            {"source": "position", "target": "position", "transform": "none"},
            {"source": "status", "target": "is_active", "transform": "custom", "params": {"expression": "value == 1 or value == 'active'"}},
        ],
        "statusMapping": {
            "sourceField": "status", "targetField": "is_active",
            "rules": [
                {"from": 1, "to": True, "label": "在职"},
                {"from": 0, "to": False, "label": "离职"},
                {"from": "active", "to": True, "label": "启用"},
                {"from": "inactive", "to": False, "label": "禁用"},
            ],
        },
    },
    {
        "id": "hr_to_oa",
        "name": "HR 系统 → OA 系统",
        "description": "从 HR 系统同步员工信息到 OA 办公系统",
        "category": "hr",
        "defaultMatchKeys": ["employee_id"],
        "defaultSensitiveFields": ["id_card", "mobile", "emergency_contact", "bank_card"],
        "fieldMappings": [
            {"source": "employee_id", "target": "staff_no", "transform": "none", "required": True},
            {"source": "name", "target": "real_name", "transform": "none", "required": True},
            {"source": "pinyin_name", "target": "username", "transform": "none"},
            {"source": "email", "target": "email", "transform": "none"},
            {"source": "mobile", "target": "mobile", "transform": "none"},
            {"source": "department_code", "target": "dept_id", "transform": "none"},
            {"source": "position_name", "target": "position", "transform": "none"},
            {"source": "entry_date", "target": "entry_time", "transform": "to_date"},
            {"source": "status", "target": "status", "transform": "none"},
        ],
        "statusMapping": {
            "sourceField": "employee_status", "targetField": "user_status",
            "rules": [
                {"from": "on_job", "to": "active", "label": "在职"},
                {"from": "probation", "to": "active", "label": "试用期"},
                {"from": "resigned", "to": "disabled", "label": "已离职"},
            ],
        },
    },
    {
        "id": "ad_to_app",
        "name": "AD 域 → 业务系统",
        "description": "从 Active Directory 同步用户到业务系统",
        "category": "generic",
        "defaultMatchKeys": ["sAMAccountName", "userPrincipalName"],
        "defaultSensitiveFields": ["unicodePwd", "userPassword", "telephoneNumber"],
        "fieldMappings": [
            {"source": "sAMAccountName", "target": "username", "transform": "none", "required": True},
            {"source": "displayName", "target": "name", "transform": "none"},
            {"source": "mail", "target": "email", "transform": "none"},
            {"source": "telephoneNumber", "target": "phone", "transform": "none"},
            {"source": "department", "target": "department", "transform": "none"},
            {"source": "title", "target": "title", "transform": "none"},
        ],
        "statusMapping": {
            "sourceField": "userAccountControl", "targetField": "is_active",
            "rules": [
                {"from": 512, "to": True, "label": "正常账号"},
                {"from": 514, "to": False, "label": "已禁用"},
            ],
        },
    },
    {
        "id": "dingtalk_user",
        "name": "钉钉 → 业务系统",
        "description": "从钉钉通讯录同步用户",
        "category": "im",
        "defaultMatchKeys": ["userid", "mobile"],
        "defaultSensitiveFields": ["mobile", "email", "avatar"],
        "fieldMappings": [
            {"source": "userid", "target": "username", "transform": "none", "required": True},
            {"source": "name", "target": "display_name", "transform": "none"},
            {"source": "mobile", "target": "phone", "transform": "none"},
            {"source": "email", "target": "email", "transform": "none"},
            {"source": "dept_id_list", "target": "dept_ids", "transform": "none"},
            {"source": "title", "target": "position", "transform": "none"},
            {"source": "job_number", "target": "employee_no", "transform": "none"},
        ],
        "statusMapping": {
            "sourceField": "active", "targetField": "is_active",
            "rules": [
                {"from": True, "to": True, "label": "在职"},
                {"from": False, "to": False, "label": "离职"},
            ],
        },
    },
    {
        "id": "wecom_user",
        "name": "企业微信 → 业务系统",
        "description": "从企业微信通讯录同步用户",
        "category": "im",
        "defaultMatchKeys": ["userid", "mobile"],
        "defaultSensitiveFields": ["mobile", "email", "telephone"],
        "fieldMappings": [
            {"source": "userid", "target": "username", "transform": "none", "required": True},
            {"source": "name", "target": "display_name", "transform": "none"},
            {"source": "mobile", "target": "phone", "transform": "none"},
            {"source": "email", "target": "email", "transform": "none"},
            {"source": "department", "target": "dept_ids", "transform": "none"},
            {"source": "position", "target": "position", "transform": "none"},
            {"source": "enable", "target": "is_active", "transform": "custom", "params": {"expression": "value == 1 or value == True"}},
        ],
        "statusMapping": {
            "sourceField": "status", "targetField": "is_active",
            "rules": [
                {"from": 1, "to": True, "label": "已激活"},
                {"from": 2, "to": False, "label": "已禁用"},
                {"from": 4, "to": False, "label": "未激活"},
            ],
        },
    },
]


def list_templates(category: str | None = None) -> list[dict]:
    if not category:
        return TEMPLATES
    return [t for t in TEMPLATES if t["category"] == category]


def get_template(template_id: str) -> dict | None:
    return next((t for t in TEMPLATES if t["id"] == template_id), None)


def status_mapping_rule(status_mapping: dict | None) -> dict | None:
    if not isinstance(status_mapping, dict):
        return None
    src = str(status_mapping.get("sourceField") or "").strip()
    tgt = str(status_mapping.get("targetField") or "").strip()
    rules = status_mapping.get("rules")
    if not src or not tgt or not isinstance(rules, list) or not rules:
        return None
    return {
        "source": src,
        "target": tgt,
        "transform": "statusMap",
        "params": {"rules": rules},
    }


def merge_status_mapping(mappings: list | None, status_mapping: dict | None) -> list:
    extra = status_mapping_rule(status_mapping)
    result = [dict(m) for m in (mappings or []) if isinstance(m, dict)]
    if not extra:
        return result
    replaced = False
    for item in result:
        if str(item.get("target") or "") == extra["target"]:
            item["source"] = extra["source"]
            item["transform"] = "statusMap"
            item["params"] = extra["params"]
            replaced = True
            break
    if not replaced:
        result.append(extra)
    return result


def apply_template(template_id: str, overrides: dict | None = None) -> dict:
    overrides = overrides or {}
    tpl = get_template(template_id)
    if not tpl:
        return {
            "template": None,
            "fieldMappings": overrides.get("fieldMappings") or [],
            "matchKeys": overrides.get("matchKeys") or ["id"],
            "sensitiveFields": overrides.get("sensitiveFields") or [],
            "statusMapping": None,
        }
    mappings = overrides.get("fieldMappings") or list(tpl["fieldMappings"])
    return {
        "template": tpl,
        "fieldMappings": merge_status_mapping(mappings, tpl.get("statusMapping")),
        "matchKeys": overrides.get("matchKeys") or tpl["defaultMatchKeys"],
        "sensitiveFields": overrides.get("sensitiveFields") or tpl["defaultSensitiveFields"],
        "statusMapping": tpl.get("statusMapping"),
    }
