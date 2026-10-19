"""The refreshed correction checks must still reject lost conditions."""
import importlib.util
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "propagated_corrections", ROOT / "scripts/harbor-research/check_propagated_corrections.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class CustodyCaptionGuards(unittest.TestCase):
    def checks(self):
        return next(item for item in module.ITEMS
                    if item.id == "federated-harbor-escrow-figures").checks

    def test_live_text_and_deleted_conditions(self):
        for check in self.checks():
            text = module.strip_latex_comments((ROOT / check.file).read_text())
            self.assertTrue(check.run(False)[0], check.file)
            changed = re.sub(check.present, "", text, flags=re.DOTALL)
            self.assertIsNone(re.search(check.present, changed, re.DOTALL), check.file)

    def test_old_unconditional_transfer_claim_is_rejected(self):
        check = self.checks()[-1]
        for bad in ("Authority Invariant", "2-of-3 non-custodial settlement",
                    "Non-Custodial: Can Refuse, Cannot Redirect"):
            self.assertIsNotNone(re.search(check.absent, bad, re.DOTALL))


if __name__ == "__main__":
    unittest.main()
