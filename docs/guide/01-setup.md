# 1. 설치

## 준비

- Claude Code **v2.1.311 이상**이 필요합니다. 버전은 터미널에서 확인합니다.

  ```bash
  claude --version
  ```

- **터미널**이나 **데스크톱 앱**에서 씁니다. VS Code 확장에서는 카드가 보이지 않습니다.
- Claude Code에 로그인되어 있어야 합니다. 카드를 만들 때 haiku 모델을 부르기 때문입니다.

## 설치

Claude Code 입력창에 아래 줄을 입력합니다.

```
/plugin install hellolingo --marketplace dnjswhdzld/hellolingo
```

터미널에서 바로 설치해도 됩니다.

```bash
claude plugin install hellolingo --marketplace dnjswhdzld/hellolingo
```

설치한 뒤에는 **새 세션**을 엽니다. 열려 있던 세션에는 나타나지 않습니다.

- **터미널.** Claude Code를 닫고 `claude`로 다시 엽니다.
- **데스크톱 앱.** 새 세션을 만듭니다.

## 쓰는 양

카드 하나에 haiku 모델을 한 번 부릅니다. Claude Code 사용량에 들어갑니다. 퀴즈와 노트는 모델을 부르지 않습니다.

## 보내는 것

- 내 프롬프트만 haiku에 보냅니다. 프롬프트 안의 코드 블록은 빼고 보냅니다.
- Claude의 답, 내 코드, 파일은 읽지도 바꾸지도 않습니다.
- 노트는 내 컴퓨터에만 저장합니다.

다음: [2. 보기](02-see.md)
