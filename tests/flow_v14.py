"""flow_v14 · 后端可选通道（音素评估 / 知识追踪）（3.7.0 · 5 项）

验证「声学级 GOP」与「深度知识追踪」作为**可插拔后端通道**的落地：
  - 默认通道零依赖（rule / bkt），未配后端时前端本地规则照常工作（离线单文件能力不变）；
  - 契约与 schemas.py 对齐（open_id 必填，mock 逐字段校验 → 前端漏发即 422）；
  - /api/health 暴露通道状态（channel / external_ready / effective）。
"""
import json
import urllib.error
import urllib.request


def _post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def test_mock_contract_requires_open_id(mock_api):
    """契约：缺 open_id 必须 422（与 schemas.py 必填字段一致）"""
    code, _ = _post(mock_api + "/api/ai/phoneme/assess", {"ref": "über", "hyp": "uber"})
    assert code == 422, "phoneme/assess 未做 open_id 必填校验"
    code, _ = _post(mock_api + "/api/ai/kt/predict", {"skill": "v:Zimmer"})
    assert code == 422, "kt/predict 未做 open_id 必填校验"


def test_health_exposes_channels(mock_api):
    """/api/health 暴露音素与知识追踪通道状态"""
    with urllib.request.urlopen(mock_api + "/api/health", timeout=5) as r:
        j = json.loads(r.read().decode("utf-8"))
    assert j["phoneme"]["channel"] == "rule"
    assert j["phoneme"]["effective"] == "rule"
    assert j["kt"]["channel"] == "bkt"
    assert j["kt"]["effective"] == "bkt"


def test_backend_phoneme_assess(page, mock_api):
    """配好后端 → LD.Backend.phonemeAssess 返回音素级诊断"""
    page.evaluate("(u) => { const c = window.LD.Store.s.cfg; c.backend = u; window.LD.Store.save(); }", mock_api)
    r = page.evaluate("() => window.LD.Backend.phonemeAssess('über', 'uber')")
    assert r and r.get("pairs"), r
    assert r.get("channel") in ("rule", "acoustic")
    assert isinstance(r.get("per"), int)


def test_backend_kt_predict(page, mock_api):
    """配好后端 → LD.Backend.ktPredict 返回掌握概率与预测正确率"""
    page.evaluate("(u) => { const c = window.LD.Store.s.cfg; c.backend = u; window.LD.Store.save(); }", mock_api)
    r = page.evaluate("() => window.LD.Backend.ktPredict('v:Zimmer', [{ok: true}, {ok: false}])")
    assert r and "mastery" in r and "predict" in r, r
    assert r.get("channel") in ("bkt", "dkt")


def test_local_channels_work_without_backend(page):
    """未配后端时本地规则通道照常工作（离线单文件能力不受影响）"""
    r = page.evaluate("() => window.LD.Phonetics.compare('über', 'uber')")
    assert r and r["per"] > 0
    bkt = page.evaluate("() => window.LD.Engine.bktPredict('v:Zimmer')")
    assert isinstance(bkt, int)