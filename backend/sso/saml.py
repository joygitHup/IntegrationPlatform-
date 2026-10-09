"""SAML 2.0 SP：HTTP-Redirect AuthnRequest + ACS 断言消费。"""
from __future__ import annotations

import base64
import zlib
from datetime import datetime, timezone as dt_timezone
from urllib.parse import urlencode
from urllib.request import urlopen
from xml.etree import ElementTree as ET

from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from core.exceptions import ApiError
from core.ids import generate_id
from core.public_urls import api_url
from sso.models import Application, SsoAuthnRequest

NS = {
    "md": "urn:oasis:names:tc:SAML:2.0:metadata",
    "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
    "saml": "urn:oasis:names:tc:SAML:2.0:assertion",
    "ds": "http://www.w3.org/2000/09/xmldsig#",
}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _find(el, names: tuple[str, ...]):
    if el is None:
        return None
    want = set(names)
    if _local(el.tag) in want:
        return el
    for child in list(el):
        hit = _find(child, names)
        if hit is not None:
            return hit
    return None


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def _all(el, name: str):
    if el is None:
        return []
    return [c for c in el.iter() if _local(c.tag) == name]


def acs_url(app: Application) -> str:
    return app.callback_url or api_url(f"/sso/saml/acs/{app.id}")


