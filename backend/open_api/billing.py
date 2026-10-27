"""按行计费：月度账单生成、金额计算、发票流转。"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from django.db.models import Sum
from django.utils import timezone

from open_api.models import BillingPlan, ClientUsageDaily, Invoice

logger = logging.getLogger(__name__)


def _month_range(month: str | None) -> tuple[date, date]:
    """'2026-10' → (2026-10-01, 2026-10-31)；None=本月"""
    if month is None:
        today = timezone.now().date()
        month = today.strftime("%Y-%m")
    year, m = month.split("-")
    start = date(int(year), int(m), 1)
    # 下月 1 号减一天
    if int(m) == 12:
        nxt = date(int(year) + 1, 1, 1)
    else:
        nxt = date(int(year), int(m) + 1, 1)
    end = nxt - timedelta(days=1)
    return start, end


def _invoiced_usage(client_id: str, month: str) -> tuple[int, int]:
    """从 ClientUsageDaily 聚合月度 rows / api_calls。"""
    start, end = _month_range(month)
    rows = ClientUsageDaily.objects.filter(
        client_id=client_id, day__gte=start, day__lte=end,
    ).aggregate(total=Sum("rows_written"))["total"] or 0
    calls = ClientUsageDaily.objects.filter(
        client_id=client_id, day__gte=start, day__lte=end,
    ).aggregate(total=Sum("api_calls"))["total"] or 0
    return int(rows), int(calls)


def compute_bill(plan: BillingPlan, month: str) -> dict:
    """根据计费套餐 + 月度用量计算账单。

    返回 camelCase dict，字段全部用 float / int，方便 DRF 直接 JSON 序列化。
    """
    rows, calls = _invoiced_usage(plan.client_id, month)
    invoiced_rows = max(rows - plan.free_rows_per_month, 0)
    invoiced_calls = max(calls - plan.free_api_calls_per_month, 0)

    rows_amount = Decimal(invoiced_rows) * plan.price_per_row
    api_amount = Decimal(invoiced_calls) * plan.price_per_api_call
    subtotal = plan.monthly_base_fee + rows_amount + api_amount
    tax = (subtotal * plan.tax_rate).quantize(Decimal("0.01"))
    total = (subtotal + tax).quantize(Decimal("0.01"))

    start, end = _month_range(month)
    return {
        "periodStart": start.isoformat(),
        "periodEnd": end.isoformat(),
        "rowsWritten": rows,
        "rowsInvoiced": invoiced_rows,
        "apiCalls": calls,
        "apiCallsInvoiced": invoiced_calls,
        "baseFee": float(plan.monthly_base_fee),
        "rowsAmount": float(rows_amount.quantize(Decimal("0.01"))),
        "apiCallsAmount": float(api_amount.quantize(Decimal("0.01"))),
        "taxAmount": float(tax),
        "subtotal": float(subtotal.quantize(Decimal("0.01"))),
        "totalAmount": float(total),
        "currency": plan.currency,
    }


def void_invoice(inv: Invoice, reason: str = "") -> Invoice:
    """作废账单。已支付账单不允许直接作废（需走红冲流程）。"""
    if inv.status == "paid":
        raise ValueError("已支付账单不可作废，请先线下确认后再处理")
    if inv.status == "void":
        return inv
    inv.status = "void"
    inv.voided_at = timezone.now()
    inv.void_reason = (reason or "")[:255]
    inv.save(update_fields=["status", "voided_at", "void_reason", "updated_at"])
    logger.info("账单已作废 inv=%s reason=%s", inv.id, reason)
    return inv


def pay_invoice(inv: Invoice) -> Invoice:
    """标记账单已支付。作废账单不可标记支付。"""
    if inv.status == "void":
        raise ValueError("已作废账单不可标记支付")
    if inv.status == "paid":
        return inv
    now = timezone.now()
    inv.status = "paid"
    inv.paid_at = now
    if not inv.issued_at:
        inv.issued_at = now
    inv.save(update_fields=["status", "paid_at", "issued_at", "updated_at"])
    logger.info("账单已支付 inv=%s total=%s", inv.id, inv.total_amount)
    return inv


def invoice_pdf_url(inv: Invoice) -> str:
    """账单 PDF 的对外绝对 URL（跟随 PUBLIC_API_PREFIX 部署口径）。"""
    from django.conf import settings

    base = getattr(settings, "PUBLIC_API_BASE_URL", "").rstrip("/") or "/api"
    return f"{base}/invoices/{inv.id}/pdf"


def _invoice_number(month: str, client_id: str) -> str:
    """账单号：INV-{月}-{客户端标识}。

    用 client.code（唯一短码）而不是 client_id 前缀——后者所有租户都是 ic_1a134…，
    会撞 invoice_number 唯一约束。缺失 code 时取 id 尾部。
    """
    from open_api.models import IntegrationClient

    client = IntegrationClient.objects.filter(id=client_id).first()
    raw = (client.code if client and client.code else client_id) or ""
    tag = "".join(ch for ch in raw.upper() if ch.isalnum())[-12:] or "CLIENT"
    return f"INV-{month}-{tag}"[:32]


def generate_invoice_pdf(inv: Invoice) -> bytes:
    """生成账单 PDF。中文使用 reportlab 内置 CID 字体 STSong-Light。"""
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    font_name = "STSong-Light"
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))
    except Exception:  # 字体已注册或环境不支持时降级为 Helvetica
        font_name = "Helvetica"

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"账单 {inv.invoice_number}", author="集成中台",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "InvTitle", parent=styles["Title"], fontName=font_name, fontSize=18, leading=24,
    )
    normal = ParagraphStyle("InvNormal", parent=styles["Normal"], fontName=font_name, fontSize=10, leading=16)

    status_label = {"draft": "草稿", "issued": "已开票", "paid": "已支付", "void": "已作废"}.get(inv.status, inv.status)
    story = [
        Paragraph("月度服务账单", title_style),
        Spacer(1, 6 * mm),
        Paragraph(f"账单号：{inv.invoice_number or inv.id}", normal),
        Paragraph(f"客户编号：{inv.client_id}", normal),
        Paragraph(f"账期：{inv.period_start.isoformat()} ~ {inv.period_end.isoformat()}", normal),
        Paragraph(f"状态：{status_label}", normal),
        Spacer(1, 6 * mm),
    ]

    money = f"{inv.currency} {float(inv.total_amount):.2f}"
    data = [
        ["项目", "数量", "金额"],
        ["月度基费", "-", f"{inv.currency} {float(inv.base_fee):.2f}"],
        [f"数据行写入（计费行 {inv.rows_invoiced} / 总行 {inv.rows_written}）", str(inv.rows_written), f"{inv.currency} {float(inv.rows_amount):.2f}"],
        [f"API 调用（计费次 {inv.api_calls_invoiced} / 总次 {inv.api_calls}）", str(inv.api_calls), f"{inv.currency} {float(inv.api_amount):.2f}"],
        ["税额", "-", f"{inv.currency} {float(inv.tax_amount):.2f}"],
        ["应付总额", "-", money],
    ]
    table = Table(data, colWidths=[88 * mm, 28 * mm, 40 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2FF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F8FAFC")),
        ("FONTNAME", (0, -1), (-1, -1), font_name),
    ]))
    story.append(table)
    story.append(Spacer(1, 8 * mm))

    if inv.status == "void" and inv.void_reason:
        story.append(Paragraph(f"作废原因：{inv.void_reason}", normal))
    if inv.paid_at:
        story.append(Paragraph(f"支付时间：{inv.paid_at.strftime('%Y-%m-%d %H:%M')}", normal))
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("该账单由集成中台按行计费引擎自动生成，如与用量明细不符请在 7 个工作日内提出核对。", normal))

    doc.build(story)
    return buf.getvalue()


def generate_monthly_invoices(month: str | None = None, client_id: str | None = None) -> list[Invoice]:
    """生成月度账单（每月 1 号 APScheduler 自动跑）。

    month: 默认上月 ('2026-09')；可手动指定
    client_id: None=全部 active plan；指定=只重算某个
    """
    if month is None:
        # 上月
        today = timezone.now().date()
        first_of_this = today.replace(day=1)
        last_of_prev = first_of_this - timedelta(days=1)
        month = last_of_prev.strftime("%Y-%m")

    qs = BillingPlan.objects.filter(status="active")
    if client_id:
        qs = qs.filter(client_id=client_id)

    invoices: list[Invoice] = []
    plan_period_start, plan_period_end = _month_range(month)
    for plan in qs:
        try:
            # 套餐生效期与账期无交集 → 该月不出账（避免套餐上线前 / 失效后多收钱）
            if plan.effective_from and plan.effective_from > plan_period_end:
                logger.info("套餐未生效跳过 client=%s month=%s effective_from=%s",
                            plan.client_id, month, plan.effective_from)
                continue
            if plan.effective_to and plan.effective_to < plan_period_start:
                logger.info("套餐已失效跳过 client=%s month=%s effective_to=%s",
                            plan.client_id, month, plan.effective_to)
                continue
            bill = compute_bill(plan, month)
            # compute_bill 返回 camelCase + float / int；
            # Invoice 模型是 snake_case，这里做显式映射。
            period_start_str = bill["periodStart"]  # ISO str
            # 用 date.fromisoformat 转回 date
            from datetime import date as _date
            period_start = _date.fromisoformat(period_start_str)
            period_end = _date.fromisoformat(bill["periodEnd"])

            inv = Invoice.objects.filter(
                client_id=plan.client_id,
                period_start=period_start,
            ).first()
            if inv and inv.status not in ("draft", "void"):
                logger.warning("账单已 issued/paid 跳过自动重算 inv=%s status=%s", inv.id, inv.status)
                invoices.append(inv)
                continue

            invoice_number = _invoice_number(month, plan.client_id)
            if inv:
                inv.rows_written = bill["rowsWritten"]
                inv.rows_invoiced = bill["rowsInvoiced"]
                inv.api_calls = bill["apiCalls"]
                inv.api_calls_invoiced = bill["apiCallsInvoiced"]
                inv.base_fee = Decimal(str(bill["baseFee"]))
                inv.rows_amount = Decimal(str(bill["rowsAmount"]))
                inv.api_amount = Decimal(str(bill["apiCallsAmount"]))
                inv.tax_amount = Decimal(str(bill["taxAmount"]))
                inv.total_amount = Decimal(str(bill["totalAmount"]))
                inv.period_end = period_end
                inv.currency = bill["currency"]
                inv.invoice_number = invoice_number
                inv.status = "issued"
                inv.issued_at = timezone.now()
                inv.voided_at = None
                inv.void_reason = ""
                inv.save()
                if not inv.pdf_url:
                    inv.pdf_url = invoice_pdf_url(inv)
                    inv.save(update_fields=["pdf_url"])
            else:
                inv = Invoice.objects.create(
                    client_id=plan.client_id,
                    invoice_number=invoice_number,
                    status="issued",
                    issued_at=timezone.now(),
                    period_start=period_start,
                    period_end=period_end,
                    rows_written=bill["rowsWritten"],
                    rows_invoiced=bill["rowsInvoiced"],
                    api_calls=bill["apiCalls"],
                    api_calls_invoiced=bill["apiCallsInvoiced"],
                    base_fee=Decimal(str(bill["baseFee"])),
                    rows_amount=Decimal(str(bill["rowsAmount"])),
                    api_amount=Decimal(str(bill["apiCallsAmount"])),
                    tax_amount=Decimal(str(bill["taxAmount"])),
                    total_amount=Decimal(str(bill["totalAmount"])),
                    currency=bill["currency"],
                )
                inv.pdf_url = invoice_pdf_url(inv)
                inv.save(update_fields=["pdf_url"])
            invoices.append(inv)
        except Exception as exc:
            logger.exception("账单生成失败 client_id=%s month=%s reason=%s", plan.client_id, month, exc)

    return invoices
