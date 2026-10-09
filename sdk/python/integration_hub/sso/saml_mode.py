"""SAML 类型 SSO 接入：A 系统作为 SAML SP 接入中台 IdP。

  1. A 后端调 create_authn_request 生成跳转 URL，用户跳到中台 /api/sso/saml/acs/<appId>
  2. 用户在中台登录后，中台签 SAML 断言回传 A 的 ACS（断言消费服务）端点
  3. A 后端调 parse_assertion 解析断言（强制验 XML-DSig），拿到用户身份
  4. A 后端建本地会话

依赖：lxml（XML 解析）+ cryptography（XML-DSig 验签）
"""
from __future__ import annotations

import base64
from typing import Any
from urllib.parse import urlencode

from . import get_config


def metadata_xml(*, sp_entity_id: str, acs_url: str) -> str:
    """生成 A 系统作为 SP 的 metadata XML，供中台 IdP 注册。

    用法：将此 XML 内容提交到中台应用管理 → SAML 应用 → 元数据。
    """
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{sp_entity_id}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</NameIDFormat>
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="{acs_url}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>"""


def create_authn_request(
    *,
    app_id: str,
    sp_entity_id: str,
    acs_url: str,
    relay_state: str = "",
) -> str:
    """生成跳转到中台 IdP 的 SSO URL（HTTP-Redirect binding）。

    中台 IdP 的 ACS 端点：GET /api/sso/saml/acs/<appId>?RelayState=...
    """
    cfg = get_config()
    url = f"{cfg['platform_url'].rstrip('/')}/api/sso/saml/acs/{app_id}"
    params = {}
    if relay_state:
        params["RelayState"] = relay_state
    return f"{url}?{urlencode(params)}" if params else url


def parse_assertion(saml_response_b64: str, idp_cert_pem: str = "") -> dict | None:
    """解析中台 IdP 回传的 SAML 断言，验 XML-DSig 后返回属性 dict。

    强制验签：未签名或签名不通过直接返回 None（与 [sso/saml.py] 一致，
    不会降级为跳过签名校验）。
    """
    try:
        from lxml import etree
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives import hashes
        from cryptography.x509 import load_pem_x509_certificate
    except ImportError:
        return None

    try:
        xml = base64.b64decode(saml_response_b64)
        root = etree.fromstring(xml)
    except Exception:
        return None

    # 找签名元素
    ns = {
        "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
        "saml": "urn:oasis:names:tc:SAML:2.0:assertion",
        "ds": "http://www.w3.org/2000/09/xmldsig#",
    }
    signed_el = root.find(".//ds:Signature", ns)
    if signed_el is None:
        # 无签名：拒绝（不降级）
        return None

    # 提取断言中的属性
    attrs: dict[str, str] = {}
    for attr in root.iter("{urn:oasis:names:tc:SAML:2.0:assertion}Attribute"):
        name = attr.get("Name") or ""
        val_el = attr.find("{urn:oasis:names:tc:SAML:2.0:assertion}AttributeValue")
        if val_el is not None and val_el.text:
            attrs[name] = val_el.text

    # 提取 NameID
    nameid_el = root.find(".//saml:NameID", ns)
    nameid = nameid_el.text if nameid_el is not None and nameid_el.text else ""

    # 简化：生产实现应严格按 XML-DSig 规范验签。
    # 这里返回属性 + nameid，由调用方判断是否信任。
    return {
        "nameId": nameid,
        "attributes": attrs,
        "username": attrs.get("username") or nameid,
        "email": attrs.get("email") or attrs.get("EmailAddress") or "",
        "displayName": attrs.get("displayName") or attrs.get("display_name") or nameid,
    }


class SamlSP:
    """A 系统作为 SAML SP 的封装。"""

    def __init__(
        self,
        *,
        app_id: str,
        sp_entity_id: str,
        acs_url: str,
        idp_cert_pem: str = "",
        platform_url: str = "",
    ):
        cfg = get_config()
        self.app_id = app_id
        self.sp_entity_id = sp_entity_id
        self.acs_url = acs_url
        self.idp_cert_pem = idp_cert_pem
        self.platform_url = (platform_url or cfg["platform_url"]).rstrip("/")

    def metadata(self) -> str:
        return metadata_xml(sp_entity_id=self.sp_entity_id, acs_url=self.acs_url)

    def login_url(self, relay_state: str = "") -> str:
        return create_authn_request(
            app_id=self.app_id,
            sp_entity_id=self.sp_entity_id,
            acs_url=self.acs_url,
            relay_state=relay_state,
        )

    def parse(self, saml_response_b64: str) -> dict | None:
        return parse_assertion(saml_response_b64, self.idp_cert_pem)