def parse_idp_metadata(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    sso = ""
    cert = ""
    entity = root.attrib.get("entityID") or ""
    for el in root.iter():
        loc = el.attrib.get("Location") or ""
        binding = el.attrib.get("Binding") or ""
        if _local(el.tag) in ("SingleSignOnService",) and loc:
            if "HTTP-Redirect" in binding or not sso:
                sso = loc
        if _local(el.tag) == "X509Certificate" and el.text and not cert:
            cert = "".join(el.text.split())
    return {"entityId": entity, "ssoUrl": sso, "cert": cert}


def load_idp(app: Application) -> dict:
    cached = (app.settings or {}).get("idp") if isinstance(app.settings, dict) else None
    if isinstance(cached, dict) and cached.get("ssoUrl"):
        return cached
    info = {"entityId": "", "ssoUrl": app.login_url, "cert": (app.saml_cert or "").replace(" ", "")}
    url = app.saml_idp_metadata_url
    if url:
        with urlopen(url, timeout=15) as resp:
            info = parse_idp_metadata(resp.read().decode("utf-8", "ignore"))
            if not info.get("ssoUrl"):
                info["ssoUrl"] = app.login_url
            if app.saml_cert:
                info["cert"] = "".join(app.saml_cert.split())
    return info


def deflate_b64(xml: str) -> str:
    compressor = zlib.compressobj(level=9, wbits=-15)
    raw = compressor.compress(xml.encode("utf-8")) + compressor.flush()
    return base64.b64encode(raw).decode("ascii")


def inflate_b64(data: str) -> str:
    raw = base64.b64decode(data)
    try:
        return zlib.decompress(raw, -15).decode("utf-8")
    except zlib.error:
        try:
            return zlib.decompress(raw).decode("utf-8")
        except zlib.error:
            return raw.decode("utf-8", "ignore")


def start_authn(app: Application, *, relay_state: str = "") -> dict:
    idp = load_idp(app)
    sso = idp.get("ssoUrl") or app.login_url
    if not sso:
        raise ApiError("未配置 IdP SSO 地址（loginUrl 或 IdP Metadata）", 400)
    req_id = "_" + generate_id("saml")
    entity_id = app.saml_sp_entity_id or api_url(f"/sso/saml/metadata/{app.id}")
    acs = acs_url(app)
    instant = datetime.now(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    xml = (
        f'<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" '
        f'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" '
        f'ID="{req_id}" Version="2.0" IssueInstant="{instant}" '
        f'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" '
        f'Destination="{sso}" AssertionConsumerServiceURL="{acs}">'
        f'<saml:Issuer>{entity_id}</saml:Issuer>'
        f'<samlp:NameIDPolicy AllowCreate="true" Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"/>'
        f"</samlp:AuthnRequest>"
    )
    SsoAuthnRequest.objects.create(
        request_id=req_id,
        app_id=app.id,
        relay_state=relay_state or "",
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    params = {"SAMLRequest": deflate_b64(xml)}
    if relay_state:
        params["RelayState"] = relay_state
    sep = "&" if "?" in sso else "?"
    url = f"{sso}{sep}{urlencode(params)}"
    return {
        "type": "saml",
        "url": url,
        "loginUrl": url,
        "relayState": relay_state,
        "authnRequestId": req_id,
        "entityId": entity_id,
        "acsUrl": acs,
        "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
    }


def saml_metadata_xml(app: Application) -> str:
    entity_id = app.saml_sp_entity_id or api_url(f"/sso/saml/metadata/{app.id}")
    acs = acs_url(app)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{entity_id}">'
        f'<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" '
        f'protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">'
        f'<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>'
        f'<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" '
        f'Location="{acs}" index="0" isDefault="true"/>'
        f"</md:SPSSODescriptor></md:EntityDescriptor>"
    )


def _parse_time(value: str):
    if not value:
        return None
    value = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def consume_response(app: Application, saml_response: str, *, relay_state: str = "", ip: str = "", user_agent: str = "") -> dict:
    from sso.engine import _create_session, record_sso_audit
    from monitor.metrics import observe_sso

    if not saml_response:
        raise ApiError("缺少 SAMLResponse", 400)
    try:
        xml = base64.b64decode(saml_response).decode("utf-8", "ignore")
    except Exception as exc:
        raise ApiError("SAMLResponse 不是合法 Base64", 400) from exc
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ApiError("SAMLResponse XML 无法解析", 400) from exc

    status = _find(root, ("StatusCode",))
    if status is not None:
        val = status.attrib.get("Value") or ""
        if val and "Success" not in val:
            raise ApiError(f"IdP 返回失败状态: {val}", 400)

    in_resp = root.attrib.get("InResponseTo") or ""
    pending = None
    if in_resp:
        pending = SsoAuthnRequest.objects.filter(request_id=in_resp, app_id=app.id, consumed=False).first()
        if not pending:
            raise ApiError("InResponseTo 与发出的 AuthnRequest 不匹配", 400)
        if pending.expires_at < timezone.now():
            raise ApiError("AuthnRequest 已过期", 400)
        pending.consumed = True
        pending.save(update_fields=["consumed"])

    dest = root.attrib.get("Destination") or ""
    acs = acs_url(app)
    if dest and dest.rstrip("/") != acs.rstrip("/"):
        raise ApiError("Destination 与 ACS 不匹配", 400)

    assertion = _find(root, ("Assertion",))
    if assertion is None:
        raise ApiError("SAMLResponse 中没有 Assertion", 400)

    conditions = _find(assertion, ("Conditions",))
    now = datetime.now(dt_timezone.utc)
    if conditions is not None:
        nb = _parse_time(conditions.attrib.get("NotBefore") or "")
        na = _parse_time(conditions.attrib.get("NotOnOrAfter") or "")
        if nb is not None:
            start = nb if nb.tzinfo else nb.replace(tzinfo=dt_timezone.utc)
            if now < start:
                raise ApiError("断言尚未生效", 400)
        if na is not None:
            until = na if na.tzinfo else na.replace(tzinfo=dt_timezone.utc)
            if now > until:
                raise ApiError("断言已过期", 400)
        audience = _text(_find(conditions, ("Audience",)))
        entity_id = app.saml_sp_entity_id or api_url(f"/sso/saml/metadata/{app.id}")
        if audience and audience not in (entity_id, app.code, app.id):
            raise ApiError("Audience 与 SP EntityID 不匹配", 400)

    _verify_required_signature(app, xml)

    name_id = _text(_find(assertion, ("NameID",)))
    attrs = {}
    for attr in _all(assertion, "Attribute"):
        name = attr.attrib.get("Name") or attr.attrib.get("FriendlyName") or ""
        values = [_text(v) for v in list(attr) if _local(v.tag) == "AttributeValue"]
        if name:
            attrs[name] = values[0] if len(values) == 1 else values
    user = _map_saml_user(app, name_id, attrs)
    session_id = _create_session(app, user, "saml", ip, user_agent, app.jwt_expires_in or 3600)
    record_sso_audit(
        app_id=app.id, app_name=app.name,
        user_id=getattr(user, "id", None) or user.get("id"),
        username=getattr(user, "username", None) or user.get("username"),
        event_type="login", login_type="saml", result="success",
        ip=ip, user_agent=user_agent, session_id=session_id,
        detail={"nameId": name_id},
    )
    observe_sso(login_type="saml", result="success")
    dest_url = app.login_url or ""
    if dest_url:
        sep = "&" if "?" in dest_url else "?"
        dest_url = f"{dest_url}{sep}sessionId={session_id}"
        rs = relay_state or (pending.relay_state if pending else "")
        if rs:
            dest_url += f"&RelayState={rs}"
    return {
        "type": "saml",
        "ok": True,
        "success": True,
        "appId": app.id,
        "sessionId": session_id,
        "relayState": relay_state or (pending.relay_state if pending else ""),
        "url": dest_url,
        "loginUrl": dest_url,
        "user": {
            "id": getattr(user, "id", None) or user.get("id"),
            "username": getattr(user, "username", None) or user.get("username"),
            "email": getattr(user, "email", None) or user.get("email"),
            "displayName": getattr(user, "display_name", None) or user.get("displayName"),
        },
        "nameId": name_id,
        "attributes": attrs,
    }


def _verify_required_signature(app: Application, xml: str) -> None:
    """必须配置 IdP 证书并校验 XML-DSig；未签名断言一律拒绝。"""
    cert_pem = (app.saml_cert or "").strip()
    if not cert_pem:
        try:
            idp = load_idp(app)
            cert_pem = idp.get("cert") or ""
        except Exception:
            cert_pem = ""
    if not cert_pem:
        raise ApiError("请配置 IdP 证书后再接收 SAML 断言。未签名或无法验签的断言一律拒绝。", 400)
    if "SignatureValue" not in xml and "<Signature" not in xml and "ds:Signature" not in xml:
        raise ApiError("断言未签名，已拒绝", 400)
    _verify_xml_signature(xml, cert_pem)


def _as_pem(cert: str) -> bytes:
    text = (cert or "").strip()
    if "BEGIN CERTIFICATE" in text:
        return text.encode("utf-8")
    body = "".join(text.split())
    wrapped = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----\n".encode("utf-8")


def _verify_xml_signature(xml: str, cert_pem: str) -> None:
    try:
        from lxml import etree
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, ec
        from cryptography.x509 import load_pem_x509_certificate
        import base64
        import hashlib
    except ImportError as exc:
        raise ApiError("校验 SAML 签名需要 lxml（已列入 requirements.txt，请 pip install lxml）。未安装 lxml 时拒绝所有 SAML 断言，不会降级为跳过签名校验。", 400) from exc

    try:
        root = etree.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
    except etree.XMLSyntaxError as exc:
        raise ApiError("SAML 断言 XML 无法解析", 400) from exc

    sig = root.find(".//{http://www.w3.org/2000/09/xmldsig#}Signature")
    if sig is None:
        raise ApiError("断言未包含 XML 签名", 400)
    signed_info = sig.find("{http://www.w3.org/2000/09/xmldsig#}SignedInfo")
    sig_val_el = sig.find("{http://www.w3.org/2000/09/xmldsig#}SignatureValue")
    if signed_info is None or sig_val_el is None or not (sig_val_el.text or "").strip():
        raise ApiError("签名节点不完整", 400)

    c14n_alg = ""
    canon = signed_info.find("{http://www.w3.org/2000/09/xmldsig#}CanonicalizationMethod")
    if canon is not None:
        c14n_alg = canon.attrib.get("Algorithm") or ""
    exclusive = "xml-exc-c14n" in c14n_alg or not c14n_alg
    signed_c14n = etree.tostring(signed_info, method="c14n", exclusive=exclusive, with_comments=False)
    sig_bytes = base64.b64decode("".join((sig_val_el.text or "").split()))
    cert = load_pem_x509_certificate(_as_pem(cert_pem))
    key = cert.public_key()
    sig_method = signed_info.find("{http://www.w3.org/2000/09/xmldsig#}SignatureMethod")
    alg = (sig_method.attrib.get("Algorithm") if sig_method is not None else "") or ""
    hash_alg = hashes.SHA1() if "sha1" in alg.lower() else hashes.SHA256()
    try:
        if hasattr(key, "verify") and not isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(sig_bytes, signed_c14n, padding.PKCS1v15(), hash_alg)
        else:
            key.verify(sig_bytes, signed_c14n, ec.ECDSA(hash_alg))
    except Exception as exc:
        raise ApiError("SAML 断言签名无效", 400) from exc

    ref = signed_info.find("{http://www.w3.org/2000/09/xmldsig#}Reference")
    digest_el = ref.find("{http://www.w3.org/2000/09/xmldsig#}DigestValue") if ref is not None else None
    if ref is None or digest_el is None:
        return
    uri = (ref.attrib.get("URI") or "").lstrip("#")
    target = root
    if uri:
        found = root.xpath(f"//*[@ID='{uri}']") or root.xpath(f"//*[@id='{uri}']")
        if found:
            target = found[0]
    work = etree.fromstring(etree.tostring(target))
    for nested in work.findall(".//{http://www.w3.org/2000/09/xmldsig#}Signature"):
        parent = nested.getparent()
        if parent is not None:
            parent.remove(nested)
    digest_alg_el = ref.find("{http://www.w3.org/2000/09/xmldsig#}DigestMethod")
    digest_alg = (digest_alg_el.attrib.get("Algorithm") if digest_alg_el is not None else "") or ""
    hashed = etree.tostring(work, method="c14n", exclusive=True, with_comments=False)
    digest = hashlib.sha1(hashed).digest() if "sha1" in digest_alg.lower() else hashlib.sha256(hashed).digest()
    expected = base64.b64decode("".join((digest_el.text or "").split()))
    if digest != expected:
        raise ApiError("SAML 断言摘要与签名不匹配", 400)


def _map_saml_user(app: Application, name_id: str, attrs: dict):
    from iam.models import User

    attr = (app.mapping_attribute or "").strip()
    username = ""
    if attr and attrs.get(attr):
        val = attrs.get(attr)
        username = val if isinstance(val, str) else (val[0] if val else "")
    if not username:
        for key in ("uid", "username", "mail", "email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"):
            val = attrs.get(key)
            if val:
                username = val if isinstance(val, str) else val[0]
                break
    username = username or name_id
    email = attrs.get("mail") or attrs.get("email") or ""
    if isinstance(email, list):
        email = email[0] if email else ""
    user = User.objects.filter(username=username).first()
    if not user and email:
        user = User.objects.filter(email=email).first()
    if user:
        return user
    return {
        "id": name_id or username,
        "username": username,
        "email": email,
        "displayName": attrs.get("displayName") or attrs.get("cn") or username,
    }
