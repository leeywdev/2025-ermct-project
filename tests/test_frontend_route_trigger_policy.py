from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PARAMEDIC_DASHBOARD = ROOT / "front" / "src" / "components" / "ParamedicDashboard.tsx"


class FrontendRouteTriggerPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = PARAMEDIC_DASHBOARD.read_text(encoding="utf-8")

    def test_predict_success_handlers_do_not_route_automatically(self) -> None:
        self.assertNotIn('runHospitalRouteFromCase("voice"', self.source)
        self.assertNotIn('runHospitalRouteFromCase("text"', self.source)
        self.assertNotIn('await runHospitalRouteFromCase("voice"', self.source)
        self.assertNotIn('await runHospitalRouteFromCase("text"', self.source)

    def test_route_from_ktas_is_only_invoked_through_recommend_flow(self) -> None:
        route_call_count = len(re.findall(r"\bawait\s+requestRouteFromKTAS\(", self.source))
        self.assertEqual(route_call_count, 1)
        self.assertIn("[recommend] button clicked", self.source)
        self.assertIn("[recommend] route payload", self.source)
        self.assertIn("[recommend] route response", self.source)


if __name__ == "__main__":
    unittest.main()
