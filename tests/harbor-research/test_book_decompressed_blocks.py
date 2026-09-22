"""Guard the requested semantic breaks and displayed arithmetic, not page numbers.

These checks preserve the reviewed claims and evidence qualifications. They do
not execute the historical experiments or establish their scientific validity.
The full-PDF regression/visual review remains a separate acceptance gate.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPAWN = ROOT / "website-v2/public/whitepaper/spawn-to-person.tex"
TRADE = ROOT / "website-v2/public/whitepaper/harbor-economy.tex"
SWARM = ROOT / "whitepaper/legible-swarm.tex"


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
                         "The copy-full mutant", "One wrong turn", r"\emph{Now you try:}",
                         "The discipline is older", "Same enemy"])
    require_displays(text, ["0.9+0.81+0.729=2.439>1", r"0.9^3=0.729\le 1"])
    for required in ["except at witness", "$4{,}000$", "$0$ violations [internal,",
                     "$8.2\\times$", r"$\gamma>\tfrac12$", r"\pdcite{levien-advogato}",
                     r"\ref{ex:stp-nomint-sweep}"]:
        if required not in " ".join(text.split()):
            raise AssertionError("No-mint premise or provenance changed: " + required)


def check_trade(text):
    require_groups(text, [r"Theorem~\ref{thm:ms} names", "Any mechanism satisfying",
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
                     "has Bob bid and Alice ask, respectively", r"\emph{all draws}",
                     r"\emph{efficient opportunities}", "not a universal inefficiency percentage",
                     "not measurements of the harbor market", "[internal; algebra shown]",
                     r"\pdcite{chatterjee1983}"]:
        if required not in " ".join(text.split()):
            raise AssertionError("Trade scope, denominator or provenance changed: " + required)


class DecompressedBlocks(unittest.TestCase):
    def test_no_mint_keeps_transfer_mutants_and_counterexample_distinct(self):
        check_nomint(example(SPAWN.read_text(), "No-Mint Inheritance"))

    def test_trade_keeps_three_denominators_and_model_scope_distinct(self):
        check_trade(example(TRADE.read_text(), "Efficient Trade That the Mechanism Still Refuses"))

    def test_mara_grant_and_observable_consequences_are_separate(self):
        text = SWARM.read_text().split(r"\scene{Mara, 3:25 p.m.}{", 1)[1].split(r"\begin{pdclaim}", 1)[0]
        require_groups(text, ["Burned by the morning's chaos", "The grant is a single line"])
        for phrase in ["auto-land reversible diffs under low stakes", "next two hours",
                       r"She does \emph{not} grant migration", r"$v_{\min}$",
                       "escalated to her instead of executed"]:
            self.assertIn(phrase, " ".join(text.split()))

    def test_tower_assumptions_threshold_recurrence_and_depth_are_separate(self):
        source = SPAWN.read_text()
        start = source.index(r"\begin{pdclaim}{Theorem}{Tower Contraction;")
        text = source[start:source.index(r"\end{pdclaim}", start)]
        require_groups(text, ["proof and verification artifacts", "Let level", "Below that threshold", "Consequently"])
        require_displays(text, [r"G_k \;>\; C\,B", r"G_{k+1} \;=\; (1-\rho d)\,G_k",
                               r"\left\lfloor \frac{\log(G_0/u)}{\log\tfrac{1}{1-\rho d}}\right\rfloor+1"])
        self.assertIn("conditional on every preceding", " ".join(text.split()))
        self.assertIn("level having missed the corrupt grade", " ".join(text.split()))

    def test_audit_depth_keeps_two_pools_and_exercise_separate(self):
        text = example(SPAWN.read_text(), "Diversity and Audit Depth")
        require_groups(text, ["Take $G_0", "With a heterogeneous pool", "With a monoculture pool", r"\emph{Now you try:}"])
        require_displays(text, [r"\lceil \log 400/\log 1.25 \rceil = 27",
                               r"\lceil \log 50/\log 1.25\rceil = 18"])
        self.assertIn("they are not measured audit performance", " ".join(text.split()))

    def test_amortization_keeps_horizon_limits_and_reported_check(self):
        text = example(SPAWN.read_text(), r"The Audit Tower: Amortized \mbox{Verification} Spend")
        require_groups(text, ["As a judge", "Two honest amortization", "Model B", "Both models", r"\emph{Now you try:}"])
        require_displays(text, [r"a\sum_t\rho^\star=50.00", r"\rho_t=G/(d(B+vt))",
                               r"\frac{aG}{dv}\ln(1+vT/B)=25.50", r"\rho_t=\max(0,(G-rvt)/(dB))",
                               r"t^\star=G/(rv)=333", "aG^2/(2dBrv)=41.67",
                               r"\rho^\star\times a\times200=0.25\times1\times200=50"])
        for phrase in ["$25.58$", "$35.08$", "(short of $t^\\star$)", "script's IC check reports",
                       r"$+1.78\times10^{-15}$", "zero to floating-point precision",
                       r"[internal, \texttt{b2\_tower.py}, seed 20260816]"]:
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
