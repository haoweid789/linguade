"""LinguaDE · 工程一致性校验（零依赖，仅用标准库）

检查项：
  1) 每个模块文件都含 window.LD.define("<文件名>", ...) 且带元数据 group / order
  2) index.html 的模块脚本段与 src/modules 目录一一对应，且顺序与 order 排序一致
  3) index.html 与 dist/index.html 无「外部资源引用」，且 <script> 开闭配对

用法：python tools/check.py   （返回码 0 通过 / 1 失败）
"""
import os
import re
import sys
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD_DIR = os.path.join(ROOT, "src", "modules")
INDEX = os.path.join(ROOT, "index.html")
MOD_BLOCK = re.compile(r"<!--modules:start-->([\s\S]*?)<!--modules:end-->")

# 以协议、协议相对或根路径开头即视为外部资源；data: 是内联内容，不产生网络请求
EXTERNAL_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//|/)")


def read(p):
    return io.open(p, encoding="utf-8").read()


def module_files():
    return sorted(f[:-3] for f in os.listdir(MOD_DIR) if f.endswith(".js"))


def meta_body(name):
    m = re.search(r"Object\.assign\(Mod,\s*\{([^}]*)\}\)", read(os.path.join(MOD_DIR, name + ".js")))
    return m.group(1) if m else None


def order_of(name):
    body = meta_body(name)
    m = re.search(r"\border:\s*(\d+)", body) if body else None
    return int(m.group(1)) if m else None


def index_module_order():
    html = read(INDEX)
    blk = MOD_BLOCK.search(html)
    body = blk.group(1) if blk else html
    return re.findall(r'src="src/modules/([\w.-]+)\.js"', body)


def external_refs(html):
    refs = re.findall(r'<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"', html)
    return sorted({r for r in refs if EXTERNAL_RE.match(r) and not r.startswith("data:")})


def check():
    errs = []
    files = module_files()

    # 1) 每个模块文件的注册与元数据
    for name in files:
        txt = read(os.path.join(MOD_DIR, name + ".js"))
        if not re.search(r'window\.LD\.define\(\s*"%s"' % re.escape(name), txt):
            errs.append("模块 %s 未用 window.LD.define(...) 注册" % name)
        body = meta_body(name)
        if not body:
            errs.append("模块 %s 缺少 Object.assign(Mod, {...}) 元数据" % name)
            continue
        if not re.search(r'\bgroup:\s*"', body):
            errs.append("模块 %s 缺少元数据 group" % name)
        if not re.search(r"\border:\s*\d+", body):
            errs.append("模块 %s 缺少元数据 order" % name)

    # 2) index.html 的模块脚本段
    idx = index_module_order()
    want = [n for _, n in sorted((order_of(n) if order_of(n) is not None else 999, n) for n in files)]
    if sorted(idx) != sorted(files):
        miss = sorted(set(files) - set(idx))
        extra = sorted(set(idx) - set(files))
        if miss:
            errs.append("index.html 缺少模块脚本引用：%s" % miss)
        if extra:
            errs.append("index.html 引用了不存在的模块脚本：%s" % extra)
    elif idx != want:
        errs.append("index.html 模块脚本顺序与 order 不一致：%s != %s" % (idx, want))

    # 3) 外链与脚本闭合
    for name in ("index.html", os.path.join("dist", "index.html")):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            errs.append("缺少文件：%s" % name)
            continue
        html = read(path)
        refs = external_refs(html)
        if refs:
            errs.append("%s 存在外部资源引用：%s" % (name, refs))
        o, c = html.count("<script"), html.count("</script>")
        if o != c:
            errs.append("%s 的 <script> 开闭不配对：%d/%d" % (name, o, c))

    print("模块文件 %d 个 · index 模块脚本 %d 个 · 顺序%s" % (
        len(files), len(idx), "一致" if idx == want else "不一致"))
    if errs:
        print("校验未通过：")
        for e in errs:
            print("  - " + e)
        return 1
    print("校验通过：模块注册 / 元数据 / index 脚本 / 外链 / 闭合 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(check())