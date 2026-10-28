# 결제 승인 설정

PG_BASE_URL = 'https://pg.example.com'

# 결제사가 이 시간 안에 답하지 않으면 승인을 포기한다.
PG_TIMEOUT_SECONDS = 3  # 10에서 줄임 (10/27 배포, 응답을 빨리 돌려주려고)
