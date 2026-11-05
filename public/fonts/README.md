# Fonts

Self-hosted so the app does not depend on Google Fonts or a CDN at runtime.

| File | Family | Source | License |
|---|---|---|---|
| `plus-jakarta-sans-latin.woff2` | Plus Jakarta Sans (variable, Latin) | Google Fonts / Tokotype | SIL Open Font License 1.1 |
| `plus-jakarta-sans-latin-ext.woff2` | Plus Jakarta Sans (variable, Latin Extended) | Google Fonts / Tokotype | SIL Open Font License 1.1 |
| `pretendard/*.woff2` | Pretendard Variable (dynamic subset, 92 files) | https://github.com/orioncactus/pretendard | SIL Open Font License 1.1 |

Pretendard는 dynamic subset으로 나눠 두었습니다. 브라우저는 현재 화면에 필요한 글자 범위의 파일만 내려받습니다.
`@font-face` 규칙은 `src/styles/pretendard.css`에 있습니다.

License texts are in `PlusJakartaSans-OFL.txt` and `Pretendard-LICENSE.txt`.
