"""LinguaDE 构建脚本

1) 同步 index.html 的模块脚本段：扫描 src/modules/*.js，按模块自带的 order 排序自动生成
   （因此新增模块只需写一个模块文件，脚本引用与排序全自动）
2) 把多文件前端内联为单文件 dist/index.html（零外部请求，可 file:// 离线打开）
3) 校验产物不含任何外部资源引用

用法：python tools/build.py
"""
import re
import os
import io
import glob
import json
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
DIST = os.path.join(ROOT, "dist", "index.html")
MOD_DIR = os.path.join(ROOT, "src", "modules")

# 单文件体积红线（v5 排印三栈 +121KB 后仍须留有余量）
# 3.23 已将 2.6MB 废止：SW 外壳缓存上线后，回访用户不再重复下载，
# 红线的意义从「单文件硬上限」转为「回访缓存失效检测」——超限仍提醒有效的体积()
SIZE_CAP = 2.6 * 1024 * 1024

FONT_URL = re.compile(r'url\("assets/fonts/([^"]+\.woff2)"\)')

MOD_BLOCK = re.compile(r"(<!--modules:start-->)([\s\S]*?)(<!--modules:end-->)")
PACK_BLOCK = re.compile(r"(<!--content-packs:start-->)([\s\S]*?)(<!--content-packs:end-->)")

# 德中双语句对只在接了大模型时用作 grounding，且体积最大；
# 不进单文件正文（部署形态走 HTTP 取文件），避免离线首屏拖一条 15–19s 的长尾。
INLINE_SKIP_KINDS = {"pairs"}


def read(p):
    return io.open(p, encoding="utf-8").read()


def write(p, s):
    io.open(p, "w", encoding="utf-8").write(s)


def module_scripts():
    """扫描 src/modules，按模块文件中的 order 字段升序生成 script 标签行"""
    items = []
    for f in os.listdir(MOD_DIR):
        if not f.endswith(".js"):
            continue
        txt = read(os.path.join(MOD_DIR, f))
        m = re.search(r"Object\.assign\(Mod,\s*\{[^}]*?\border:\s*(\d+)", txt)
        items.append((int(m.group(1)) if m else 999, f[:-3]))
    items.sort()
    return "\n".join('<script src="src/modules/%s.js"></script>' % n for _, n in items)


def sync_module_scripts(html):
    """保持 index.html 的模块脚本段与 src/modules 目录一致（幂等），并回写 index.html"""
    block = module_scripts()
    if not MOD_BLOCK.search(html):
        print("警告：index.html 缺少 <!--modules:start-->/<!--modules:end--> 标记，跳过模块脚本同步")
        return html
    new = MOD_BLOCK.sub(lambda m: m.group(1) + "\n" + block + "\n" + m.group(3), html)
    if new != html:
        write(INDEX, new)
        print("已同步 index.html 的模块脚本段（%d 个模块）" % block.count("<script"))
    return new


def inline_fonts(css):
    """把 styles.css 里的 woff2 引用替换为 base64 data:（file:// 零外部请求的关键一步）"""
    def datauri(m):
        fp = os.path.join(ROOT, "src", "assets", "fonts", m.group(1))
        if not os.path.exists(fp):
            print("警告：字体文件缺失，保留原样 ->", m.group(1))
            return m.group(0)
        with open(fp, "rb") as f:
            return 'url("data:font/woff2;base64,%s")' % base64.b64encode(f.read()).decode("ascii")
    return FONT_URL.sub(datauri, css)


def inline_css(m):
    p = os.path.join(ROOT, m.group(1))
    if not os.path.exists(p):
        return m.group(0)
    return "<style>\n" + inline_fonts(read(p)) + "\n</style>"


def inline_js(m):
    p = os.path.join(ROOT, m.group(1))
    if not os.path.exists(p):
        return m.group(0)
    js = read(p).replace("</script>", "<\\/script>")
    return "<script>\n" + js + "\n</script>"


def content_packs():
    """扫描 dist 里真实存在的内容包，生成前端可见清单（只列存在文件，避免探测 404）"""
    labels = {"reading": "阅读短文", "speech": "跟读句", "lexicon": "词库册", "pairs": "德中双语", "grammar": "语法讲解"}
    out = []
    for path in sorted(glob.glob(os.path.join(ROOT, "dist", "content-pack-*.json"))):
        try:
            with io.open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        kind = data.get("pack") or ""
        count = data.get("count")
        if count is None and isinstance(data.get("items"), list):
            count = len(data["items"])
        out.append({
            "file": os.path.basename(path),
            "kind": kind,
            "label": data.get("label") or labels.get(kind, kind or os.path.basename(path)),
            "count": count if isinstance(count, int) else 0,
            "license": data.get("license") or "",
            "source": data.get("source") or "",
            "withAudio": data.get("withAudio") if isinstance(data.get("withAudio"), int) else 0,
            "generatedAt": data.get("generatedAt") or "",
            "inline": kind not in INLINE_SKIP_KINDS,
            # 主包 / 可选包分层（B4）：合成音频包不进单文件体积，按需在手机端下载
            "tier": data.get("tier") or ("optional" if kind == "audio" else "main"),
        })
    return out


def inline_pack_data():
    """把内容包压成 key=文件名 的对象，供单文件版零请求导入（体积换离线体验）。"""
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "dist", "content-pack-*.json"))):
        try:
            with io.open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        if data.get("pack") in INLINE_SKIP_KINDS:
            continue
        out[os.path.basename(path)] = data
    return out


def inject_content_packs(html):
    """把内容包清单与正文注入 dist（source index 保留空标记，开发/测试不会触发探测）"""
    packs = content_packs()
    if not packs:
        return PACK_BLOCK.sub(lambda m: m.group(1) + m.group(3), html)
    inline = inline_pack_data()
    for p in packs:
        if bool(inline.get(p["file"])) != p["inline"]:
            raise SystemExit("内容包内联标记与正文不一致：" + p["file"])
    payload = json.dumps(inline, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    block = ("<script>window.LD_CONTENT_PACKS = %s;window.LD_CONTENT_PACKS_INLINE = %s;</script>"
             % (json.dumps(packs, ensure_ascii=False), payload))
    return PACK_BLOCK.sub(lambda m: m.group(1) + block + m.group(3), html)


def main():
    html = read(INDEX)
    html = sync_module_scripts(html)

    # 兼容带任意属性（如 data-page-node-id）的 link / script 标签
    html = re.sub(r'<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>', inline_css, html)
    html = re.sub(r'<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>\s*</script>', inline_js, html)
    html = inject_content_packs(html)

    write(DIST, html)
    size = os.path.getsize(DIST)
    print("打包完成:", DIST, f"{size/1024:.0f} KB")
    if size > SIZE_CAP:
        print("警告：单文件 %.2f MB 已超过 %.1f MB 上限（SW 外壳缓存后回访不再重复下载；只提醒新用户首屏可感知）"
              % (size / 1048576, SIZE_CAP / 1048576))

    # 校验：产物必须零外部资源引用（离线优先原则）
    # 注：运行时模板占位（如 <img src="${url}">）与 data: 内联内容不产生网络请求，不算外部引用
    refs = re.findall(r'<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"', html)
    residual = sorted({r for r in refs if "${" not in r and not r.startswith("data:")})
    if residual:
        print("警告：产物仍存在外部资源引用 ->", ", ".join(residual))
    else:
        print("校验通过：产物无任何外部资源引用")


if __name__ == "__main__":
    main()
