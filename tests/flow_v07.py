"""flow_v07 · HLR 半衰期模型公式一致性（6 项）

在真实浏览器上下文里调用 LD.Engine，验证 p = 2^(-Δ/h) 与半衰期的增长/衰减规则，
确保算法实现与论文描述一致（而非仅落在文案上）。
"""
import pytest


def _seq(page, word, actions):
    """对同一词连续施加 答对/答错 序列，返回每步后的半衰期 h"""
    return page.evaluate(
        """([word, actions]) => {
            const E = window.LD.Engine;
            const out = [];
            for (const ok of actions) { E.hlrUpdate(word, ok); out.push(E.hlrState(word).h); }
            return out;
        }""", [word, actions])


def test_hlr_constants(page):
    """HLR 常量（3.24 调参：initH 3.5 / growLate 2.0，避免积压只增不减）"""
    hlr = page.evaluate("() => window.LD.Engine.HLR")
    assert hlr["initH"] == 3.5
    assert hlr["growOk"] == 1.9
    assert hlr["growLate"] == 2.0
    assert hlr["dropWrong"] == 0.5
    assert hlr["minH"] == 0.5


def test_hlr_initial_half_life(page):
    """未练过的词半衰期为 initH"""
    h = page.evaluate("() => window.LD.Engine.hlrState('HLR_INIT').h")
    assert h == pytest.approx(3.5)


def test_hlr_growth_on_correct(page):
    """答对：前两次 ×1.9，之后 ×2.0"""
    seq = _seq(page, "HLR_OK", [True, True, True])
    assert seq[0] == pytest.approx(3.5 * 1.9)
    assert seq[1] == pytest.approx(3.5 * 3.61)
    assert seq[2] == pytest.approx(3.5 * 3.61 * 2.0)


def test_hlr_decay_on_wrong_with_floor(page):
    """答错：半衰期减半，且不低于 0.5 天"""
    seq = _seq(page, "HLR_BAD", [False, False, False, False, False])
    assert seq[0] == pytest.approx(1.75)         # 3.5 × 0.5
    assert seq[-1] == pytest.approx(0.5)         # 连续答错后触底
    assert min(seq) == pytest.approx(0.5)


def test_hlr_recall_formula(page):
    """回忆概率 p = 2^(-Δ/h)：h=2 天、Δ=1 天 → 约 71%"""
    p = page.evaluate(
        """() => {
            const E = window.LD.Engine, w = 'HLR_RECALL';
            const st = E.hlrState(w);
            st.h = 2; st.last = Date.now() - 86400000;
            return E.hlrRecall(w);
        }""")
    assert p == pytest.approx(71, abs=1)


def test_hlr_due_list_threshold(page):
    """到期列表只收「回忆概率 < dueAt(90%) 且仍在词库内」的词；从未练习的词与词库外的孤儿卡片都不入列"""
    res = page.evaluate(
        """() => {
            const E = window.LD.Engine, S = window.LD.Store;
            const freshWord = 'Zeit', staleWord = 'Tag', orphan = 'HLR_ORPHAN_WORD';
            E.hlrUpdate(freshWord, true);                        // 刚复习 → p≈100
            const stale = E.hlrState(staleWord);
            stale.h = 1; stale.last = Date.now() - 5 * 86400000;  // Δ=5d, h=1 → p≈3%
            S.s.cards[orphan] = { ef: 2.0, iv: 1, due: Date.now() - 1000, reps: 1, lapses: 0, ok: 0, bad: 0, history: [] };
            const o = E.hlrState(orphan);
            o.h = 1; o.last = Date.now() - 5 * 86400000;
            S.save();
            const list = E.hlrDueList().map(x => x.w);
            return {
                hasFresh: list.includes(freshWord),
                hasStale: list.includes(staleWord),
                hasOrphan: list.includes(orphan),
                sm2HasOrphan: E.dueList().includes(orphan),
                orphanDue: E.orphanDue(),
                queueHasOrphan: E.buildQueue(20).some(w => (w[0] || w) === orphan),
            };
        }""")
    assert res["hasStale"] is True
    assert res["hasFresh"] is False
    assert res["hasOrphan"] is False, "词库外的卡片不该进 HLR 到期列表"
    assert res["sm2HasOrphan"] is False, "词库外的卡片不该进 SM-2 到期列表"
    assert "HLR_ORPHAN_WORD" in res["orphanDue"], "孤儿卡片要单独可见，供清理入口使用"
    assert res["queueHasOrphan"] is False