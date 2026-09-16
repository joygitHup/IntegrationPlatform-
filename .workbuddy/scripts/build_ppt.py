# -*- coding: utf-8 -*-
"""
生成《集成中台 · 产品介绍》PPTX。
配色与字体严格遵循 DESIGN.md（去渐变、去毛玻璃、单一主蓝）。
"""
import math
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn

# ---------------- palette (DESIGN.md) ----------------
NAVY      = RGBColor(0x0e, 0x1b, 0x2e)
NAVY_2    = RGBColor(0x15, 0x27, 0x40)
NAVY_3    = RGBColor(0x18, 0x33, 0x59)   # 章节页水印数字
PRIMARY   = RGBColor(0x25, 0x63, 0xeb)
PRIMARY_D = RGBColor(0x1d, 0x4e, 0xd8)
PRIMARY_1 = RGBColor(0xdb, 0xea, 0xfe)
PRIMARY_0 = RGBColor(0xef, 0xf6, 0xff)
BLUE_400  = RGBColor(0x60, 0xa5, 0xfa)
BLUE_300  = RGBColor(0x93, 0xc5, 0xfd)
BLUE_500  = RGBColor(0x3b, 0x82, 0xf6)
SUCCESS   = RGBColor(0x16, 0xa3, 0x4a)
SUCCESS_0 = RGBColor(0xf0, 0xfd, 0xf4)
SUCCESS_1 = RGBColor(0xdc, 0xfc, 0xe7)
SUCCESS_D = RGBColor(0x15, 0x80, 0x3d)
WARNING   = RGBColor(0xd9, 0x77, 0x06)
WARNING_0 = RGBColor(0xff, 0xfb, 0xeb)
WARNING_1 = RGBColor(0xfe, 0xf3, 0xc7)
WARNING_D = RGBColor(0x92, 0x40, 0x0e)
DANGER    = RGBColor(0xdc, 0x26, 0x26)
DANGER_0  = RGBColor(0xfe, 0xf2, 0xf2)
DANGER_D  = RGBColor(0xb9, 0x1c, 0x1c)
MUTED     = RGBColor(0x64, 0x74, 0x8b)
MUTED_2   = RGBColor(0x94, 0xa3, 0xb8)
INK       = RGBColor(0x0f, 0x17, 0x2a)
INK_2     = RGBColor(0x33, 0x41, 0x55)
LINE      = RGBColor(0xe2, 0xe8, 0xf0)
LINE_2    = RGBColor(0xf1, 0xf5, 0xf9)
WHITE     = RGBColor(0xff, 0xff, 0xff)
BG_BASE   = RGBColor(0xf8, 0xfa, 0xfc)
SLATE_400 = RGBColor(0x94, 0xa3, 0xb8)
SLATE_500 = RGBColor(0x64, 0x74, 0x8b)
SLATE_600 = RGBColor(0x47, 0x55, 0x69)
SLATE_700 = RGBColor(0x33, 0x41, 0x55)

FONT = "Microsoft YaHei"
MONO = "Consolas"

W, H = 13.333, 7.5
ML, MR = 0.85, 0.85
CW = W - ML - MR          # 11.633

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]


# ---------------- primitives ----------------
def hexstr(c):
    return "%02X%02X%02X" % (c[0], c[1], c[2])


