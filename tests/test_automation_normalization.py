import json
import unittest
from pathlib import Path

from automation_normalization import (
    is_icici_order_update_payload,
    match_symbol,
    normalize_callback_payload,
    normalize_icici_webhook_payload,
    normalize_position_row,
)


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


class PositionNormalizationTests(unittest.TestCase):
    def test_uses_buy_sell_quantity_pairs_for_signed_net_quantity(self):
        row = {
            "stock_code": "NIFTY50",
            "buy_quantity": "150",
            "sell_quantity": "75",
            "average_price": "100.5",
            "ltp": "104.0",
        }

        normalized = normalize_position_row(row)

        self.assertTrue(match_symbol(row, "NIFTY"))
        self.assertEqual(normalized["quantity"], 75.0)
        self.assertAlmostEqual(normalized["mtm"], 262.5)

    def test_uses_realized_and_unrealized_fields_when_direct_mtm_missing(self):
        row = {
            "symbol": "SENSEX",
            "net_qty": "-20",
            "realized_pnl": "125.5",
            "unrealized_profit_loss": "-25.0",
            "last_price": "0",
        }

        normalized = normalize_position_row(row)

        self.assertTrue(match_symbol(row, "BSESEN"))
        self.assertEqual(normalized["quantity"], -20.0)
        self.assertAlmostEqual(normalized["mtm"], 100.5)

    def test_flips_sign_for_sell_rows_without_explicit_net_quantity(self):
        row = {
            "stockCode": "NIFTY",
            "quantity": "75",
            "transaction_type": "sell",
            "avg_price": "210",
            "market_price": "180",
        }

        normalized = normalize_position_row(row)

        self.assertEqual(normalized["quantity"], -75.0)
        self.assertAlmostEqual(normalized["mtm"], 2250.0)


class CallbackNormalizationTests(unittest.TestCase):
    def test_detects_icici_order_update_fixture_shape(self):
        payload = json.loads((FIXTURE_DIR / "icici_webhook_order_update.json").read_text())

        self.assertTrue(is_icici_order_update_payload(payload))

    def test_detects_promoted_capture_fixture_shape(self):
        payload = json.loads((FIXTURE_DIR / "icici_webhook_real_capture.json").read_text())

        self.assertTrue(is_icici_order_update_payload(payload))

    def test_normalizes_expected_deployment_shape_fixture(self):
        payload = json.loads((FIXTURE_DIR / "icici_webhook_order_update.json").read_text())

        normalized = normalize_callback_payload(payload, "webhook", normalized_at=1741824000.0)

        self.assertEqual(normalized["ruleId"], "rule-1741881000000")
        self.assertEqual(normalized["ruleName"], "NIFTY staged exit")
        self.assertEqual(normalized["eventType"], "executed")
        self.assertEqual(normalized["status"], "success")
        self.assertEqual(normalized["message"], "Order fully executed")
        self.assertEqual(len(normalized["brokerResults"]), 2)
        self.assertTrue(all(item["success"] for item in normalized["brokerResults"]))
        self.assertEqual(normalized["meta"]["symbol"], "NIFTY")
        self.assertEqual(normalized["meta"]["normalizedAt"], 1741824000.0)
        self.assertEqual(normalized["meta"]["normalizer"], "icici_order_update")

    def test_normalizes_promoted_capture_fixture(self):
        payload = json.loads((FIXTURE_DIR / "icici_webhook_real_capture.json").read_text())

        normalized = normalize_callback_payload(payload, "webhook", normalized_at=1741824000.25)

        self.assertEqual(normalized["ruleId"], "rule-1741881000000")
        self.assertEqual(normalized["ruleName"], "NIFTY staged exit")
        self.assertEqual(normalized["eventType"], "executed")
        self.assertEqual(normalized["status"], "success")
        self.assertEqual(normalized["message"], "Order fully executed")
        self.assertEqual(normalized["meta"]["normalizer"], "icici_order_update")
        self.assertEqual(normalized["meta"]["normalizedAt"], 1741824000.25)

    def test_normalizes_nested_icici_webhook_data_payload(self):
        payload = {
            "data": json.loads((FIXTURE_DIR / "icici_webhook_order_update.json").read_text()),
        }

        normalized = normalize_icici_webhook_payload(payload, "webhook", normalized_at=1741824000.5)

        self.assertEqual(normalized["ruleId"], "rule-1741881000000")
        self.assertEqual(normalized["eventType"], "executed")
        self.assertEqual(normalized["status"], "success")
        self.assertEqual(normalized["meta"]["normalizer"], "icici_order_update")
        self.assertEqual(normalized["meta"]["normalizedAt"], 1741824000.5)

    def test_rejection_payload_maps_to_failed_event(self):
        payload = {
            "callback_type": "order_rejected",
            "reason": "Margin shortfall",
            "client_order_id": "alpha-rule-99",
            "order_id": "OID-1",
            "order_status": "Rejected",
        }

        normalized = normalize_callback_payload(payload, "webhook", normalized_at=1741824001.0)

        self.assertEqual(normalized["ruleId"], "rule-99")
        self.assertEqual(normalized["eventType"], "failed")
        self.assertEqual(normalized["status"], "error")
        self.assertEqual(normalized["brokerResults"][0]["success"], False)
        self.assertEqual(normalized["brokerResults"][0]["error"], "Margin shortfall")


if __name__ == "__main__":
    unittest.main()
