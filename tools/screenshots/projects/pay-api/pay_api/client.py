"""결제사(PG) 승인 API를 부르는 클라이언트. 테스트에서는 transport를 가짜로 바꿔 끼운다."""


class PGClient:
    def __init__(self, transport):
        self.transport = transport

    def approve(self, amount, timeout):
        took = self.transport.send('/approve', {'amount': amount})
        if took > timeout:
            raise TimeoutError(f'PG did not answer in {timeout}s')
        return {'status': 'approved', 'amount': amount}
