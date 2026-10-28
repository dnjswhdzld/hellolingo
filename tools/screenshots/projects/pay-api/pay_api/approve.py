"""주문 결제 승인. 결제사가 제때 답하지 않으면 TimeoutError가 올라가 500 응답이 된다."""
import logging

from .config import PG_TIMEOUT_SECONDS

log = logging.getLogger(__name__)


def approve(client, order):
    try:
        result = client.approve(order['amount'], timeout=PG_TIMEOUT_SECONDS)
    except TimeoutError:
        log.exception('approve failed order=%s', order['id'])
        raise
    return {'order_id': order['id'], **result}
