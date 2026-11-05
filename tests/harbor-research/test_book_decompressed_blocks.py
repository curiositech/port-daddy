"""Guard the requested semantic breaks and displayed arithmetic, not page numbers.

These checks preserve the reviewed claims and evidence qualifications. They do
not execute the historical experiments or establish their scientific validity.
The full-PDF regression/visual review remains a separate acceptance gate.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPAWN = ROOT / "book/spawn-to-person.tex"
TRADE = ROOT / "book/harbor-economy.tex"
SWARM = ROOT / "book/legible-swarm.tex"


def example(source, title):
    start = source.index(r"\begin{pdexample}{" + title + "}")
    end = source.index(r"\end{pdexample}", start)
    return source[start:end]


def compact(text):
    return re.sub(r"\s+", "", text)


def require_displays(text, formulas):
    displays = [compact(value) for value in re.findall(r"\\\[([\s\S]*?)\\\]", text)]
    for formula in formulas:
        if not any(compact(formula) in display for display in displays):
            raise AssertionError("Important formula is not displayed: " + formula)
    if "$$" in text or r"\begin{equation}" in text:
        raise AssertionError("Do not introduce plain-TeX display or new equation numbering")


def require_groups(text, anchors):
    groups = [" ".join(p.split()) for p in re.split(r"\n\s*\n", text)]
    indices = [next((i for i, group in enumerate(groups) if anchor in group), -1)
               for anchor in anchors]
    if any(i < 0 for i in indices) or any(a >= b for a, b in zip(indices, indices[1:])):
        raise AssertionError("Independent points must occupy ordered distinct paragraphs")


def check_nomint(text):
    require_groups(text, ["The branching rule", "The reported randomized sweep",
                         "The copy-full mutant", "A counterexample to local grant budgets alone", r"\emph{Now you try:}",
                         "The discipline is older", "Same enemy"])
    require_displays(text, ["0.9+0.81+0.729=2.439>1", r"0.9^3=0.729\le 1"])
    for required in ["except at witness", "$4{,}000$", "$0$ violations [internal,",
                     "$8.2\\times$", "Debiting each transferred balance is what supplies conservation", r"\pdcite{levien-advogato}",
                     r"\ref{ex:stp-nomint-sweep}"]:
        if required not in " ".join(text.split()):
            raise AssertionError("No-mint premise or provenance changed: " + required)


def check_trade(text):
    require_groups(text, ["The following particular double auction", "Any mechanism satisfying",
                         "Take Bob's value", "Integrating over the whole square",
                         "Efficient trade is possible", "Counting opportunities",
                         "These are properties"])
    require_displays(text, [r"\beta(v)&=\tfrac{2}{3}v+\tfrac{M}{12}",
                           r"\sigma(c)&=\tfrac{2}{3}c+\tfrac{M}{4}",
                           r"\beta(v)\ge\sigma(c) \iff v-c\ge M/4",
                           "v-c=10<22.5", r"\dfrac{a(2M-a)}{2M^2}",
                           r"7/32\approx21.9\%", r"7/16=43.75\%",
                           r"M^{-2}\int_0^{M/4}x(M-x)\,dx=5M/192",
                           r"5/32=15.625\%"])
    for required in ["drawn independently and uniformly", "not evidence for this illustrative distribution",
                     "does not identify which property the whole harbor market must sacrifice",
                     "has Bob bid and Alice ask, respectively", r"\emph{all draws}",
                     r"\emph{efficient opportunities}", "not a universal inefficiency percentage",
                     "not measurements of the harbor market", "[internal; algebra shown]",
                     r"\pdcite{chatterjee1983}"]:
        if required not in " ".join(text.split()):
            raise AssertionError("Trade scope, denominator or provenance changed: " + required)


def grant_example(source):
    start = source.index(r"\scene{Alice, 3:25 p.m.}{")
    return source[start:source.index(r"\end{pdclaim}", start)]


def check_grant(text):
    flat = " ".join(text.split())
    for phrase in ["Alice grants two hours of low-stakes, reversible",
                   "original acceptance test remains intact",
                   "test deletion fails the preserved-test condition",
                   "migration change is outside the subtree",
                   "force-push is outside the grant",
                   "no permission to execute them",
                   "Its scope must include the acceptance-preservation rule, not merely a path glob",
                   r"\textsc{stakes-ceiling}\ s_{\max}",
                   r"\textsc{reversibility-floor}\ v_{\min}",
                   r"\textsc{ttl},\ \textsc{revocable}",
                   "preserving the original checkout acceptance test, for two hours",
                   "neither unrelated changes nor deployment"]:
        if phrase not in flat:
            raise AssertionError("Consent scope or scene/formal agreement changed: " + phrase)
    require_groups(text, ["Alice grants", "The tuple below"])


class DecompressedBlocks(unittest.TestCase):
    def test_no_mint_keeps_transfer_mutants_and_counterexample_distinct(self):
        check_nomint(example(SPAWN.read_text(), "No-Mint Inheritance"))

    def test_trade_keeps_three_denominators_and_model_scope_distinct(self):
        check_trade(example(TRADE.read_text(), "Efficient Trade That the Mechanism Still Refuses"))

    def test_alice_grant_and_observable_consequences_are_separate(self):
        check_grant(grant_example(SWARM.read_text()))

    def test_grant_rejects_duration_and_scope_drift(self):
        text = grant_example(SWARM.read_text())
        for old, new in [("two hours", "24 hours"),
                         ("preserved-test condition", "path condition"),
                         ("no permission to execute", "permission to execute"),
                         ("preserving the original checkout acceptance test",
                          "replacing the original checkout acceptance test")]:
            with self.subTest(change=new):
                self.assertIn(old, " ".join(text.split()))
                mutant = re.sub(re.escape(old).replace(r"\ ", r"\s+"), new, text)
                self.assertNotEqual(mutant, text)
                with self.assertRaises(AssertionError):
                    check_grant(mutant)

    def test_tower_assumptions_threshold_recurrence_and_depth_are_separate(self):
        source = SPAWN.read_text()
        start = source.index(r"\begin{pdclaim}{Theorem}{Tower Contraction;")
        text = source[start:source.index(r"\end{pdclaim}", start)]
        require_groups(text, ["proof and verification artifacts", "Let level", "Below that threshold", "If $G_0\\le CB$"])
        require_displays(text, [r"G_k \;>\; C\,B", r"G_{k+1} \;=\; (1-\rho d)\,G_k",
                               r"\left\lfloor \frac{\log(G_0/u)}{\log\tfrac{1}{1-\rho d}}\right\rfloor+1"])
        self.assertIn("conditional on every preceding", " ".join(text.split()))
        self.assertIn("level having missed the corrupt grade", " ".join(text.split()))

    def test_audit_depth_keeps_two_pools_and_exercise_separate(self):
        text = example(SPAWN.read_text(), "Diversity and Audit Depth")
        require_groups(text, ["Take $G_0", "With a heterogeneous pool", "For $C=1$", r"\emph{Now you try:}"])
        require_displays(text, [r"\lceil \log 400/\log 1.25 \rceil = 27",
                               r"\lceil \log 50/\log 1.25\rceil = 18"])
        self.assertIn("they are not measured audit performance", " ".join(text.split()))

    def test_amortization_distinguishes_discrete_sum_and_integral(self):
        text = example(SPAWN.read_text(), "Amortized Verification: Sums and Their Integral Approximations")
        require_groups(text, ["Let periods be", "In Model~A", "Model~B", r"\emph{Now you try:}"])
        require_displays(text, [r"\rho_t=\frac{G}{d(B+vt)}",
                               r"\int_0^T\frac{aG}{d(B+vt)}\,dt",
                               r"\rho_t=\max\{0,(G-rvt)/(dB)\}"])
        for phrase in ["$t=0,\\ldots,T-1$", "additive payoff model",
                       r"$\lceil G/(rv)\rceil=334$", "$35.075",
                       "$41.79175$", "not its exact value",
                       "does not converge to that integral",
                       "its own evidence and enforcement mechanism"]:
            self.assertIn(phrase, " ".join(text.split()))

    def test_tower_budget_and_selected_capital_are_not_universal(self):
        text = example(SPAWN.read_text(), "Diversity and Audit Depth")
        for phrase in ["cannot replenish that budget", "only that remainder",
                       "not disappearance", "not a capital requirement for the entire"]:
            self.assertIn(phrase, " ".join(text.split()))

    def test_negative_controls_reject_collapsed_points_and_promoted_evidence(self):
        nomint = example(SPAWN.read_text(), "No-Mint Inheritance")
        trade = example(TRADE.read_text(), "Efficient Trade That the Mechanism Still Refuses")
        for checker, text, old, new in [
            (check_nomint, nomint, "20260816].\n\nThe copy-full", "20260816].\nThe copy-full"),
            (check_nomint, nomint, "[internal,", "[verified,"),
            (check_nomint, nomint, "2.439>1", "2.439<1"),
            (check_trade, trade, "7/16=43.75", "7/32=43.75"),
            (check_trade, trade, "drawn independently and uniformly", "drawn uniformly"),
            (check_trade, trade, "not measurements of the harbor market", "measurements of the harbor market"),
        ]:
            with self.subTest(old=old):
                self.assertIn(old, text)
                with self.assertRaises(AssertionError):
                    checker(text.replace(old, new))


if __name__ == "__main__":
    unittest.main()