def set_run(run, text=None, size=None, bold=None, color=None, font=None,
            italic=None, spacing=None):
    if text is not None:
        run.text = text
    f = run.font
    if size is not None:
        f.size = Pt(size)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if color is not None:
        f.color.rgb = color
    name = font or FONT
    f.name = name
    rPr = run._r.get_or_add_rPr()
    if spacing is not None:
        rPr.set('spc', str(int(spacing * 100)))
    latin = rPr.find(qn('a:latin'))
    prev = latin
    for tag in ('a:ea', 'a:cs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {'typeface': name})
            if prev is not None:
                prev.addnext(el)
            else:
                rPr.append(el)
        else:
            el.set('typeface', name)
        prev = el


def rect(slide, x, y, w, h, fill=None, line=None, lw=0.75, rounded=False,
         adj=0.10):
    shp = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    if rounded:
        try:
            shp.adjustments[0] = adj
        except Exception:
            pass
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(lw)
    shp.shadow.inherit = False
    return shp


def para_txt(p, runs, align=None, line_spacing=None, space_after=None,
             space_before=None):
    if align is not None:
        p.alignment = align
    if line_spacing is not None:
        p.line_spacing = line_spacing
    if space_after is not None:
        p.space_after = Pt(space_after)
    if space_before is not None:
        p.space_before = Pt(space_before)
    for r in runs:
        run = p.add_run()
        set_run(run, **r)
    return p


def tb(slide, x, y, w, h, paras, align=PP_ALIGN.LEFT,
       anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        pr = dict(para)
        runs = pr.pop('runs')
        para_txt(p, runs, **pr)
    return box


def kicker(slide, text, y=0.50, x=ML, color=PRIMARY):
    bar = rect(slide, x, y + 0.055, 0.19, 0.028, fill=color)
    box = tb(slide, x + 0.28, y, CW - 0.28, 0.26,
             [{'runs': [{'text': text.upper(), 'size': 10.5, 'bold': True,
                         'color': color, 'spacing': 1.4}]}])
    return bar, box


def headline(slide, text, y=0.80, size=25, color=INK, x=ML, w=None,
             max_lines=2):
    return tb(slide, x, y, w or CW, 0.62 * max_lines,
              [{'runs': [{'text': text, 'size': size, 'bold': True,
                          'color': color}], 'line_spacing': 1.15}])


def subhead(slide, text, y=1.36, size=12.5, color=MUTED, x=ML, w=None,
            h=0.7):
    return tb(slide, x, y, w or CW, h,
              [{'runs': [{'text': text, 'size': size, 'color': color}],
                'line_spacing': 1.45}])


def footer(slide, num, dark=False, brand="集成中台 · 产品介绍"):
    if dark:
        line_c, brand_c, num_c = NAVY_2, SLATE_600, SLATE_600
    else:
        line_c, brand_c, num_c = LINE_2, MUTED_2, MUTED_2
    rect(slide, ML, 6.98, CW, 0.012, fill=line_c)
    tb(slide, ML, 7.09, 6.0, 0.22,
       [{'runs': [{'text': brand, 'size': 9, 'bold': True, 'color': brand_c}]}])
    tb(slide, W - MR - 2.0, 7.09, 2.0, 0.22,
       [{'runs': [{'text': str(num), 'size': 9, 'color': num_c,
                   'font': MONO}], 'align': PP_ALIGN.RIGHT}])


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def new_slide():
    return prs.slides.add_slide(BLANK)


def card(slide, x, y, w, h, title, body, val=None, dot=PRIMARY, fill=WHITE,
         border=LINE, tsize=12.5, bsize=10.5, vsize=10, pad=0.22, rounded=True):
    rect(slide, x, y, w, h, fill=fill, line=border, rounded=rounded, adj=0.055)
    cy = y + pad
    tx = x + pad
    tw = w - 2 * pad
    if title:
        d = rect(slide, tx, cy + 0.055, 0.095, 0.095, fill=dot, rounded=True,
                 adj=0.5) if dot else None
        off = 0.24 if dot else 0.0
        tb(slide, tx + off, cy, tw - off, 0.30,
           [{'runs': [{'text': title, 'size': tsize, 'bold': True,
                       'color': INK}], 'line_spacing': 1.2}])
        cy += 0.34
    if body:
        lines = est_lines(body, bsize, tw)
        bh = lines * LH(bsize, 1.42)
        tb(slide, tx, cy, tw, bh,
           [{'runs': [{'text': body, 'size': bsize, 'color': MUTED}],
             'line_spacing': 1.42}])
        cy += bh
    if val:
        vl = est_lines(val, vsize, tw)
        vh = vl * LH(vsize, 1.4)
        rect(slide, tx, cy + 0.11, tw, 0.010, fill=LINE)
        tb(slide, tx, cy + 0.21, tw, vh,
           [{'runs': [{'text': val, 'size': vsize, 'bold': True,
                       'color': PRIMARY_D}], 'line_spacing': 1.4}])
        cy += 0.21 + vh
    if cy + 0.14 > y + h:
        FIT_WARNINGS.append('card overflow @(%.2f,%.2f) need=%.2f h=%.2f :: %s'
                            % (x, y, cy - y + 0.14, h, (title or '')[:26]))


def est_w(text, size):
    wd = 0.0
    for ch in text:
        if ord(ch) > 0x2E80:
            wd += size / 72.0
        else:
            wd += size / 72.0 * 0.545
    return wd


def est_lines(text, size, box_w):
    """粗略估算文本占几行"""
    total = est_w(text, size)
    n = max(1, int(math.ceil(total / max(box_w - 0.04, 0.5))))
    return n


def LH(size, ls=1.42):
    """单行实际高度（英寸）"""
    return size * 1.22 * ls / 72.0


FIT_WARNINGS = []


def chip_flow(slide, x, y, w, labels, size=8.5, ch=0.235, gap=0.065,
              fill=BG_BASE, border=LINE, fg=INK_2, line_h=0.30):
    cx, cy = x, y
    for lb in labels:
        cw = est_w(lb, size) + 0.20
        if cx + cw > x + w and cx > x:
            cx = x
            cy += line_h
        sh = rect(slide, cx, cy, cw, ch, fill=fill, line=border, rounded=True,
                  adj=0.30)
        tf = sh.text_frame
        tf.word_wrap = False
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        para_txt(tf.paragraphs[0], [{'text': lb, 'size': size, 'color': fg}],
                 align=PP_ALIGN.CENTER)
        cx += cw + gap
    return cy + ch


def callout(slide, x, y, w, text, kind='info', size=10.5, h=None):
    cmap = {'info': (PRIMARY_0, PRIMARY, RGBColor(0x1e, 0x3a, 0x8a)),
            'warn': (WARNING_0, WARNING, WARNING_D)}
    bg, accent, fg = cmap[kind]
    lines = est_lines(text, size, w - 0.45)
    hh = h or (0.26 + lines * LH(size, 1.45))
    rect(slide, x, y, w, hh, fill=bg, rounded=False)
    rect(slide, x, y, 0.035, hh, fill=accent)
    tb(slide, x + 0.22, y + 0.13, w - 0.44, hh - 0.26,
       [{'runs': [{'text': text, 'size': size, 'color': fg}],
         'line_spacing': 1.45}])


def section(slide, big, title, sub_text, num, brand):
    rect(slide, 0, 0, W, H, fill=NAVY)
    tb(slide, ML, 2.02, 4.0, 1.4,
       [{'runs': [{'text': big, 'size': 84, 'bold': True, 'color': NAVY_3}]}])
    tb(slide, ML, 3.42, 10.6, 0.75,
       [{'runs': [{'text': title, 'size': 30, 'bold': True, 'color': WHITE}],
         'line_spacing': 1.22}])
    rect(slide, ML, 4.26, 0.58, 0.032, fill=PRIMARY)
    tb(slide, ML, 4.54, 8.4, 0.8,
       [{'runs': [{'text': sub_text, 'size': 13, 'color': SLATE_400}],
         'line_spacing': 1.5}])
    footer(slide, num, dark=True, brand=brand)


def hex_pts(cx, cy, rx, ry):
    pts = []
    for ang in (90, 30, -30, -90, -150, 150):
        a = math.radians(ang)
        pts.append((cx + rx * math.cos(a), cy - ry * math.sin(a)))
    return pts


def draw_net(slide, cx, cy, rx, ry, mode):
    pts = hex_pts(cx, cy, rx, ry)
    if mode == 'p2p':
        lc, nc = RGBColor(0xfc, 0xa5, 0xa5), DANGER
        tc = RGBColor(0x99, 0x1b, 0x1b)
        for i in range(6):
            for j in range(i + 1, 6):
                ln = slide.shapes.add_connector(
                    MSO_CONNECTOR.STRAIGHT, Inches(pts[i][0]), Inches(pts[i][1]),
                    Inches(pts[j][0]), Inches(pts[j][1]))
                ln.line.color.rgb = lc
                ln.line.width = Pt(0.9)
    else:
        lc, nc = BLUE_500, PRIMARY
        tc = PRIMARY_D
        for p in pts:
            ln = slide.shapes.add_connector(
                MSO_CONNECTOR.STRAIGHT, Inches(p[0]), Inches(p[1]),
                Inches(cx), Inches(cy))
            ln.line.color.rgb = lc
            ln.line.width = Pt(1.1)
    d = 0.30
    for i, (px, py) in enumerate(pts):
        s = rect(slide, px - d / 2, py - d / 2, d, d, fill=WHITE, line=nc,
                 lw=1.1, rounded=True, adj=0.5)
        tf = s.text_frame
        tf.word_wrap = False
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        para_txt(tf.paragraphs[0],
                 [{'text': 'S%d' % (i + 1), 'size': 7.5, 'bold': True,
                   'color': tc}], align=PP_ALIGN.CENTER)
    if mode == 'hub':
        rect(slide, cx - 0.46, cy - 0.28, 0.92, 0.56, fill=PRIMARY,
             rounded=True, adj=0.16)
        tb(slide, cx - 0.46, cy - 0.21, 0.92, 0.5,
           [{'runs': [{'text': '中台', 'size': 9.5, 'bold': True,
                       'color': WHITE}], 'align': PP_ALIGN.CENTER,
             'line_spacing': 1.0},
            {'runs': [{'text': 'HUB', 'size': 7, 'color': PRIMARY_1,
                       'font': MONO}], 'align': PP_ALIGN.CENTER}])


def set_cell_border(cell, edge, color, width_pt=0.75):
    tcPr = cell._tc.get_or_add_tcPr()
    tag = {'T': 'a:lnT', 'B': 'a:lnB', 'L': 'a:lnL', 'R': 'a:lnR'}[edge]
    for el in tcPr.findall(qn(tag)):
        tcPr.remove(el)
    ln = tcPr.makeelement(qn(tag), {'w': str(int(width_pt * 12700)),
                                    'cap': 'flat', 'cmpd': 'sng',
                                    'algn': 'ctr'})
    fill = ln.makeelement(qn('a:solidFill'), {})
    clr = fill.makeelement(qn('a:srgbClr'), {'val': hexstr(color)})
    fill.append(clr)
    ln.append(fill)
    tcPr.insert(0, ln)


def cell_fill(cell, color):
    cell.fill.solid()
    cell.fill.fore_color.rgb = color


def cell_text(cell, text, size=10, bold=False, color=INK_2, align=PP_ALIGN.LEFT):
    cell.text_frame.word_wrap = True
    cell.margin_left = Inches(0.07)
    cell.margin_right = Inches(0.07)
    cell.margin_top = Inches(0.03)
    cell.margin_bottom = Inches(0.03)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    para_txt(cell.text_frame.paragraphs[0],
             [{'text': text, 'size': size, 'bold': bold, 'color': color}],
             align=align, line_spacing=1.25)


# =========================================================
# 01 封面
# =========================================================
s = new_slide()
rect(s, 0, 0, W, H, fill=NAVY)
draw_net(s, 10.95, 3.62, 1.42, 1.42, 'hub')
rect(s, 1.0, 1.60, 0.24, 0.24, fill=PRIMARY, rounded=True, adj=0.22)
tb(s, 1.36, 1.62, 6.0, 0.26,
   [{'runs': [{'text': 'INTEGRATION PLATFORM', 'size': 10.5, 'bold': True,
               'color': BLUE_400, 'spacing': 1.6}]}])
tb(s, 1.0, 2.10, 9.0, 1.75,
   [{'runs': [{'text': '集成中台', 'size': 42, 'bold': True, 'color': WHITE}],
     'line_spacing': 1.12},
    {'runs': [{'text': '让系统之间只连一次', 'size': 42, 'bold': True,
               'color': WHITE}], 'line_spacing': 1.12}])
tb(s, 1.0, 3.90, 8.2, 0.9,
   [{'runs': [{'text': '统一承接数据集成、身份单点、组织同步与对外开放服务。',
               'size': 13.5, 'color': SLATE_400}], 'line_spacing': 1.5},
    {'runs': [{'text': '新增一个系统，增加的不是 N 条接口，而是 1 条接入。',
               'size': 13.5, 'color': SLATE_400}], 'line_spacing': 1.5}])
chips = ['数据集成', '执行引擎与可靠性', '身份与 SSO',
         '组织用户同步', '开放 API 门面', '可观测与审计']
chip_flow(s, 1.0, 4.98, 10.6, chips, size=10, ch=0.30, line_h=0.38,
          fill=RGBColor(0x16, 0x2a, 0x44), border=RGBColor(0x2c, 0x4a, 0x74),
          fg=RGBColor(0xbf, 0xdb, 0xfe))
rect(s, 1.0, 6.55, 11.05, 0.012, fill=NAVY_2)
tb(s, 1.0, 6.72, 7.0, 0.24,
   [{'runs': [{'text': '产品介绍 · 面向技术评估与业务决策', 'size': 9.5,
               'color': SLATE_600}]}])
tb(s, 6.0, 6.72, 6.05, 0.24,
   [{'runs': [{'text': '26 类内置连接器 · 全部能力均为已落地模块',
               'size': 9.5, 'color': SLATE_600}], 'align': PP_ALIGN.RIGHT}])
notes(s, '开场 30 秒：不说产品，先说结论——"今天讲的不是又一个系统，而是让系统之间只连一次"。'
         '留出时间观察反应，如果对方点头，说明痛点对得上。全程不要念这一页，直接翻页。')

# =========================================================
# 02 议程
# =========================================================
s = new_slide()
kicker(s, 'Agenda')
headline(s, '今天只回答三个问题')
subhead(s, '不逐条念功能。我们把顺序倒过来——先看你们现在付出的代价，再看产品怎么把这个代价降下来，'
           '最后看怎么在你的环境里验证它。')
gap = 0.22
cw3 = (CW - 2 * gap) / 3
items = [
    ('01', '为什么需要集成中台',
     '点对点集成在系统数量增长时的成本曲线，以及被隐藏的运维代价。',
     '对应页：集成现状 → 代价拆解'),
    ('02', '它是什么，能做什么',
     '产品定位与七项核心能力，每项都落到「你能少做什么」。',
     '对应页：定位 → 架构 → 七项能力 → 安全'),
    ('03', '怎么落到你这里',
     '交付节奏对比、角色分工、四步上线路径与验证方式。',
     '对应页：效率对比 → 角色 → 落地路径 → 下一步'),
]
for i, (no, t, b, v) in enumerate(items):
    x = ML + i * (cw3 + gap)
    y = 2.30
    h = 3.05
    rect(s, x, y, cw3, h, fill=BG_BASE, line=LINE, rounded=True, adj=0.05)
    tb(s, x + 0.26, y + 0.26, cw3 - 0.52, 0.55,
       [{'runs': [{'text': no, 'size': 27, 'bold': True, 'color': PRIMARY}]}])
    tb(s, x + 0.26, y + 0.95, cw3 - 0.52, 0.6,
       [{'runs': [{'text': t, 'size': 13.5, 'bold': True, 'color': INK}],
         'line_spacing': 1.25}])
    tb(s, x + 0.26, y + 1.62, cw3 - 0.52, 0.95,
       [{'runs': [{'text': b, 'size': 10.5, 'color': MUTED}],
         'line_spacing': 1.45}])
    rect(s, x + 0.26, y + 2.50, cw3 - 0.52, 0.010, fill=LINE)
    tb(s, x + 0.26, y + 2.62, cw3 - 0.52, 0.32,
       [{'runs': [{'text': v, 'size': 9.5, 'bold': True, 'color': PRIMARY_D}],
         'line_spacing': 1.35}])
callout(s, ML, 5.62, CW,
        '沟通原则：我们会明确说出产品不做什么。凡是没有落地的扩展方向'
        '（如 CDC 实时捕获、K8s 自动扩缩容），本次不会作为能力介绍。')
footer(s, '02')
notes(s, '这一页唯一的作用是降低对方防备。念完第三点后停顿，看谁会问"那你们不做什么"——'
         '一旦有人问，主动权就回到我们手里。')

# =========================================================
# 03 章节一
# =========================================================
s = new_slide()
section(s, '01', '问题不在接口本身\u3000在接口的数量',
        '当系统从 3 个变成 8 个，工作量不是涨 2.7 倍，而是涨 9 倍——因为连线是两两组合。',
        3, '01 / 集成现状')
notes(s, '章节页停留不超过 5 秒。')

# =========================================================
# 04 N×N
# =========================================================
s = new_slide()
kicker(s, '成本结构')
headline(s, '点对点：链路的数量是平方级的')
subhead(s, '同样是 6 个系统互相打通，两种做法要维护的链路数量差 2.5 倍；到 8 个系统，差距拉到 3.5 倍。',
        h=0.55)
pw = (CW - 0.25) / 2
py, ph = 2.12, 3.28
for i, (cap, mode, metric, mc) in enumerate([
        ('手工点对点 · 系统两两直连', 'p2p',
         '6 个系统 = 15 条链路 · 8 个系统 = 28 条', DANGER),
        ('经中台枢纽 · 星型接入', 'hub',
         '6 个系统 = 6 条链路 · 8 个系统 = 8 条', SUCCESS)]):
    x = ML + i * (pw + 0.25)
    rect(s, x, py, pw, ph, fill=BG_BASE, line=LINE, rounded=True, adj=0.05)
    tb(s, x + 0.24, py + 0.20, pw - 0.48, 0.26,
       [{'runs': [{'text': cap, 'size': 11.5, 'bold': True, 'color': INK}]}])
    draw_net(s, x + pw / 2, py + 1.72, 1.62, 1.02, mode)
    rect(s, x + 0.24, py + 2.72, pw - 0.48, 0.010, fill=LINE)
    tb(s, x + 0.24, py + 2.86, pw - 0.48, 0.28,
       [{'runs': [{'text': metric, 'size': 11, 'bold': True, 'color': mc,
                   'font': MONO}]}])
callout(s, ML, 5.60, CW,
        '关键差别：点对点方案每新增 1 个系统，要新增 N 条链路并重测 N 个对接方；'
        '枢纽方案只新增 1 条接入，其余系统完全不动。')
footer(s, '04')
notes(s, '把"15 条 vs 6 条"写在白板上比讲更快。可以现场问对方："你们现在有多少个系统要打通？"'
         '然后当场算给他看——这是最容易产生共鸣的一页。')

# =========================================================
# 05 四类代价
# =========================================================
s = new_slide()
kicker(s, '代价拆解')
headline(s, '真正的成本，发生在连线之后')
subhead(s, '连线数量只是账面成本。以下四项才是集成方案上线后持续消耗团队精力的地方。', h=0.5)
gap2 = 0.22
cw2 = (CW - gap2) / 2
costs = [
    (WARNING, '交付慢：每条链路都是一次小项目',
     '取数口径确认、接口开发、双方联调、测试验证，每一步都要两个团队同时在场。',
     '业务后果：新系统上线要排期等待，IT 变成瓶颈。'),
    (DANGER, '故障黑盒：失败之后只能人工补',
     '同步失败通常只留下日志。没有失败数据的滞留区，没有原样重放，也没有可回退的版本快照。',
     '业务后果：数据不一致要靠人肉核对，问题反复发生。'),
    (WARNING, '口径散落：字段映射写死在代码里',
     '同一个「客户编码」在不同系统的转换规则，分散在各系统的代码与配置中，没有统一视图。',
     '业务后果：改一个口径要动多个系统，还说不清谁改的。'),
    (DANGER, '身份孤岛：账号各管一套',
     '员工入职要逐个系统开号，离职要逐个系统关闭；跨系统跳转要重新登录，权限变更无审计。',
     '业务后果：离职账号残留是合规风险，跨系统体验差。'),
]
for i, (dotc, t, b, v) in enumerate(costs):
    x = ML + (i % 2) * (cw2 + gap2)
    y = 2.16 + (i // 2) * 2.32
    card(s, x, y, cw2, 2.12, t, b, v, dot=dotc, fill=WHITE, tsize=12,
         bsize=10.5, vsize=10)
footer(s, '05')
notes(s, '四类代价按对方最痛的那一条展开讲，其余三条快速带过。通常是"故障黑盒"或"交付慢"命中率最高。'
         '注意：这里只描述现象，不要提前说产品能解决——留到第二章。')

# =========================================================
# 06 章节二
# =========================================================
s = new_slide()
section(s, '02', '它是什么\u3000以及它明确不是什么',
        '先把边界说清楚，后面的能力介绍才有意义。', 6, '02 / 定位与能力')
notes(s, '这一页的"明确不是什么"是差异化钩子，不要跳过。')

# =========================================================
# 07 定位
# =========================================================
s = new_slide()
kicker(s, '产品定位')
headline(s, '它是枢纽，不是第 N+1 个业务系统')
subhead(s, '中台自身不承载业务，只提供集成服务。它把「系统之间怎么连」这件事，从各业务系统的代码里抽出来，'
           '集中成可配置、可监控、可审计的能力。', h=0.7)
pos = [
    ('控制台与 API 分离',
     '运营在控制台完成资产登记、任务配置、授权与监控；业务方只通过 API 调用能力，不接触控制台。'),
    ('面向集成商的一把钥匙',
     '对外开放服务采用 API Key 门面。集成商用 Key 接入应用、数据、消息与身份，无需了解中台内部结构。'),
    ('资源可见性可控',
     '密钥只能看见「自己创建的」和「被运营指派给它」的资产，天然支持多集成商共存的隔离。'),
]
for i, (t, b) in enumerate(pos):
    x = ML + i * (cw3 + gap)
    rect(s, x, 2.28, cw3, 2.25, fill=BG_BASE, line=LINE, rounded=True, adj=0.06)
    rect(s, x + 0.26, 2.54, 0.095, 0.095, fill=PRIMARY, rounded=True, adj=0.5)
    tb(s, x + 0.48, 2.49, cw3 - 0.74, 0.55,
       [{'runs': [{'text': t, 'size': 12.5, 'bold': True, 'color': INK}],
         'line_spacing': 1.25}])
    tb(s, x + 0.26, 3.12, cw3 - 0.52, 1.2,
       [{'runs': [{'text': b, 'size': 10.5, 'color': MUTED}],
         'line_spacing': 1.45}])
callout(s, ML, 4.76, CW,
        '一句话价值主张：接入中台之后，你的业务系统需要对接的不是 N 个其他系统，而是 1 套集成能力。',
        size=11)
tb(s, ML, 5.48, CW, 0.3,
   [{'runs': [{'text': '说明：本页描述的是产品定位，非部署形态承诺。部署方式见第 20 页。',
               'size': 9.5, 'color': MUTED_2}]}])
footer(s, '07')
notes(s, '"不是第 N+1 个系统"这句话要慢一点说。很多客户最担心的就是"又给我加一套系统要运维"。')

# =========================================================
# 08 架构
# =========================================================
s = new_slide()
kicker(s, 'Architecture')
headline(s, '产品全景：七层能力，一套配置模型')
subhead(s, '从底层连接器到上层开放门面，所有能力共用同一套数据源、任务与执行模型——'
           '这是「配置替代开发」能够成立的前提。', h=0.5)
layers = [
    ('接入层', PRIMARY, RGBColor(0x25, 0x63, 0xeb),
     '数据库 ×8  ·  API ×2  ·  文件 ×4  ·  SaaS ×8  ·  消息 ×4      ——  共 26 类内置连接器'),
    ('引擎层', BLUE_500, RGBColor(0x3b, 0x82, 0xf6),
     'ETL 抽取 → 转换 → 装载  ·  DAG 多步编排  ·  Cron / 事件 / Webhook 调度  ·  队列（开发内存 / 生产 Celery）'),
    ('治理层', RGBColor(0x0e, 0xa5, 0xe9), RGBColor(0x0e, 0xa5, 0xe9),
     '字段映射与转换  ·  死信滞留与人工决裁  ·  版本快照回滚  ·  字段变更审计  ·  失败重试 / 回执 / 告警'),
    ('身份层', SUCCESS, SUCCESS,
     'SSO：JWT / Ticket / OAuth2 / SAML  ·  跨系统免登跳转  ·  组织与用户同步  ·  会话管理与吊销'),
    ('开放层', WARNING, WARNING,
     'API Key 门面  ·  OpenAPI 3.0 + Swagger UI  ·  Python / TypeScript SDK  ·  入站 Webhook  ·  幂等键'),
    ('可观测', SLATE_500, SLATE_500,
     '仪表盘统计与趋势  ·  Prometheus 指标  ·  操作审计  ·  环境 / Workspace 隔离'),
    ('底座', INK, INK,
     'PostgreSQL  ·  Redis（生产队列）  ·  Celery Worker（生产）  ·  AES-256-CBC 加密存储'),
]
ly, lh, lgap = 2.12, 0.535, 0.145
for i, (name, lc, tc, body) in enumerate(layers):
    y = ly + i * (lh + lgap)
    rect(s, ML, y, 1.06, lh, fill=lc, rounded=True, adj=0.14)
    tb(s, ML, y + 0.14, 1.06, 0.28,
       [{'runs': [{'text': name, 'size': 10.5, 'bold': True, 'color': WHITE}],
         'align': PP_ALIGN.CENTER}])
    rect(s, ML + 1.18, y, CW - 1.18, lh, fill=BG_BASE, line=LINE,
         rounded=True, adj=0.14)
    tb(s, ML + 1.42, y + 0.155, CW - 1.70, 0.30,
       [{'runs': [{'text': body, 'size': 9.5, 'color': INK_2}]}])
footer(s, '08')
notes(s, '这页信息密度高，讲的时候不要念层名。只说一句："所有能力共用同一套数据源、任务与执行模型"'
         '——然后直接翻到能力页。第 3 层"治理层"是后面失败演示的伏笔。')

# =========================================================
# 09 能力一 数据集成
# =========================================================
s = new_slide()
kicker(s, '能力 01 / 数据集成')
headline(s, '26 类连接器，一套接入方式')
subhead(s, '不论对接的是数据库、开放接口、文件、SaaS 还是消息队列，登记、测连、探测表结构、配映射的流程完全一致。'
           '团队只需要学一次。', h=0.5)
cw4 = (CW - 3 * 0.20) / 4
groups = [
    ('数据库', '8', ['MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', '达梦',
                     '人大金仓', 'MongoDB', 'Elasticsearch'], None),
    ('接口', '2', ['HTTP / REST API', 'Webhook'],
     'Webhook 既可作写入目标，也可按 URL 拉取作为抽取源。'),
    ('文件', '4', ['SFTP', 'FTP', 'S3 兼容存储', 'CSV / Excel'], None),
    ('消息队列', '4', ['Kafka', 'RabbitMQ', 'RocketMQ', 'Redis'],
     '可作源或目标参与同步管道。'),
]
for i, (name, cnt, chips_, note_) in enumerate(groups):
    x = ML + i * (cw4 + 0.20)
    y = 2.06
    h = 2.42
    rect(s, x, y, cw4, h, fill=WHITE, line=LINE, rounded=True, adj=0.06)
    tb(s, x + 0.20, y + 0.19, cw4 - 0.7, 0.26,
       [{'runs': [{'text': name, 'size': 12, 'bold': True, 'color': INK}]}])
    bs = rect(s, x + cw4 - 0.68, y + 0.17, 0.48, 0.26, fill=BG_BASE,
              line=LINE, rounded=True, adj=0.35)
    para_txt(bs.text_frame.paragraphs[0],
             [{'text': cnt, 'size': 9, 'bold': True, 'color': MUTED}],
             align=PP_ALIGN.CENTER)
    bs.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    chip_flow(s, x + 0.20, y + 0.56, cw4 - 0.40, chips_, size=8.5, ch=0.24,
              line_h=0.30)
    if note_:
        tb(s, x + 0.20, y + 1.78, cw4 - 0.40, 0.5,
           [{'runs': [{'text': note_, 'size': 9, 'color': MUTED}],
             'line_spacing': 1.4}])
three = [
    ('全量与增量',
     '全量重刷，或按水位字段做增量过滤。SQL、MongoDB、Elasticsearch、HTTP 等按水位过滤后再抽取。'),
    ('测连不造假',
     '连通性测试走协议级校验。未实现专用协议测试的类型，不会因为端口开着就返回成功——'
     '避免「配置看着对、上线才发现连不上」。'),
    ('一行 Key 交付',
     '运营在控制台创建的数据源与任务，可直接指派给某个集成商的密钥，对方立即可见可调用。'),
]
for i, (t, b) in enumerate(three):
    x = ML + i * (cw3 + gap)
    card(s, x, 4.66, cw3, 1.62, t, b, dot=PRIMARY, fill=BG_BASE, tsize=11.5,
         bsize=9.5)
tb(s, ML, 6.44, CW, 0.3,
   [{'runs': [{'text': '另有 8 类 SaaS 连接器（LDAP / AD / SCIM / 钉钉 / 企微 / 飞书 / 用友 U8 / 纷享销客），'
                       '详见下一页。', 'size': 9.5, 'color': MUTED_2}]}])
footer(s, '09')
notes(s, '重点讲"测连不造假"这一条——它是技术可信度锚点。可以说："我们没有为了让演示好看而把测连做成'
         '端口探测，没实现协议级测试的类型会如实返回未支持。"')

# =========================================================
# 10 能力二 映射
# =========================================================
s = new_slide()
kicker(s, '能力 02 / 映射与转换')
headline(s, '把口径从代码里拿出来，放进可审计的配置')
subhead(s, '映射规则是集成项目里最容易失控的部分。这里提供的是配置化、可预览、可复用的映射模型。', h=0.5)
x = ML
w2 = cw2
rect(s, x, 2.06, w2, 2.32, fill=WHITE, line=LINE, rounded=True, adj=0.05)
rect(s, x + 0.24, 2.34, 0.095, 0.095, fill=PRIMARY, rounded=True, adj=0.5)
tb(s, x + 0.46, 2.29, w2 - 0.7, 0.3,
   [{'runs': [{'text': '映射与转换能力', 'size': 12, 'bold': True,
               'color': INK}]}])
chip_flow(s, x + 0.24, 2.70, w2 - 0.48,
          ['直接映射', '类型转换', '默认值填充', '自定义表达式', '状态码映射'],
          size=9, ch=0.26, line_h=0.33, fill=PRIMARY_0, border=PRIMARY_1,
          fg=PRIMARY_D)
tb(s, x + 0.24, 3.18, w2 - 0.48, 0.7,
   [{'runs': [{'text': '内置字符串处理（去空格、大小写、拼接、截取、替换）、编解码、数值与日期转换等常用转换，'
                       '复杂场景可用自定义表达式。', 'size': 10, 'color': MUTED}],
     'line_spacing': 1.45}])
rect(s, x + 0.24, 3.94, w2 - 0.48, 0.010, fill=LINE)
tb(s, x + 0.24, 4.04, w2 - 0.48, 0.32,
   [{'runs': [{'text': '嵌套字段通过点号路径读写，不必为层级结构单独写适配代码。',
               'size': 9.5, 'bold': True, 'color': PRIMARY_D}],
     'line_spacing': 1.35}])

x2 = ML + w2 + gap2
rect(s, x2, 2.06, w2, 2.32, fill=WHITE, line=LINE, rounded=True, adj=0.05)
rect(s, x2 + 0.24, 2.34, 0.095, 0.095, fill=SUCCESS, rounded=True, adj=0.5)
tb(s, x2 + 0.46, 2.29, w2 - 0.7, 0.3,
   [{'runs': [{'text': '预置同步模板', 'size': 12, 'bold': True, 'color': INK}]}])
tb(s, x2 + 0.24, 2.70, w2 - 0.48, 0.62,
   [{'runs': [{'text': '内置 5 套用户同步模板，覆盖扁平字段、HR、AD 域、钉钉、企业微信等典型形态，'
                       '包含字段对应关系与状态映射规则。', 'size': 10, 'color': MUTED}],
     'line_spacing': 1.45}])
chip_flow(s, x2 + 0.24, 3.28, w2 - 0.48,
          ['通用用户同步', 'HR → OA', 'AD 域 → 业务系统', '钉钉 → 业务系统',
           '企业微信 → 业务系统'],
          size=8.5, ch=0.24, line_h=0.31, fill=SUCCESS_0, border=SUCCESS_1,
          fg=SUCCESS_D)
rect(s, x2 + 0.24, 3.94, w2 - 0.48, 0.010, fill=LINE)
tb(s, x2 + 0.24, 4.04, w2 - 0.48, 0.32,
   [{'runs': [{'text': '价值：常规同步场景不必从零配映射，直接套模板再按需覆盖。',
               'size': 9.5, 'bold': True, 'color': PRIMARY_D}],
     'line_spacing': 1.35}])

bot = [
    ('落库之前先看结果',
     '映射预览会先用真实数据跑一遍转换，把「源字段 → 目标字段」的实际结果摊开给你确认，再进入正式写入。',
     '业务后果：口径错配在预览阶段就被拦住，而不是数据写坏之后才发现。'),
    ('状态码不是字符串问题',
     '在职 / 离职 / 试用 / 禁用这类业务语义，用一组显式映射规则表达，而不是散落在各处的 if-else。',
     '业务后果：人员状态口径统一，下游系统不再各自解释。'),
]
for i, (t, b, v) in enumerate(bot):
    x = ML + i * (w2 + gap2)
    card(s, x, 4.54, w2, 1.92, t, b, v, dot=PRIMARY, fill=BG_BASE,
         tsize=11.5, bsize=10, vsize=9.5)
footer(s, '10')
notes(s, '如果现场有数据工程角色，这页要展开讲"映射预览"。可以主动问："你们现在改一个字段口径，'
         '要经过几个系统、几个人？"')

# =========================================================
# 11 能力三 执行引擎
# =========================================================
s = new_slide()
kicker(s, '能力 03 / 执行引擎')
headline(s, '失败不是异常情况，是常态——所以我们按常态设计')
subhead(s, '集成方案能不能托付，看的不是成功路径跑多快，而是失败之后能不能定位、能不能恢复、能不能追溯。',
        h=0.5)
top3 = [
    ('可编排：DAG 多步任务',
     '一个任务可拆成多个步骤，用依赖关系声明先后顺序，在任务页用画布完成编排；运行后在执行监控里逐步查看状态。',
     '价值：复杂同步不再塞进一个巨型脚本。', PRIMARY),
    ('可恢复：死信与人工决裁',
     '失败数据进入死信区并做脱敏处理。可原样重处理、可忽略，也可以修正字段后重新落库。',
     '价值：坏数据不再只能靠人工补数。', WARNING),
    ('可追溯：快照与字段审计',
     '保留版本快照，可按需回滚；字段级变更留痕，能回答「这个值是谁、什么时候改的」。',
     '价值：数据被改坏时可回退，责任可界定。', SUCCESS),
]
for i, (t, b, v, dc) in enumerate(top3):
    x = ML + i * (cw3 + gap)
    card(s, x, 2.06, cw3, 2.28, t, b, v, dot=dc, fill=WHITE, tsize=11.5,
         bsize=10, vsize=9.5)
bot3 = [
    ('不把空跑当成功', '抽取 0 行不会被记成一次成功执行。静默的数据断流会被暴露出来。'),
    ('重试与回执', '可配置失败重试次数与间隔；任务完成可回调通知业务系统，不必轮询。'),
    ('防回环', '双向同步场景下携带来源标记与跳数控制，避免数据在两个系统之间无限反弹。'),
]
for i, (t, b) in enumerate(bot3):
    x = ML + i * (cw3 + gap)
    card(s, x, 4.54, cw3, 1.92, t, b, dot=PRIMARY, fill=BG_BASE, tsize=11.5,
         bsize=9.5)
footer(s, '11')
notes(s, '这是全篇最重要的一页。建议在这里配合"失败演示"：刻意让一次同步失败，然后现场走'
         '死信 → 决裁 → 重放。客户记住的往往是这一段，而不是成功路径。')

# =========================================================
# 12 能力四 SSO
# =========================================================
s = new_slide()
kicker(s, '能力 04 / 身份与应用集成')
headline(s, '一次登录，跨系统通行')
subhead(s, '把应用纳管进中台，由中台统一签发身份凭证，业务系统之间不再各自维护一套账号体系。', h=0.5)
t2 = [
    ('统一登录与跨系统跳转',
     '支持 JWT 与 Ticket 两种凭证形态，「来源系统 → 中台 → 目标系统」三段式免登跳转，'
     '目标系统只需实现一次凭证校验。',
     '业务后果：用户不再为跳转系统重复输密码，体验与安全同时改善。'),
    ('标准协议双支持',
     '既支持 OAuth2 授权码 + PKCE，也支持 SAML 单点登录；平台自身同时可作为授权服务器对外提供授权能力。',
     '业务后果：新老系统都能纳入同一登录体系，不必为协议差异做取舍。'),
]
for i, (t, b, v) in enumerate(t2):
    x = ML + i * (w2 + gap2)
    card(s, x, 2.06, w2, 2.12, t, b, v, dot=PRIMARY, fill=WHITE, tsize=12,
         bsize=10.5, vsize=9.5)
b2 = [
    ('SAML 不放过未签名断言',
     '接入 SAML 需要配置 IdP 证书，ACS 环节强制校验 XML 数字签名。未签名的断言会被直接拒绝，'
     '同时校验响应关联性、受众与有效期后才建立会话。',
     '价值：这是安全团队会重点追问的一条，建议在演示时现场打开配置项。'),
    ('会话可看、可吊销、可审计',
     '提供活跃会话列表与吊销操作，登录行为进入审计日志。',
     '业务后果：账号异常时有处置手段，事后有记录可查。'),
]
for i, (t, b, v) in enumerate(b2):
    x = ML + i * (w2 + gap2)
    card(s, x, 4.34, w2, 2.12, t, b, v, dot=SUCCESS, fill=BG_BASE,
         tsize=12, bsize=10.5, vsize=9.5)
footer(s, '12')
notes(s, '"未签名断言会被直接拒绝"这句话要说给安全团队听。如果有安全评审在场，'
         '建议现场打开 SAML 配置页，展示 IdP 证书必填。')

# =========================================================
# 13 能力五 组织同步
# =========================================================
s = new_slide()
kicker(s, '能力 05 / 组织与用户同步')
headline(s, '把人理顺：从通讯录到部门树')
subhead(s, '组织数据是所有权限体系的地基。中台把「从各平台拉通讯录、还原成部门树、再同步到业务系统」'
           '变成一条可重复执行的任务。', h=0.6)
t3 = [
    ('多来源拉取', '可从钉钉、企业微信、AD 域、LDAP 拉取用户与部门。既可作为独立的通讯录同步任务，'
                   '也可作为普通数据同步任务的抽取源。'),
    ('部门树还原', '同步结果落成部门层级与「人-部门」关系，可按任务查询完整组织树，供下游系统直接消费。'),
    ('模板化 + 状态映射', '5 套预置模板覆盖典型场景；人员状态（在职、离职、试用期、禁用）通过显式规则映射。'),
]
for i, (t, b) in enumerate(t3):
    x = ML + i * (cw3 + gap)
    card(s, x, 2.14, cw3, 2.06, t, b, dot=PRIMARY, fill=WHITE, tsize=11.5,
         bsize=10)
b3 = [
    ('敏感字段脱敏',
     '支持多种脱敏规则，并能按字段名称智能识别手机号、证件号、银行卡等敏感项。',
     '价值：组织数据常含个人信息，脱敏可在任务层统一策略，而不是靠各系统自觉。'),
    ('入职离职自动流转',
     '状态变化随同步自动落到下游系统，减少「人走了账号还在」的残留。',
     '业务后果：账号生命周期与人事流程对齐，降低合规风险。'),
]
for i, (t, b, v) in enumerate(b3):
    x = ML + i * (w2 + gap2)
    card(s, x, 4.44, w2, 2.02, t, b, v, dot=SUCCESS, fill=BG_BASE, tsize=11.5,
         bsize=10, vsize=9.5)
footer(s, '13')
notes(s, '脱敏和"人走了账号还在"是合规话题，命中 HR 与内审。如果参会方有内审角色，这页多留 2 分钟。')

# =========================================================
# 14 能力六 开放服务
# =========================================================
s = new_slide()
kicker(s, '能力 06 / 开放服务')
headline(s, '把集成能力变成一把可以发放的钥匙')
subhead(s, '这是本产品在设计上最有辨识度的一点：集成能力不是只能由内部团队使用，'
           '而是可以标准化地交付给外部集成商。', h=0.55)
o1 = [
    ('自助开通 + 受控授权',
     '集成商可通过公开接口自助开通沙箱密钥；正式资源由运营在控制台登记后指派。密钥完整值只返回一次。'),
    ('可见性边界清晰',
     '密钥只能访问「本凭证创建的」与「运营明确指派给它的」应用、数据源、任务与执行记录。'
     '未指派的控制台资产对密钥不可见。'),
]
for i, (t, b) in enumerate(o1):
    x = ML + i * (w2 + gap2)
    rect(s, x, 2.10, w2, 2.05, fill=WHITE, line=LINE, rounded=True, adj=0.055)
    rect(s, x + 0.24, 2.36, 0.095, 0.095, fill=PRIMARY, rounded=True, adj=0.5)
    tb(s, x + 0.46, 2.31, w2 - 0.7, 0.3,
       [{'runs': [{'text': t, 'size': 12, 'bold': True, 'color': INK}]}])
    tb(s, x + 0.24, 2.72, w2 - 0.48, 0.9,
       [{'runs': [{'text': b, 'size': 10, 'color': MUTED}], 'line_spacing': 1.45}])
    if i == 0:
        chip_flow(s, x + 0.24, 3.52, w2 - 0.48,
                  ['IP 白名单', '每分钟限流', '失败告警邮箱 / Webhook', '密钥轮换与吊销'],
                  size=8.5, ch=0.24, line_h=0.31)
    else:
        rect(s, x + 0.24, 3.62, w2 - 0.48, 0.010, fill=LINE)
        tb(s, x + 0.24, 3.72, w2 - 0.48, 0.32,
           [{'runs': [{'text': '业务后果：多集成商可共享一套中台，而业务数据互不可见。',
                       'size': 9.5, 'bold': True, 'color': PRIMARY_D}]}])
o3 = [
    ('对接成本低', '提供 OpenAPI 3.0 规范与 Swagger UI，可直接生成客户端；'
                   '官方 Python 与 TypeScript SDK 开箱可用。'),
    ('入口双向', '既能主动调用中台能力，也能通过入站 Webhook 把数据推进来。'),
    ('重放安全', '支持幂等键，网络重试不会造成数据重复写入。'),
]
for i, (t, b) in enumerate(o3):
    x = ML + i * (cw3 + gap)
    card(s, x, 4.36, cw3, 1.55, t, b, dot=PRIMARY, fill=BG_BASE, tsize=11,
         bsize=9.5)
callout(s, ML, 6.06, CW,
        '演示建议：现场用一段脚本完成「自助开通密钥 → 登记数据源 → 触发同步 → 查看执行记录」的闭环，'
        '比逐条讲接口更有说服力。', size=10)
footer(s, '14')
notes(s, '如果对方是平台型公司或有生态伙伴体系，这页价值最大。'
         '"发一个 Key"这个类比可以直接用。')

# =========================================================
# 15 能力七 可观测
# =========================================================
s = new_slide()
kicker(s, '能力 07 / 可观测与治理')
headline(s, '看得见，才敢把生产数据托付出去')
subhead(s, '集成中台处在数据链路的关键位置，它的可观测性直接决定团队敢不敢用它承载核心数据。', h=0.5)
obs = [
    ('仪表盘', '汇总统计与执行趋势，任务健康度一眼可见。'),
    ('标准指标', '提供 Prometheus 格式指标接口，可接入你现有的监控与告警体系，不必另建一套。'),
    ('操作审计', '增删改操作全部留痕，配合字段级变更审计形成完整链路。'),
    ('多环境隔离', '区分开发 / 预发 / 生产环境，并支持按 Workspace 维度隔离，请求维度即可切换。'),
]
for i, (t, b) in enumerate(obs):
    x = ML + i * (cw4 + 0.20)
    card(s, x, 2.06, cw4, 2.02, t, b, dot=PRIMARY, fill=WHITE, tsize=11.5,
         bsize=9.5)
ob2 = [
    ('执行记录不是一行日志',
     '每条执行记录包含状态、耗时、影响行数与失败原因；DAG 任务可下钻到每个步骤的状态。',
     '价值：排障从「翻日志猜原因」变成「看记录定位步骤」。'),
    ('告警走你已有的通道',
     '任务失败可配置邮件告警；密钥层面还可配置失败通知的邮箱或 Webhook。',
     '价值：不需要为了这个系统新建一套运维流程。'),
]
for i, (t, b, v) in enumerate(ob2):
    x = ML + i * (w2 + gap2)
    card(s, x, 4.30, w2, 2.02, t, b, v, dot=SUCCESS, fill=BG_BASE, tsize=11.5,
         bsize=10, vsize=9.5)
footer(s, '15')
notes(s, '"接入你现有的监控体系，不必另建一套"——这句话对运维负责人最有杀伤力。')

# =========================================================
# 16 安全
# =========================================================
s = new_slide()
kicker(s, 'Security')
headline(s, '安全能力清单（可直接交给安全团队评审）')
subhead(s, '这一页按安全评审的常见提问顺序组织。每一条都对应产品中已实现的机制，不是路线图。', h=0.45)
rows = [
    ('凭据存储', '数据源密码等敏感字段使用 AES-256-CBC 加密后落库', '数据库中不出现明文凭据'),
    ('账号密码', 'bcrypt 哈希存储；创建与改密强制强度校验（长度、字符组合、禁用弱密码）',
     '登录环节不套用该强度策略，避免锁定历史账号'),
    ('暴力破解防护', '登录失败按来源 IP 限流（每分钟 5 次）', '与 API Key 的每分钟限流相互独立'),
    ('会话与令牌', '访问令牌 8 小时、刷新令牌 7 天；会话列表支持主动吊销', '异常登录可即时处置'),
    ('权限模型', '基于角色的访问控制（RBAC），角色与权限可维护', '控制台操作与密钥调用两套边界分别管控'),
    ('接口鉴权', '控制台走 JWT；开放服务走 API Key，支持 IP 白名单与限流', '对外能力可按集成商粒度收敛'),
    ('单点登录安全', 'SAML 强制 IdP 证书并校验 XML 数字签名，未签名断言拒绝',
     '同时校验响应关联性、受众与有效期'),
    ('审计追溯', '增删改操作审计 + 字段级变更审计 + 登录审计', '满足事后责任界定需要'),
    ('注入防护', '数据访问层统一使用参数化查询', '业务代码不拼接 SQL 字符串'),
    ('传输加密', '生产环境部署于 HTTPS 之下', '由部署环节保障，不依赖应用层自行实现'),
]
gf = s.shapes.add_table(len(rows) + 1, 3, Inches(ML), Inches(2.02),
                        Inches(CW), Inches(4.68))
tbl = gf.table
tbl.first_row = False
tbl.horz_banding = False
try:
    tblPr = tbl._tbl.tblPr
    for el in tblPr.findall(qn('a:tableStyleId')):
        tblPr.remove(el)
except Exception:
    pass
tbl.columns[0].width = Inches(1.55)
tbl.columns[1].width = Inches(5.55)
tbl.columns[2].width = Inches(CW - 1.55 - 5.55)
tbl.rows[0].height = Inches(0.34)
hdr = ['评审维度', '实现方式', '说明']
for j, htxt in enumerate(hdr):
    c = tbl.cell(0, j)
    cell_fill(c, BG_BASE)
    cell_text(c, htxt, size=9.5, bold=True, color=MUTED)
    set_cell_border(c, 'B', LINE, 0.75)
for i, row in enumerate(rows, start=1):
    tbl.rows[i].height = Inches(0.43)
    for j, txt in enumerate(row):
        c = tbl.cell(i, j)
        cell_fill(c, WHITE)
        cell_text(c, txt, size=9.5, bold=(j == 0),
                  color=INK if j == 0 else (INK_2 if j == 1 else MUTED))
        if i < len(rows):
            set_cell_border(c, 'B', LINE_2, 0.75)
footer(s, '16')
notes(s, '强烈建议这一页打印出来带到现场。演示到第 23 分钟左右，把纸质版推到桌子中间——'
         '比说十遍"我们很安全"管用。')

# =========================================================
# 17 章节三
# =========================================================
s = new_slide()
section(s, '03', '怎么落到你的环境里',
        '能力清单可以慢慢看，但落地路径必须在第一次沟通里说清楚——否则技术好也推不动。',
        17, '03 / 落地路径')
notes(s, '章节页。')

# =========================================================
# 18 效率对比
# =========================================================
s = new_slide()
kicker(s, '交付节奏')
headline(s, '一条新的同步链路，时间花在哪里')
subhead(s, '下面是对同一条「系统 A 同步到系统 B」链路两种做法的工序拆解。'
           '差别集中在：接口开发与联调测试这两段是否还存在。', h=0.5)
tx, tw2, totx = 2.42, 8.42, 11.06
rows_tl = [
    ('手工点对点',
     [(20, '需求确认 3d', RGBColor(0x94, 0xa3, 0xb8)),
      (33, '接口开发 5d', RGBColor(0x64, 0x74, 0x8b)),
      (33, '双方联调测试 5d', RGBColor(0x47, 0x55, 0x69)),
      (14, '上线验证 2d', RGBColor(0x33, 0x41, 0x55))],
     '≈15 人日', DANGER),
    ('中台配置化',
     [(25, '登记数据源 0.5d', PRIMARY),
      (25, '配置映射 0.5d', BLUE_500),
      (25, '预览试跑 0.5d', BLUE_400),
      (25, '调度与告警 0.5d', BLUE_300)],
     '≈2 人日', SUCCESS),
]
for i, (lbl, segs, tot, totc) in enumerate(rows_tl):
    y = 2.20 + i * 0.78
    tb(s, ML, y + 0.14, 1.5, 0.3,
       [{'runs': [{'text': lbl, 'size': 11, 'bold': True, 'color': INK}]}])
    rect(s, tx, y + 0.06, tw2, 0.46, fill=LINE_2, rounded=True, adj=0.16)
    cx = tx
    for (pct, txt, col) in segs:
        sw = tw2 * pct / 100.0
        sh = rect(s, cx, y + 0.06, sw, 0.46, fill=col, rounded=False)
        tf = sh.text_frame
        tf.word_wrap = False
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        fg = RGBColor(0x1e, 0x3a, 0x8a) if col == BLUE_300 else WHITE
        para_txt(tf.paragraphs[0],
                 [{'text': txt, 'size': 8.5, 'bold': True, 'color': fg}],
                 align=PP_ALIGN.CENTER)
        cx += sw
    tb(s, totx, y + 0.14, 1.45, 0.3,
       [{'runs': [{'text': tot, 'size': 12, 'bold': True, 'color': totc,
                   'font': MONO}], 'align': PP_ALIGN.RIGHT}])
three2 = [
    ('差在哪', '连接器复用与映射配置化，取代了为每条链路单独写接口代码。', PRIMARY),
    ('边际成本递减', '第 1 条链路需要学习成本；从第 2 条开始，工序完全重复。', PRIMARY),
    ('口径说明', '上述为基于工序构成的量级估算，实际取决于环境复杂度与数据质量，不作为交付承诺。'
                 '建议在 POC 中用你们自己的真实数据校准。', WARNING),
]
for i, (t, b, dc) in enumerate(three2):
    x = ML + i * (cw3 + gap)
    card(s, x, 4.10, cw3, 2.05, t, b, dot=dc, fill=BG_BASE, tsize=11.5,
         bsize=9.5)
footer(s, '18')
notes(s, '务必主动说明这是量级估算、不是承诺——坦诚反而增加可信度。'
         '如果客户有历史工时数据，现场邀请他们一起折算。')

# =========================================================
# 19 角色
# =========================================================
s = new_slide()
kicker(s, '价值映射')
headline(s, '同一套产品，四类人各拿到不同的东西')
subhead(s, '技术评估通常涉及多个角色。这一页可以直接用于对齐不同部门关心的点。', h=0.5)
roles = [
    ('集成商 / 生态伙伴', '用一把 API Key 就能接入应用、数据、消息与身份能力。',
     '拿到：更短的上线周期，更少的对接沟通成本。', PRIMARY),
    ('IT 运维', '统一的执行监控、死信处理入口、会话吊销与告警配置。',
     '拿到：一个控制台管住所有链路，故障有处置手段。', SUCCESS),
    ('数据工程', '映射配置化、增量水位、DAG 编排、快照回滚与字段审计。',
     '拿到：不再为每条链路重复开发，口径集中可维护。', PRIMARY),
    ('安全与合规', '凭据加密存储、登录限流、RBAC、SAML 签名校验、全量审计。',
     '拿到：有清单可评审，有记录可追溯。', DANGER),
]
for i, (t, b, v, dc) in enumerate(roles):
    x = ML + i * (cw4 + 0.20)
    card(s, x, 2.06, cw4, 2.86, t, b, v, dot=dc, fill=WHITE, tsize=11.5,
         bsize=9.5, vsize=9)
callout(s, ML, 5.28, CW,
        '沟通提示：如果会议室里同时有这四类人，建议先讲第 5 页的代价，再按各自视角挑选第 9 至 16 页中的'
        '两到三页详讲，其余快速带过。全量通讲通常会在第 40 分钟失去注意力。', size=10.5)
footer(s, '19')
notes(s, '翻到这页时停一下，问："今天在座的各位，哪一位的角色是我们没覆盖到的？"'
         '这能把沉默的决策者拉进来。')

# =========================================================
# 20 落地路径
# =========================================================
s = new_slide()
kicker(s, 'Getting Started')
headline(s, '四步上线，每一步都有可见产出')
subhead(s, '每个阶段结束时都应有一个可以拿给评审人看的实物，而不是「进度 60%」。', h=0.45)
steps = [
    ('1', '环境就绪', ['部署数据库与应用服务', '控制台指向业务接口地址',
                       '生产环境切换为分布式队列', '配置密钥与告警通道'],
     '产出：可登录的控制台'),
    ('2', '接入数据源', ['登记源与目标数据源', '执行连通性测试',
                         '探测表结构与样例数据', '按需安装对应驱动'],
     '产出：测连通过的数据源清单'),
    ('3', '配任务并试跑', ['套用模板或自定义映射', '执行映射预览确认口径',
                           '手动触发一次真实同步', '查看执行记录与结果行数'],
     '产出：一次成功执行记录'),
    ('4', '调度与交付', ['设定 Cron 或事件触发', '配置重试、回执与告警',
                         '为集成商发放密钥并指派资源', '接入监控指标'],
     '产出：无人值守运行的链路'),
]
sw_ = (CW - 3 * 0.22) / 4
for i, (no, t, bl, out) in enumerate(steps):
    x = ML + i * (sw_ + 0.22)
    y = 2.02
    h = 3.28
    rect(s, x, y, sw_, h, fill=WHITE, line=LINE, rounded=True, adj=0.055)
    rect(s, x + 0.24, y + 0.24, 0.36, 0.36, fill=PRIMARY_0, line=PRIMARY_1,
         rounded=True, adj=0.2)
    bb = s.shapes.add_textbox(Inches(x + 0.24), Inches(y + 0.29), Inches(0.36),
                              Inches(0.26))
    bb.text_frame.margin_left = 0
    bb.text_frame.margin_right = 0
    bb.text_frame.margin_top = 0
    bb.text_frame.margin_bottom = 0
    para_txt(bb.text_frame.paragraphs[0],
             [{'text': no, 'size': 12, 'bold': True, 'color': PRIMARY_D}],
             align=PP_ALIGN.CENTER)
    tb(s, x + 0.24, y + 0.74, sw_ - 0.48, 0.32,
       [{'runs': [{'text': t, 'size': 12, 'bold': True, 'color': INK}]}])
    yy = y + 1.18
    for b in bl:
        rect(s, x + 0.26, yy + 0.075, 0.05, 0.05, fill=MUTED_2, rounded=True,
             adj=0.5)
        tb(s, x + 0.42, yy - 0.02, sw_ - 0.68, 0.5,
           [{'runs': [{'text': b, 'size': 9.5, 'color': MUTED}],
             'line_spacing': 1.35}])
        yy += 0.36
    rect(s, x + 0.24, y + 2.72, sw_ - 0.48, 0.010, fill=LINE)
    tb(s, x + 0.24, y + 2.84, sw_ - 0.48, 0.34,
       [{'runs': [{'text': out, 'size': 9.5, 'bold': True, 'color': PRIMARY_D}],
         'line_spacing': 1.3}])
last2 = [
    ('开发与生产的差异',
     '开发环境使用进程内队列即可满足验证需要；生产环境切换为基于消息中间件的分布式队列，'
     '配合多进程部署避免任务重复派发。'),
    ('驱动按需安装',
     'Oracle、SQL Server、MongoDB、SFTP、S3、LDAP、Excel 等连接器所需的驱动与基础依赖分开管理，'
     '按实际接入类型安装，不污染基础部署。'),
]
for i, (t, b) in enumerate(last2):
    x = ML + i * (w2 + gap2)
    card(s, x, 5.46, w2, 1.28, t, b, dot=PRIMARY, fill=BG_BASE, tsize=11,
         bsize=9.5)
footer(s, '20')
notes(s, '强调"每一步都有可见产出"——客户真正的焦虑是"投入了但看不到进展"。')

# =========================================================
# 21 下一步
# =========================================================
s = new_slide()
kicker(s, 'Next Step')
headline(s, '建议的下一步：把验证标准先写下来')
subhead(s, '一次定向演示只能建立信心，真正的决策依据来自你们自己数据上的验证结果。', h=0.45)
nx = [
    ('第一步 · 技术对齐（约 30 分钟）',
     '确认你们的环境组成、必须打通的系统清单、安全评审要求与关键角色。会后产出一份定向演示脚本。'),
    ('第二步 · 定向演示（约 45 分钟）',
     '围绕你们指定的两到三条真实链路演示，包含一次刻意制造的失败与恢复过程。'),
    ('第三步 · 小范围验证（2–3 周）',
     '选定一条真实链路，在开始前书面确认通过 / 不通过的标准、时间点与决策人。'),
]
for i, (t, b) in enumerate(nx):
    x = ML + i * (cw3 + gap)
    card(s, x, 2.02, cw3, 1.86, t, b, dot=PRIMARY, fill=WHITE, tsize=11.5,
         bsize=10)
callout(s, ML, 4.10, CW,
        '我们主动提醒：验证范围要克制。聚焦一条链路做到结论明确，比铺开五条链路后得到一个模糊结论有价值得多。'
        '范围外的新需求建议放进第二阶段。', kind='warn', size=10.5)
lastp = [
    ('本次沟通不涉及',
     '以下方向目前在产品中尚未落地，本次不作为能力介绍：变更数据捕获（CDC / binlog 级实时同步）、'
     'Kubernetes 编排与自动扩缩容、超大规模文件批量传输、对外 SLA 状态页与按行计费。'),
    ('本次沟通已覆盖',
     '26 类连接器、ETL 与 DAG 编排、死信与快照回滚、字段级审计、SSO 四种协议、组织同步、'
     '开放 API 门面、Prometheus 指标与全量审计。'),
]
for i, (t, b) in enumerate(lastp):
    x = ML + i * (w2 + gap2)
    card(s, x, 5.14, w2, 1.60, t, b, dot=(WARNING if i == 0 else SUCCESS),
         fill=BG_BASE, tsize=11.5, bsize=9.5)
footer(s, '21')
notes(s, '收尾只做一件事：把"下一步"变成约定。现场确认三个信息——谁来提供测试数据、'
         '决策人是谁、什么时间出结论。只要拿到这三条，这次演示就是成功的。'
         '最后一页的"本次沟通不涉及"是信任锚点，一定要讲。')

prs.core_properties.title = '集成中台 · 产品介绍'
prs.core_properties.author = '售前技术顾问'
prs.core_properties.comments = '面向技术评估与业务决策的产品介绍'

out = r"D://pythonDev//IntegrationPro//IntegrationPlatform-//.workbuddy//artifacts//产品介绍-集成中台.pptx"
prs.save(out)
print('OK ->', out)
print('slides =', len(prs.slides._sldIdLst))
if FIT_WARNINGS:
    print('--- fit warnings: %d ---' % len(FIT_WARNINGS))
    for w_ in FIT_WARNINGS:
        print(w_)
else:
    print('no fit warnings')
