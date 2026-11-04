# Security Runner для ПК

## Вариант 1. Готовый .exe через GitHub (Windows)

1. Залей в репозиторий папки `desktop` и `.github` вместе со всем остальным проектом (так же, как обновляешь игру для Android).
2. Открой вкладку **Actions** → **Build Security Runner Windows** → **Run workflow**.
3. После зелёной галочки открой запуск и скачай **Security-Runner-Windows** из блока Artifacts.
4. Распакуй архив. Внутри один файл `Security-Runner-…-portable.exe`: запускается без установки.

Windows может показать «Защитник Windows предотвратил запуск»: приложение не подписано сертификатом. Нажми «Подробнее» → «Выполнить в любом случае».

## Вариант 2. Запуск в браузере на ПК

Нужны Node.js 22+ и pnpm.

```
pnpm install
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/velocity-platformer run dev
```
(в PowerShell: `$env:PORT=3000; $env:BASE_PATH="/"; pnpm --filter @workspace/velocity-platformer run dev`)

Открой http://localhost:3000.

## Примечания

- F11 включает и выключает полный экран, кнопка «ВЫХОД» в меню закрывает игру.
- Сохранения и уровни хранятся в профиле приложения, отдельно от Android-версии.
- Шрифт интерфейса подгружается из интернета; без сети используется запасной шрифт.
