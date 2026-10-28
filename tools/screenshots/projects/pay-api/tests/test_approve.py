import unittest

from pay_api.approve import approve
from pay_api.client import PGClient


class FakeTransport:
    """결제사가 답하는 데 걸리는 시간(초)만 흉내 낸다."""

    def __init__(self, latency):
        self.latency = latency

    def send(self, path, body):
        return self.latency


def pg(latency):
    return PGClient(FakeTransport(latency))


class ApproveTest(unittest.TestCase):
    def test_fast_answer_is_approved(self):
        self.assertEqual(approve(pg(0.4), {'id': 'A-1', 'amount': 19000})['status'], 'approved')

    def test_order_id_is_kept(self):
        self.assertEqual(approve(pg(0.4), {'id': 'A-2', 'amount': 5000})['order_id'], 'A-2')

    def test_amount_is_kept(self):
        self.assertEqual(approve(pg(0.4), {'id': 'A-3', 'amount': 42000})['amount'], 42000)

    def test_pg_that_never_answers_times_out(self):
        with self.assertRaises(TimeoutError):
            approve(pg(30), {'id': 'A-4', 'amount': 19000})
